import { describe, expect, it } from "vitest";
import {
  buildOpenClawSessionKey,
  conversationContextKey
} from "./conversations";

describe("OpenClaw conversation binding", () => {
  const bookingId =
    "11111111-1111-4111-8111-111111111111";
  const propertyId =
    "22222222-2222-4222-8222-222222222222";

  it("builds stable keys for the same workspace and context", () => {
    const first =
      buildOpenClawSessionKey({
        workspaceId: "workspace-a",
        runtimeAgentKey: "mojn",
        context: {
          type: "GENERAL"
        }
      });

    const second =
      buildOpenClawSessionKey({
        workspaceId: "workspace-a",
        runtimeAgentKey: "mojn",
        context: {
          type: "GENERAL"
        }
      });

    expect(first).toBe(second);
    expect(first).toContain(
      "agent:mojn:skrivebord:"
    );
  });

  it("separates workspaces and business contexts", () => {
    const generalA =
      buildOpenClawSessionKey({
        workspaceId: "workspace-a",
        runtimeAgentKey: "mojn",
        context: {
          type: "GENERAL"
        }
      });

    const generalB =
      buildOpenClawSessionKey({
        workspaceId: "workspace-b",
        runtimeAgentKey: "mojn",
        context: {
          type: "GENERAL"
        }
      });

    const booking =
      buildOpenClawSessionKey({
        workspaceId: "workspace-a",
        runtimeAgentKey: "mojn",
        context: {
          type: "BOOKING",
          id: bookingId
        }
      });

    const property =
      buildOpenClawSessionKey({
        workspaceId: "workspace-a",
        runtimeAgentKey: "mojn",
        context: {
          type: "PROPERTY",
          id: propertyId
        }
      });

    expect(
      new Set([
        generalA,
        generalB,
        booking,
        property
      ]).size
    ).toBe(4);
  });

  it("rejects non-UUID entity context ids", () => {
    expect(() =>
      conversationContextKey({
        type: "BOOKING",
        id: "not-a-uuid"
      })
    ).toThrow(
      "CONVERSATION_CONTEXT_ID_MUST_BE_UUID"
    );
  });
});
