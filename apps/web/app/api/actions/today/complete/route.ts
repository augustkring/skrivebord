import { executeAction } from "@skrivebord/actions";
import {
  createCompleteWorkItemAction,
  PostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";

const RequestSchema = z.object({
  workspaceSlug: z.string().min(1),
  workItemId: z.string().uuid()
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

  const result = await withPrincipalTransaction(
    databasePool,
    principal,
    async ({ db }) => {
      const store = new PostgresActionStore(
        db,
        principal.workspaceId
      );

      return executeAction({
        definition: createCompleteWorkItemAction(db),
        principal,
        rawInput: {
          workspaceId: principal.workspaceId,
          workItemId: parsed.data.workItemId
        },
        store
      });
    }
  );

  const statusCode =
    result.status === "SUCCEEDED"
      ? 200
      : result.status === "PENDING_APPROVAL"
        ? 202
        : result.status === "DENIED"
          ? 403
          : result.status === "CONFLICT"
            ? 409
            : 500;

  return Response.json(result, { status: statusCode });
}
