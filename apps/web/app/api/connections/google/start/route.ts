import { buildGoogleAuthorizationUrl } from "@skrivebord/connectors";
import { z } from "zod";
import {
  getGoogleOAuthRuntimeConfig
} from "@/lib/connector-security";
import {
  createConnectorOAuthState
} from "@/lib/oauth-state";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const QuerySchema = z.object({
  workspaceSlug: z.string().min(1)
}).strict();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    workspaceSlug: url.searchParams.get("workspaceSlug")
  });

  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_WORKSPACE" },
      { status: 400 }
    );
  }

  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug: parsed.data.workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (
    !principal ||
    !principal.capabilities.includes("connection.manage")
  ) {
    return Response.json(
      { error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const config = getGoogleOAuthRuntimeConfig();
  const state = createConnectorOAuthState({
    provider: "GOOGLE",
    workspaceId: principal.workspaceId,
    workspaceSlug: parsed.data.workspaceSlug,
    principalId: principal.principalId,
    returnPath:
      `/${encodeURIComponent(parsed.data.workspaceSlug)}/settings`,
    secret: config.stateSecret
  });

  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state
  });

  return Response.redirect(authorizationUrl, 302);
}
