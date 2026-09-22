import {
  getAgentProvisioningState,
  getGoogleConnection,
  withPrincipalTransaction
} from "@skrivebord/database";
import { ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";
import { GoogleSyncButton } from "./_components/google-sync-button";
import { MojnProvisioning } from "./_components/mojn-provisioning";
import { PasskeySecurity } from "./_components/passkey-security";

export const dynamic = "force-dynamic";

function connectionMessage(status?: string): string | null {
  if (status === "connected") {
    return "Google Calendar er forbundet.";
  }
  if (status === "denied") {
    return "Google-forbindelsen blev annulleret.";
  }
  if (status === "missing-code") {
    return "Google returnerede ikke en authorization code.";
  }
  if (status === "error") {
    return "Google Calendar kunne ikke forbindes. Se Aktivitet for den registrerede fejl.";
  }
  return null;
}

export default async function SettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ google?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;

  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (!principal) redirect("/sign-in");

  const state = await withPrincipalTransaction(
    databasePool,
    principal,
    async ({ db }) => ({
      google: await getGoogleConnection(
        db,
        principal.workspaceId
      ),
      mojn: await getAgentProvisioningState(
        db,
        {
          workspaceId:
            principal.workspaceId,
          runtimeAgentKey: "mojn"
        }
      )
    })
  );

  const google = state.google;
  const mojn = state.mojn;

  const canManageConnections =
    principal.capabilities.includes("connection.manage");
  const canManageAgent =
    principal.capabilities.includes("agent.policy.manage");
  const oauthConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.CONNECTOR_STATE_SECRET &&
      process.env.CONNECTOR_ENVELOPE_ACTIVE_KEY_ID &&
      process.env.CONNECTOR_ENVELOPE_KEYS_JSON
  );

  const message = connectionMessage(query.google);
  const writableCalendars =
    google?.sources.filter((source) => source.writable).length ?? 0;

  return (
    <>
      <PageTitle
        title="Indstillinger"
        subtitle="Sikkerhed, forbindelser og agentautoritet er eksplicitte produktindstillinger."
      />

      {message ? (
        <div
          className="mb-6 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 text-sm text-[var(--text-secondary)]"
          role="status"
        >
          {message}
        </div>
      ) : null}

      <div className="divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
        <section className="py-5">
          <h2 className="font-semibold">Workspace</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            {workspaceSlug} · Dansk · Europe/Copenhagen
          </p>
        </section>

        <section className="py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold">Connections</h2>
              {google ? (
                <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  <div>
                    Google Calendar · {google.account.displayName}
                  </div>
                  <div>
                    Status: {google.account.status} · {google.sources.length} kalendere · {writableCalendars} skrivbare
                  </div>
                  {google.account.lastSuccessAt ? (
                    <div>
                      Sidst synkroniseret:{" "}
                      {new Intl.DateTimeFormat("da-DK", {
                        timeZone: "Europe/Copenhagen",
                        dateStyle: "short",
                        timeStyle: "short"
                      }).format(google.account.lastSuccessAt)}
                    </div>
                  ) : (
                    <div>Første synkronisering mangler.</div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  Ingen ekstern kalender er forbundet endnu.
                </p>
              )}
            </div>

            {canManageConnections ? (
              oauthConfigured ? (
                <div className="flex flex-col items-start gap-2">
                  <a
                    href={`/api/connections/google/start?workspaceSlug=${encodeURIComponent(workspaceSlug)}`}
                    className="inline-flex items-center gap-2 self-start rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                    {google
                      ? "Forbind Google igen"
                      : "Forbind Google Calendar"}
                  </a>
                  {google ? (
                    <GoogleSyncButton
                      workspaceSlug={workspaceSlug}
                    />
                  ) : null}
                </div>
              ) : (
                <span className="self-start text-xs text-[var(--status-warning)]">
                  Google OAuth er ikke konfigureret i miljøet.
                </span>
              )
            ) : null}
          </div>
        </section>

        <section className="py-5">
          <h2 className="font-semibold">Mojn</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Mojn er en selvstændig AGENT-principal. MCP-adgang kræver både en gyldig org-key og en aktiv agent-binding.
          </p>
          <MojnProvisioning
            workspaceSlug={workspaceSlug}
            canManage={canManageAgent}
            existing={
              mojn?.enabled &&
              mojn.activeCredential
                ? {
                    agentId:
                      mojn.agentId,
                    name: mojn.name,
                    expiresAt:
                      mojn.activeCredential
                        .expiresAt
                        ?.toISOString() ??
                      null,
                    lastUsedAt:
                      mojn.activeCredential
                        .lastUsedAt
                        ?.toISOString() ??
                      null,
                    capabilities:
                      mojn.activeCredential
                        .capabilities
                  }
                : null
            }
          />
        </section>

        <section className="py-5">
          <h2 className="font-semibold">Access & Security</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Owner / Member / Viewer. Følsomme ændringer kræver eksplicit authorization.
          </p>
          <PasskeySecurity />
        </section>

        <section className="py-5">
          <h2 className="font-semibold">Usage</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Viser kun autoritative målinger, når runtime/provider-data findes.
          </p>
        </section>
      </div>
    </>
  );
}
