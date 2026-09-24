import { describe, expect, it } from "vitest";
import {
  createMicrosoftPkceCookie,
  verifyMicrosoftPkceCookie
} from "./microsoft-pkce";

const secret =
  "s".repeat(48);

describe("Microsoft PKCE cookie", () => {
  it("round-trips verifier only for the matching OAuth state nonce", () => {
    const verifier =
      "v".repeat(64);

    const token =
      createMicrosoftPkceCookie({
        verifier,
        stateNonce:
          "nonce-1",
        secret,
        now:
          new Date(
            "2026-09-24T10:00:00Z"
          )
      });

    expect(
      verifyMicrosoftPkceCookie({
        token,
        expectedStateNonce:
          "nonce-1",
        secret,
        now:
          new Date(
            "2026-09-24T10:05:00Z"
          )
      })
    ).toBe(verifier);
  });

  it("rejects tampering and nonce mismatch", () => {
    const token =
      createMicrosoftPkceCookie({
        verifier:
          "v".repeat(64),
        stateNonce:
          "nonce-1",
        secret
      });

    expect(() =>
      verifyMicrosoftPkceCookie({
        token:
          `${token}x`,
        expectedStateNonce:
          "nonce-1",
        secret
      })
    ).toThrow();

    expect(() =>
      verifyMicrosoftPkceCookie({
        token,
        expectedStateNonce:
          "nonce-2",
        secret
      })
    ).toThrow(
      "MICROSOFT_PKCE_STATE_MISMATCH"
    );
  });

  it("rejects expired verifier cookies", () => {
    const token =
      createMicrosoftPkceCookie({
        verifier:
          "v".repeat(64),
        stateNonce:
          "nonce-1",
        secret,
        now:
          new Date(
            "2026-09-24T10:00:00Z"
          ),
        ttlSeconds: 60
      });

    expect(() =>
      verifyMicrosoftPkceCookie({
        token,
        expectedStateNonce:
          "nonce-1",
        secret,
        now:
          new Date(
            "2026-09-24T10:02:00Z"
          )
      })
    ).toThrow(
      "MICROSOFT_PKCE_COOKIE_EXPIRED"
    );
  });
});
