import {
  MOJN_V1_CAPABILITIES
} from "@skrivebord/policy";
import { auth } from "./auth";

export const MOJN_KEY_TTL_SECONDS =
  60 * 60 * 24 * 180;

export async function createMojnApiKey(
  input: {
    organizationId: string;
    headers: Headers;
  }
) {
  return auth.api.createApiKey({
    body: {
      configId: "agent-keys",
      name: "Mojn",
      organizationId:
        input.organizationId,
      expiresIn:
        MOJN_KEY_TTL_SECONDS,
      rateLimitEnabled: true,
      rateLimitTimeWindow: 60_000,
      rateLimitMax: 120,
      permissions: {
        skrivebord: [
          ...MOJN_V1_CAPABILITIES
        ]
      },
      metadata: {
        runtimeAgentKey: "mojn",
        principalType: "AGENT"
      }
    },
    headers: input.headers
  });
}

export async function deleteMojnApiKey(
  input: {
    keyId: string;
    headers: Headers;
  }
): Promise<boolean> {
  try {
    const result =
      await auth.api.deleteApiKey({
        body: {
          configId: "agent-keys",
          keyId: input.keyId
        },
        headers: input.headers
      });

    return result.success;
  } catch {
    return false;
  }
}
