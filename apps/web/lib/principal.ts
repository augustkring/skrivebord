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

  const organization = await auth.api.getFullOrganization({
    query: {
      organizationSlug: input.workspaceSlug,
      membersLimit: 100
    },
    headers: requestHeaders
  });

  if (!organization) return null;

  const membership = organization.members.find(
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
