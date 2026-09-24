import { executeAction } from "@skrivebord/actions";
import {
  TransactionalPostgresActionStore
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import { runGoogleCalendarSync } from "@/lib/google-sync";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const RequestSchema = z.object({
  workspaceSlug: z.string().min(1)
}).strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary: "Anmodningen kunne ikke valideres."
      },
      { status: 400 }
    );
  }

  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug: parsed.data.workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (!principal) {
    return Response.json(
      {
        status: "DENIED",
        humanSummary: "Du har ikke adgang til dette workspace."
      },
      { status: 401 }
    );
  }

  const store = new TransactionalPostgresActionStore(
    databasePool,
    principal
  );

  const result = await executeAction({
    definition: {
      id: "connection.google.sync",
      input: z.object({
        workspaceId: z.string().min(1)
      }).strict(),
      requiredCapabilities: ["connection.manage"],
      risk: () => "LOW",
      reversible: true,
      preview: async () => "Synkronisér Google Calendar",
      execute: async () =>
        runGoogleCalendarSync({
          workspaceId: principal.workspaceId
        })
    },
    principal,
    rawInput: {
      workspaceId: principal.workspaceId
    },
    store
  });

  const statusCode =
    result.status === "SUCCEEDED"
      ? 200
      : result.status === "DENIED"
        ? 403
        : result.status === "PENDING_APPROVAL"
          ? 202
          : 500;

  return Response.json(result, {
    status: statusCode
  });
}
