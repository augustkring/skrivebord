import { describe, expect, it } from "vitest";
import {
  authorizeInternalBearer
} from "./internal-auth";

describe("internal bearer auth", () => {
  const token = "t".repeat(48);

  it("accepts the exact configured bearer", () => {
    const request = new Request(
      "https://example.com/internal",
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );

    expect(
      authorizeInternalBearer(
        request,
        token
      )
    ).toBe(true);
  });

  it("rejects wrong, missing and short configured tokens", () => {
    const request = new Request(
      "https://example.com/internal",
      {
        headers: {
          authorization:
            "Bearer wrong-token"
        }
      }
    );

    expect(
      authorizeInternalBearer(
        request,
        token
      )
    ).toBe(false);

    expect(
      authorizeInternalBearer(
        new Request(
          "https://example.com/internal"
        ),
        token
      )
    ).toBe(false);

    expect(
      authorizeInternalBearer(
        request,
        "short"
      )
    ).toBe(false);
  });
});
