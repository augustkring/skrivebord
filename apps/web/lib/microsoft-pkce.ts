import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

export const MICROSOFT_PKCE_COOKIE =
  "skrivebord_ms_pkce";

type PkceCookiePayload = {
  verifier: string;
  stateNonce: string;
  expiresAt: number;
};

function sign(
  encodedPayload: string,
  secret: string
): string {
  return createHmac(
    "sha256",
    secret
  )
    .update(encodedPayload)
    .digest("base64url");
}

function encode(
  value: string
): string {
  return Buffer.from(
    value,
    "utf8"
  ).toString("base64url");
}

function decode(
  value: string
): string {
  return Buffer.from(
    value,
    "base64url"
  ).toString("utf8");
}

export function createMicrosoftPkceCookie(input: {
  verifier: string;
  stateNonce: string;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): string {
  if (
    input.secret.length < 32
  ) {
    throw new Error(
      "CONNECTOR_STATE_SECRET_TOO_SHORT"
    );
  }

  if (
    input.verifier.length < 43
  ) {
    throw new Error(
      "MICROSOFT_PKCE_VERIFIER_TOO_SHORT"
    );
  }

  const now =
    input.now ?? new Date();

  const payload:
    PkceCookiePayload = {
      verifier:
        input.verifier,
      stateNonce:
        input.stateNonce,
      expiresAt:
        Math.floor(
          now.getTime() /
            1000
        ) +
        (input.ttlSeconds ??
          10 * 60)
    };

  const encoded =
    encode(
      JSON.stringify(
        payload
      )
    );

  return `${encoded}.${sign(
    encoded,
    input.secret
  )}`;
}

export function verifyMicrosoftPkceCookie(input: {
  token: string;
  expectedStateNonce: string;
  secret: string;
  now?: Date;
}): string {
  if (
    input.secret.length < 32
  ) {
    throw new Error(
      "CONNECTOR_STATE_SECRET_TOO_SHORT"
    );
  }

  const [
    encodedPayload,
    providedSignature
  ] =
    input.token.split(".");

  if (
    !encodedPayload ||
    !providedSignature
  ) {
    throw new Error(
      "INVALID_MICROSOFT_PKCE_COOKIE"
    );
  }

  const expectedSignature =
    sign(
      encodedPayload,
      input.secret
    );

  const provided =
    Buffer.from(
      providedSignature,
      "base64url"
    );
  const expected =
    Buffer.from(
      expectedSignature,
      "base64url"
    );

  if (
    provided.length !==
      expected.length ||
    !timingSafeEqual(
      provided,
      expected
    )
  ) {
    throw new Error(
      "INVALID_MICROSOFT_PKCE_COOKIE_SIGNATURE"
    );
  }

  const payload =
    JSON.parse(
      decode(
        encodedPayload
      )
    ) as
      PkceCookiePayload;

  if (
    payload.stateNonce !==
    input.expectedStateNonce
  ) {
    throw new Error(
      "MICROSOFT_PKCE_STATE_MISMATCH"
    );
  }

  const now =
    input.now ?? new Date();

  if (
    payload.expiresAt <=
    Math.floor(
      now.getTime() /
        1000
    )
  ) {
    throw new Error(
      "MICROSOFT_PKCE_COOKIE_EXPIRED"
    );
  }

  if (
    typeof payload.verifier !==
      "string" ||
    payload.verifier.length <
      43
  ) {
    throw new Error(
      "INVALID_MICROSOFT_PKCE_VERIFIER"
    );
  }

  return payload.verifier;
}
