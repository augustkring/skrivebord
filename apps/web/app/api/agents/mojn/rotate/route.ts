import { executeAction } from "@skrivebord/actions";
import {
  bindAgentCredential,
  getAgentProvisioningState,
  revokeAgentCredential,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import {
  MOJN_V1_CAPABILITIES
} from "@skrivebord/policy";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  createMojnApiKey,
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
          "Du har ikke adgang til at rotere Mojn credential."
      },
      { status: 403 }
    );
  }

  const current =
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

  const oldCredential =
    current?.activeCredential;

  if (!oldCredential) {
    return Response.json(
      {
        status: "CONFLICT",
        humanSummary:
          "Mojn har ingen aktiv credential at rotere."
      },
      { status: 409 }
    );
  }

  const store =
    new TransactionalPostgresActionStore(
      databasePool,
      principal
    );

  const result = await executeAction({
    definition: {
      id: "agent.mojn.rotate",
      input: z.object({
        workspaceId:
          z.string().min(1),
        oldApiKeyId:
          z.string().min(1)
      }).strict(),
      requiredCapabilities: [
        "agent.policy.manage"
      ],
      risk: () => "MEDIUM",
      reversible: true,
      preview: async () =>
        "Rotér Mojn credential",
      execute: async ({ input }) => {
        const created =
          await createMojnApiKey({
            organizationId:
              principal.workspaceId,
            headers:
              request.headers
          });

        if (
          !created.id ||
          !created.key
        ) {
          throw new Error(
            "AGENT_API_KEY_CREATE_FAILED"
          );
        }

        const expiresAt =
          created.expiresAt
            ? new Date(
                created.expiresAt
              )
            : undefined;

        try {
          const binding =
            await withPrincipalTransaction(
              databasePool,
              principal,
              async ({ db }) => {
                await revokeAgentCredential(
                  db,
                  {
                    workspaceId:
                      principal.workspaceId,
                    apiKeyId:
                      input.oldApiKeyId
                  }
                );

                return bindAgentCredential(
                  db,
                  {
                    workspaceId:
                      principal.workspaceId,
                    name: "Mojn",
                    runtimeAgentKey:
                      "mojn",
                    apiKeyId:
                      created.id,
                    capabilities: [
                      ...MOJN_V1_CAPABILITIES
                    ],
                    expiresAt
                  }
                );
              }
            );

          const oldProviderKeyDeleted =
            await deleteMojnApiKey({
              keyId:
                input.oldApiKeyId,
              headers:
                request.headers
            });

          return {
            agentId:
              binding.agentId,
            name: binding.name,
            apiKey:
              created.key,
            apiKeyId:
              created.id,
            expiresAt:
              expiresAt?.toISOString() ??
              null,
            capabilities:
              binding.capabilities,
            oldProviderKeyDeleted
          };
        } catch (error) {
          await deleteMojnApiKey({
            keyId:
              created.id,
            headers:
              request.headers
          });

          throw error;
        }
      }
    },
    principal,
    rawInput: {
      workspaceId:
        principal.workspaceId,
      oldApiKeyId:
        oldCredential.apiKeyId
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
