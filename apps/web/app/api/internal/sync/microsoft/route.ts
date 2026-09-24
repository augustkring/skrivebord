import { executeAction } from "@skrivebord/actions";
import { resolveSystemPrincipal } from "@skrivebord/auth";
import {
  TransactionalPostgresActionStore
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  authorizeInternalBearer
} from "@/lib/internal-auth";
import {
  runMicrosoftCalendarSync
} from "@/lib/microsoft-sync";

const RequestSchema = z.object({
  workspaceId:
    z.string().min(1)
}).strict();

export async function POST(
  request: Request
) {
  if (
    !authorizeInternalBearer(
      request,
      process.env
        .INTERNAL_SYNC_TOKEN
    )
  ) {
    return Response.json(
      {
        error:
          "UNAUTHORIZED"
      },
      { status: 401 }
    );
  }

  const body =
    await request.json().catch(
      () => null
    );

  const parsed =
    RequestSchema.safeParse(
      body
    );

  if (!parsed.success) {
    return Response.json(
      {
        error:
          "INVALID_REQUEST"
      },
      { status: 400 }
    );
  }

  const principal =
    resolveSystemPrincipal(
      {
        jobId:
          "system:scheduled-microsoft-sync",
        workspaceId:
          parsed.data
            .workspaceId,
        capabilities: [
          "connection.manage"
        ]
      },
      crypto.randomUUID()
    );

  const store =
    new TransactionalPostgresActionStore(
      databasePool,
      principal
    );

  const result =
    await executeAction({
      definition: {
        id:
          "connection.microsoft.sync.system",
        input:
          z.object({
            workspaceId:
              z.string().min(1)
          }).strict(),
        requiredCapabilities: [
          "connection.manage"
        ],
        risk: () =>
          "LOW",
        reversible: true,
        preview: async () =>
          "Kør planlagt Microsoft Calendar-synkronisering",
        execute: async () =>
          runMicrosoftCalendarSync({
            workspaceId:
              principal
                .workspaceId
          })
      },
      principal,
      rawInput: {
        workspaceId:
          principal.workspaceId
      },
      store
    });

  const statusCode =
    result.status ===
    "SUCCEEDED"
      ? 200
      : result.status ===
          "DENIED"
        ? 403
        : 500;

  return Response.json(
    result,
    {
      status:
        statusCode
    }
  );
}
