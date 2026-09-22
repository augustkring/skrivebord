import { AppShell } from "./_components/app-shell";

export default async function WorkspaceLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  return <AppShell workspaceSlug={workspaceSlug}>{children}</AppShell>;
}
