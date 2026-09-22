import { executeAction } from "@skrivebord/actions";
import {
  bindAgentCredential,
  getAgentProvisioningState,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import {
  MOJN_V1_CAPABILITIES
} from "@skrivebord/policy";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { databasePool } from "@/lib/database";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const RequestSchema = z.object({
  workspaceSlug: z.string().min(1)
}).strict();

const KEY_TTL_SECONDS =
  60 * 60 * 24 * 180;

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
          "Du har ikke adgang til at provisionere Mojn."
      },
      { status: 403 }
    );
  }

  const existing =
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        getAgentProvisioningState(
          db,
          {
            workspaceId:
              principal.workspaceId,
            runtimeAgentKey: "mojn"
          }
        )
    );

  if (
    existing?.enabled &&
    existing.activeCredential
  ) {
    return Response.json(
      {
        status: "CONFLICT",
        humanSummary:
          "Mojn har allerede en aktiv credential.",
        agent: {
          id: existing.agentId,
          name: existing.name,
          expiresAt:
            existing.activeCredential
              .expiresAt
              ?.toISOString() ?? null,
          lastUsedAt:
            existing.activeCredential
              .lastUsedAt
              ?.toISOString() ?? null,
          capabilities:
            existing.activeCredential
              .capabilities
        }
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
      id: "agent.mojn.provision",
      input: z.object({
        workspaceId:
          z.string().min(1)
      }).strict(),
      requiredCapabilities: [
        "agent.policy.manage"
      ],
      risk: () => "MEDIUM",
      reversible: true,
      preview: async () =>
        "Provisionér Mojn credential",
      execute: async () => {
        const created =
          await auth.api.createApiKey({
            body: {
              configId:
                "agent-keys",
              name: "Mojn",
              organizationId:
                principal.workspaceId,
              expiresIn:
                KEY_TTL_SECONDS,
              rateLimitEnabled:
                true,
              rateLimitTimeWindow:
                60_000,
              rateLimitMax: 120,
              permissions: {
                skrivebord: [
                  ...MOJN_V1_CAPABILITIES
                ]
              },
              metadata: {
                runtimeAgentKey:
                  "mojn",
                principalType:
                  "AGENT"
              }
            },
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

        try {
          const expiresAt =
            created.expiresAt
              ? new Date(
                  created.expiresAt
                )
              : undefined;

          const binding =
            await withPrincipalTransaction(
              databasePool,
              principal,
              ({ db }) =>
                bindAgentCredential(
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
                )
            );

          return {
            agentId:
              binding.agentId,
            name: binding.name,
            apiKey: created.key,
            apiKeyId:
              created.id,
            expiresAt:
              expiresAt?.toISOString() ??
              null,
            capabilities:
              binding.capabilities
          };
        } catch (error) {
          try {
            await auth.api.deleteApiKey({
              body: {
                configId:
                  "agent-keys",
                keyId:
                  created.id
              },
              headers:
                request.headers
            });
          } catch {
            // Best-effort cleanup. The
            // binding still failed closed.
          }

          throw error;
        }
      }
    },
    principal,
    rawInput: {
      workspaceId:
        principal.workspaceId
    },
    store
  });

  const statusCode =
    result.status === "SUCCEEDED"
      ? 200
      : result.status ===
          "DENIED"
        ? 403
        : result.status ===
            "PENDING_APPROVAL"
          ? 202
          : 500;

  return Response.json(
    result,
    { status: statusCode }
  );
}
