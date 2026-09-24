import {
  EnvelopeProtector,
  keyRingFromBase64
} from "@skrivebord/connectors";

export type GoogleOAuthRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
};

export type MicrosoftOAuthRuntimeConfig = {
  tenant: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`MISSING_ENV:${name}`);
  }
  return value;
}

export function getGoogleOAuthRuntimeConfig(): GoogleOAuthRuntimeConfig {
  const baseUrl = new URL(requiredEnv("BETTER_AUTH_URL"));
  const callback = new URL(
    "/api/connections/google/callback",
    baseUrl
  );

  return {
    clientId: requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: callback.toString(),
    stateSecret: requiredEnv("CONNECTOR_STATE_SECRET")
  };
}

export function getMicrosoftOAuthRuntimeConfig(): MicrosoftOAuthRuntimeConfig {
  const baseUrl = new URL(requiredEnv("BETTER_AUTH_URL"));
  const callback = new URL(
    "/api/connections/microsoft/callback",
    baseUrl
  );

  return {
    tenant:
      process.env.MICROSOFT_TENANT?.trim() ||
      "common",
    clientId:
      requiredEnv("MICROSOFT_CLIENT_ID"),
    clientSecret:
      requiredEnv("MICROSOFT_CLIENT_SECRET"),
    redirectUri:
      callback.toString(),
    stateSecret:
      requiredEnv("CONNECTOR_STATE_SECRET")
  };
}

export function getConnectorProtector(): EnvelopeProtector {
  const activeKeyId = requiredEnv(
    "CONNECTOR_ENVELOPE_ACTIVE_KEY_ID"
  );
  const rawKeys = requiredEnv(
    "CONNECTOR_ENVELOPE_KEYS_JSON"
  );

  let keys: Record<string, string>;
  try {
    const parsed = JSON.parse(rawKeys) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("NOT_OBJECT");
    }

    keys = Object.fromEntries(
      Object.entries(parsed).map(([keyId, value]) => {
        if (typeof value !== "string") {
          throw new Error(
            `INVALID_ENVELOPE_KEY:${keyId}`
          );
        }
        return [keyId, value];
      })
    );
  } catch {
    throw new Error(
      "INVALID_ENV:CONNECTOR_ENVELOPE_KEYS_JSON"
    );
  }

  return new EnvelopeProtector(
    keyRingFromBase64({
      activeKeyId,
      keys
    })
  );
}
