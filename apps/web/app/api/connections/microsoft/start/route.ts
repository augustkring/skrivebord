import {
  buildMicrosoftAuthorizationUrl,
  createMicrosoftPkce
} from "@skrivebord/connectors";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  getMicrosoftOAuthRuntimeConfig
} from "@/lib/connector-security";
import {
  createMicrosoftPkceCookie,
  MICROSOFT_PKCE_COOKIE
} from "@/lib/microsoft-pkce";
import {
  createConnectorOAuthState,
  verifyConnectorOAuthState
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
    workspaceSlug:
      url.searchParams.get(
        "workspaceSlug"
      )
  });

  if (!parsed.success) {
    return Response.json(
      {
        error:
          "INVALID_WORKSPACE"
      },
      { status: 400 }
    );
  }

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug:
        parsed.data.workspaceSlug,
      requestId:
        crypto.randomUUID()
    });

  if (
    !principal ||
    !principal.capabilities.includes(
      "connection.manage"
    )
  ) {
    return Response.json(
      { error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const config =
    getMicrosoftOAuthRuntimeConfig();
  const pkce =
    createMicrosoftPkce();

  const stateToken =
    createConnectorOAuthState({
      provider:
        "MICROSOFT",
      workspaceId:
        principal.workspaceId,
      workspaceSlug:
        parsed.data.workspaceSlug,
      principalId:
        principal.principalId,
      returnPath:
        `/${encodeURIComponent(parsed.data.workspaceSlug)}/settings`,
      secret:
        config.stateSecret
    });

  const state =
    verifyConnectorOAuthState({
      token: stateToken,
      secret:
        config.stateSecret
    });

  const cookieToken =
    createMicrosoftPkceCookie({
      verifier:
        pkce.verifier,
      stateNonce:
        state.nonce,
      secret:
        config.stateSecret
    });

  const cookieStore =
    await cookies();

  cookieStore.set(
    MICROSOFT_PKCE_COOKIE,
    cookieToken,
    {
      httpOnly: true,
      sameSite: "lax",
      secure:
        new URL(
          process.env
            .BETTER_AUTH_URL ??
            request.url
        ).protocol ===
        "https:",
      path:
        "/api/connections/microsoft/callback",
      maxAge: 10 * 60
    }
  );

  const authorizationUrl =
    buildMicrosoftAuthorizationUrl({
      tenant:
        config.tenant,
      clientId:
        config.clientId,
      redirectUri:
        config.redirectUri,
      state:
        stateToken,
      codeChallenge:
        pkce.challenge
    });

  return Response.redirect(
    authorizationUrl,
    302
  );
}
