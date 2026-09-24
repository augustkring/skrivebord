import { redirect } from "next/navigation";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { AppShell } from "./_components/app-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}>) {
  const { workspaceSlug } = await params;
  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (!principal) {
    redirect("/sign-in");
  }

  return <AppShell workspaceSlug={workspaceSlug}>{children}</AppShell>;
}
