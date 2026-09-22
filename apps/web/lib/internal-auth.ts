import {
  createHash,
  timingSafeEqual
} from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256")
    .update(value, "utf8")
    .digest();
}

export function authorizeInternalBearer(
  request: Request,
  expectedToken: string | undefined
): boolean {
  if (!expectedToken || expectedToken.length < 32) {
    return false;
  }

  const authorization =
    request.headers.get("authorization");

  if (
    !authorization?.startsWith("Bearer ")
  ) {
    return false;
  }

  const provided = authorization
    .slice("Bearer ".length)
    .trim();

  if (!provided) return false;

  return timingSafeEqual(
    digest(provided),
    digest(expectedToken)
  );
}
