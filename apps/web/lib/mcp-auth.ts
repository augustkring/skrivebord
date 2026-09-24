import {
  resolveAgentPrincipal,
  resolveSystemPrincipal
} from "@skrivebord/auth";
import { normalizeAgentCapabilities } from "@skrivebord/agent";
import type { PrincipalContext } from "@skrivebord/contracts";
import {
  getBoundAgentCredential,
  intersectAgentCapabilities,
  touchAgentCredential,
  withPrincipalTransaction
} from "@skrivebord/database";
import { auth, authRuntimeStatus } from "./auth";
import { databasePool } from "./database";

function readApiKey(request: Request): string | null {
  const authorization =
    request.headers.get("authorization");

  if (
    authorization?.startsWith("Bearer ")
  ) {
    const token = authorization
      .slice("Bearer ".length)
      .trim();

    if (token) return token;
  }

  const direct =
    request.headers
      .get("x-api-key")
      ?.trim();

  return direct || null;
}

export async function resolveMcpAgentPrincipal(
  request: Request
): Promise<PrincipalContext | null> {
  if (!authRuntimeStatus.coreConfigured) {
    return null;
  }

  const key = readApiKey(request);
  if (!key) return null;

  const verified =
    await auth.api.verifyApiKey({
      body: {
        key,
        configId: "agent-keys"
      }
    });

  if (
    !verified.valid ||
    !verified.key
  ) {
    return null;
  }

  const workspaceId =
    verified.key.referenceId;

  if (
    typeof workspaceId !== "string" ||
    !workspaceId
  ) {
    return null;
  }

  const apiKeyCapabilities =
    normalizeAgentCapabilities(
      verified.key.permissions
    );

  const systemPrincipal =
    resolveSystemPrincipal(
      {
        jobId:
          "system:resolve-agent-credential",
        workspaceId,
        capabilities: []
      },
      crypto.randomUUID()
    );

  const binding =
    await withPrincipalTransaction(
      databasePool,
      systemPrincipal,
      async ({ db }) => {
        const resolved =
          await getBoundAgentCredential(
            db,
            {
              workspaceId,
              apiKeyId:
                verified.key!.id
            }
          );

        if (!resolved) {
          return undefined;
        }

        await touchAgentCredential(
          db,
          {
            workspaceId,
            apiKeyId:
              verified.key!.id
          }
        );

        return resolved;
      }
    );

  if (!binding) {
    return null;
  }

  const capabilities =
    intersectAgentCapabilities(
      apiKeyCapabilities,
      binding.capabilities
    );

  return resolveAgentPrincipal(
    {
      agentId:
        `agent:${binding.agentId}`,
      workspaceId,
      capabilities
    },
    crypto.randomUUID()
  );
}
