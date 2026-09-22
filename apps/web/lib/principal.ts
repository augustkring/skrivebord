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
  if (!session) return null;

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders
  });

  const organization = organizations.find(
    (candidate) => candidate.slug === input.workspaceSlug
  );

  if (!organization) return null;

  const memberResult = await auth.api.listMembers({
    query: {
      organizationId: organization.id,
      limit: 100,
      offset: 0
    },
    headers: requestHeaders
  });

  const membership = memberResult.members.find(
    (member) => member.userId === session.user.id
  );

  if (!membership) return null;

  return resolveHumanPrincipal(
    {
      userId: session.user.id,
      workspaceId: organization.id,
      role: mapOrganizationRole(membership.role),
      authStrength: "SESSION"
    },
    input.requestId
  );
}
