import { executeAction } from "@skrivebord/actions";
import {
  getAgentProvisioningState,
  revokeAgentCredential,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  deleteMojnApiKey
} from "@/lib/mojn-credential";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const RequestSchema = z.object({
  workspaceSlug: z.string().min(1)
}).strict();

export async function POST(
  request: Request
) {
  const body =
    await request.json().catch(
      () => null
    );
  const parsed =
    RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Anmodningen kunne ikke valideres."
      },
      { status: 400 }
    );
  }

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug:
        parsed.data.workspaceSlug,
      requestId: crypto.randomUUID()
    });

  if (
    !principal ||
    !principal.capabilities.includes(
      "agent.policy.manage"
    )
  ) {
    return Response.json(
      {
        status: "DENIED",
        humanSummary:
          "Du har ikke adgang til at tilbagekalde Mojn."
      },
      { status: 403 }
    );
  }

  const state =
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        getAgentProvisioningState(
          db,
          {
            workspaceId:
              principal.workspaceId,
            runtimeAgentKey:
              "mojn"
          }
        )
    );

  const credential =
    state?.activeCredential;

  if (!credential) {
    return Response.json(
      {
        status: "SUCCEEDED",
        humanSummary:
          "Mojn har ingen aktiv credential.",
        data: {
          revoked: false,
          providerKeyDeleted: true
        }
      },
      { status: 200 }
    );
  }

  const store =
    new TransactionalPostgresActionStore(
      databasePool,
      principal
    );

  const result = await executeAction({
    definition: {
      id: "agent.mojn.revoke",
      input: z.object({
        workspaceId:
          z.string().min(1),
        apiKeyId:
          z.string().min(1)
      }).strict(),
      requiredCapabilities: [
        "agent.policy.manage"
      ],
      risk: () => "MEDIUM",
      reversible: true,
      preview: async () =>
        "Tilbagekald Mojn credential",
      execute: async ({ input }) => {
        await withPrincipalTransaction(
          databasePool,
          principal,
          ({ db }) =>
            revokeAgentCredential(
              db,
              {
                workspaceId:
                  principal.workspaceId,
                apiKeyId:
                  input.apiKeyId
              }
            )
        );

        const providerKeyDeleted =
          await deleteMojnApiKey({
            keyId:
              input.apiKeyId,
            headers:
              request.headers
          });

        return {
          revoked: true,
          providerKeyDeleted
        };
      }
    },
    principal,
    rawInput: {
      workspaceId:
        principal.workspaceId,
      apiKeyId:
        credential.apiKeyId
    },
    store
  });

  return Response.json(
    result,
    {
      status:
        result.status ===
        "SUCCEEDED"
          ? 200
          : result.status ===
              "DENIED"
            ? 403
            : 500
    }
  );
}
