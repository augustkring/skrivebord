import { resolveHumanPrincipal, type HumanRole } from "@skrivebord/auth";
import type { PrincipalContext } from "@skrivebord/contracts";
import { headers } from "next/headers";
import { auth, authRuntimeStatus } from "./auth";

function mapOrganizationRole(role: string): HumanRole {
  const roles = role.split(",").map((value) => value.trim());
  if (roles.includes("owner")) return "OWNER";
  if (roles.includes("viewer")) return "VIEWER";
  return "MEMBER";
}

export async function resolveWorkspaceHumanPrincipal(input: {
  workspaceSlug: string;
  requestId: string;
}): Promise<PrincipalContext | null> {
  if (!authRuntimeStatus.coreConfigured) return null;

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.session.activeOrganizationId) return null;

  const organization = await auth.api.getOrganization({
    query: { organizationSlug: input.workspaceSlug },
    headers: requestHeaders
  });

  if (!organization || organization.id !== session.session.activeOrganizationId) {
    return null;
  }

  const { role } = await auth.api.getActiveMemberRole({ headers: requestHeaders });

  return resolveHumanPrincipal(
    {
      userId: session.user.id,
      workspaceId: organization.id,
      role: mapOrganizationRole(role),
      authStrength: "SESSION"
    },
    input.requestId
  );
}
