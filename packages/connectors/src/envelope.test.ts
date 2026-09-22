import { describe, expect, it } from "vitest";
import {
  EnvelopeProtector,
  keyRingFromBase64
} from "./envelope";

function key(fill: number): string {
  return Buffer.alloc(32, fill).toString("base64");
}

describe("EnvelopeProtector", () => {
  it("round-trips protected connector secrets without plaintext leakage", () => {
    const protector = new EnvelopeProtector(
      keyRingFromBase64({
        activeKeyId: "k2",
        keys: {
          k1: key(1),
          k2: key(2)
        }
      })
    );

    const plaintext = JSON.stringify({
      accessToken: "access-secret",
      refreshToken: "refresh-secret"
    });

    const protectedValue = protector.protect(plaintext);

    expect(protectedValue).not.toContain("access-secret");
    expect(protectedValue).not.toContain("refresh-secret");
    expect(protectedValue.startsWith("v1.k2.")).toBe(true);
    expect(protector.unprotect(protectedValue)).toBe(plaintext);
  });

  it("can decrypt older payloads after active-key rotation", () => {
    const first = new EnvelopeProtector(
      keyRingFromBase64({
        activeKeyId: "k1",
        keys: {
          k1: key(1),
          k2: key(2)
        }
      })
    );

    const payload = first.protect("sync-token");

    const rotated = new EnvelopeProtector(
      keyRingFromBase64({
        activeKeyId: "k2",
        keys: {
          k1: key(1),
          k2: key(2)
        }
      })
    );

    expect(rotated.unprotect(payload)).toBe("sync-token");
    expect(rotated.activeKeyId).toBe("k2");
  });

  it("rejects keys that are not exactly 32 bytes", () => {
    expect(
      () =>
        new EnvelopeProtector(
          keyRingFromBase64({
            activeKeyId: "bad",
            keys: {
              bad: Buffer.alloc(16).toString("base64")
            }
          })
        )
    ).toThrow("ACTIVE_ENVELOPE_KEY_MUST_BE_32_BYTES");
  });
});
