import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export type ConnectorOAuthState = {
  provider: "GOOGLE" | "MICROSOFT";
  workspaceId: string;
  workspaceSlug: string;
  principalId: string;
  returnPath: string;
  nonce: string;
  expiresAt: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(
  encodedPayload: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function assertSafeReturnPath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("UNSAFE_OAUTH_RETURN_PATH");
  }
}

export function createConnectorOAuthState(input: {
  provider: "GOOGLE" | "MICROSOFT";
  workspaceId: string;
  workspaceSlug: string;
  principalId: string;
  returnPath: string;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): string {
  if (input.secret.length < 32) {
    throw new Error("CONNECTOR_STATE_SECRET_TOO_SHORT");
  }

  assertSafeReturnPath(input.returnPath);

  const now = input.now ?? new Date();
  const payload: ConnectorOAuthState = {
    provider: input.provider,
    workspaceId: input.workspaceId,
    workspaceSlug: input.workspaceSlug,
    principalId: input.principalId,
    returnPath: input.returnPath,
    nonce: randomBytes(24).toString("base64url"),
    expiresAt:
      Math.floor(now.getTime() / 1000) +
      (input.ttlSeconds ?? 10 * 60)
  };

  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(
    encodedPayload,
    input.secret
  )}`;
}

export function verifyConnectorOAuthState(input: {
  token: string;
  secret: string;
  now?: Date;
}): ConnectorOAuthState {
  if (input.secret.length < 32) {
    throw new Error("CONNECTOR_STATE_SECRET_TOO_SHORT");
  }

  const [encodedPayload, providedSignature] =
    input.token.split(".");

  if (!encodedPayload || !providedSignature) {
    throw new Error("INVALID_CONNECTOR_STATE");
  }

  const expectedSignature = signature(
    encodedPayload,
    input.secret
  );

  const provided = Buffer.from(
    providedSignature,
    "base64url"
  );
  const expected = Buffer.from(
    expectedSignature,
    "base64url"
  );

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new Error("INVALID_CONNECTOR_STATE_SIGNATURE");
  }

  const payload = JSON.parse(
    decode(encodedPayload)
  ) as ConnectorOAuthState;

  assertSafeReturnPath(payload.returnPath);

  if (
    ![
      "GOOGLE",
      "MICROSOFT"
    ].includes(
      payload.provider
    ) ||
    !payload.workspaceId ||
    !payload.workspaceSlug ||
    !payload.principalId ||
    !payload.nonce ||
    !Number.isFinite(payload.expiresAt)
  ) {
    throw new Error("INVALID_CONNECTOR_STATE_PAYLOAD");
  }

  const now = input.now ?? new Date();
  if (
    payload.expiresAt <=
    Math.floor(now.getTime() / 1000)
  ) {
    throw new Error("CONNECTOR_STATE_EXPIRED");
  }

  return payload;
}
