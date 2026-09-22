import { toNextJsHandler } from "better-auth/next-js";
import { auth, authRuntimeStatus } from "@/lib/auth";

const handlers = toNextJsHandler(auth);

function unavailable() {
  return Response.json(
    {
      error: "AUTH_RUNTIME_NOT_CONFIGURED",
      message: "Authentication is not configured for this deployment."
    },
    { status: 503 }
  );
}

export function GET(request: Request) {
  if (!authRuntimeStatus.coreConfigured) return unavailable();
  return handlers.GET(request);
}

export function POST(request: Request) {
  if (!authRuntimeStatus.coreConfigured) return unavailable();
  return handlers.POST(request);
}
