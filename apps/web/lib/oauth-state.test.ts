import { describe, expect, it } from "vitest";
import {
  createConnectorOAuthState,
  verifyConnectorOAuthState
} from "./oauth-state";

const secret = "s".repeat(48);

describe("connector OAuth state", () => {
  it("round-trips signed workspace and principal context", () => {
    const token = createConnectorOAuthState({
      provider: "GOOGLE",
      workspaceId: "ws_a",
      workspaceSlug: "alsleben",
      principalId: "user_lene",
      returnPath: "/alsleben/settings",
      secret,
      now: new Date("2026-09-22T10:00:00Z")
    });

    const state = verifyConnectorOAuthState({
      token,
      secret,
      now: new Date("2026-09-22T10:05:00Z")
    });

    expect(state).toMatchObject({
      provider: "GOOGLE",
      workspaceId: "ws_a",
      workspaceSlug: "alsleben",
      principalId: "user_lene",
      returnPath: "/alsleben/settings"
    });
    expect(state.nonce.length).toBeGreaterThan(20);
  });

  it("rejects tampering", () => {
    const token = createConnectorOAuthState({
      provider: "GOOGLE",
      workspaceId: "ws_a",
      workspaceSlug: "alsleben",
      principalId: "user_lene",
      returnPath: "/alsleben/settings",
      secret
    });

    const [payload, signature] = token.split(".");
    const tampered = `${payload}x.${signature}`;

    expect(() =>
      verifyConnectorOAuthState({
        token: tampered,
        secret
      })
    ).toThrow("INVALID_CONNECTOR_STATE_SIGNATURE");
  });

  it("rejects expired state", () => {
    const token = createConnectorOAuthState({
      provider: "GOOGLE",
      workspaceId: "ws_a",
      workspaceSlug: "alsleben",
      principalId: "user_lene",
      returnPath: "/alsleben/settings",
      secret,
      now: new Date("2026-09-22T10:00:00Z"),
      ttlSeconds: 60
    });

    expect(() =>
      verifyConnectorOAuthState({
        token,
        secret,
        now: new Date("2026-09-22T10:02:00Z")
      })
    ).toThrow("CONNECTOR_STATE_EXPIRED");
  });

  it("rejects external return URLs", () => {
    expect(() =>
      createConnectorOAuthState({
        provider: "GOOGLE",
        workspaceId: "ws_a",
        workspaceSlug: "alsleben",
        principalId: "user_lene",
        returnPath: "//evil.example",
        secret
      })
    ).toThrow("UNSAFE_OAUTH_RETURN_PATH");
  });
});
