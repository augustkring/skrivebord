import { resolveAgentPrincipal } from "@skrivebord/auth";
import { normalizeAgentCapabilities } from "@skrivebord/agent";
import type { PrincipalContext } from "@skrivebord/contracts";
import { auth, authRuntimeStatus } from "./auth";

function readApiKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return token;
  }

  const direct = request.headers.get("x-api-key")?.trim();
  return direct || null;
}

export async function resolveMcpAgentPrincipal(
  request: Request
): Promise<PrincipalContext | null> {
  if (!authRuntimeStatus.coreConfigured) return null;

  const key = readApiKey(request);
  if (!key) return null;

  const verified = await auth.api.verifyApiKey({
    body: {
      key,
      configId: "agent-keys"
    }
  });

  if (!verified.valid || !verified.key) return null;

  const referenceId = verified.key.referenceId;
  if (typeof referenceId !== "string" || !referenceId) return null;

  return resolveAgentPrincipal(
    {
      agentId: `agent-key:${verified.key.id}`,
      workspaceId: referenceId,
      capabilities: normalizeAgentCapabilities(verified.key.permissions)
    },
    crypto.randomUUID()
  );
}
