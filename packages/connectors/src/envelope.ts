import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

export type EnvelopeKeyRing = {
  activeKeyId: string;
  keys: Record<string, Buffer>;
};

export class EnvelopeProtector {
  constructor(private readonly keyRing: EnvelopeKeyRing) {
    const active = this.keyRing.keys[this.keyRing.activeKeyId];
    if (!active || active.length !== 32) {
      throw new Error("ACTIVE_ENVELOPE_KEY_MUST_BE_32_BYTES");
    }

    for (const [keyId, key] of Object.entries(this.keyRing.keys)) {
      if (key.length !== 32) {
        throw new Error(
          `ENVELOPE_KEY_MUST_BE_32_BYTES:${keyId}`
        );
      }
    }
  }

  protect(plaintext: string): string {
    const keyId = this.keyRing.activeKeyId;
    const key = this.keyRing.keys[keyId];
    if (!key) throw new Error("ACTIVE_ENVELOPE_KEY_NOT_FOUND");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return [
      "v1",
      keyId,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url")
    ].join(".");
  }

  unprotect(payload: string): string {
    const [version, keyId, ivText, tagText, ciphertextText] =
      payload.split(".");

    if (
      version !== "v1" ||
      !keyId ||
      !ivText ||
      !tagText ||
      !ciphertextText
    ) {
      throw new Error("INVALID_ENVELOPE_PAYLOAD");
    }

    const key = this.keyRing.keys[keyId];
    if (!key) {
      throw new Error(`ENVELOPE_KEY_NOT_FOUND:${keyId}`);
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivText, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  }

  get activeKeyId(): string {
    return this.keyRing.activeKeyId;
  }
}

export function keyRingFromBase64(input: {
  activeKeyId: string;
  keys: Record<string, string>;
}): EnvelopeKeyRing {
  return {
    activeKeyId: input.activeKeyId,
    keys: Object.fromEntries(
      Object.entries(input.keys).map(([keyId, encoded]) => [
        keyId,
        Buffer.from(encoded, "base64")
      ])
    )
  };
}
