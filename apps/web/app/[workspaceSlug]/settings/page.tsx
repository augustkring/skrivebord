import {
  getAgentProvisioningState,
  getGoogleConnection,
  getMicrosoftConnection,
  withPrincipalTransaction
} from "@skrivebord/database";
import { ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";
import { GoogleSyncButton } from "./_components/google-sync-button";
import { MicrosoftSyncButton } from "./_components/microsoft-sync-button";
import { MojnProvisioning } from "./_components/mojn-provisioning";
import { PasskeySecurity } from "./_components/passkey-security";

export const dynamic = "force-dynamic";

function connectionMessage(
  provider: "Google" | "Microsoft",
  status?: string
): string | null {
  if (status === "connected") {
    return `${provider} Calendar er forbundet.`;
  }
  if (status === "denied") {
    return `${provider}-forbindelsen blev annulleret.`;
  }
  if (status === "missing-code") {
    return `${provider} returnerede ikke en authorization code.`;
  }
  if (status === "error") {
    return `${provider} Calendar kunne ikke forbindes. Se Aktivitet for den registrerede fejl.`;
  }
  return null;
}

export default async function SettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    google?: string;
    microsoft?: string;
  }>;
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
      microsoft: await getMicrosoftConnection(
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
  const microsoft = state.microsoft;
  const mojn = state.mojn;

  const canManageConnections =
    principal.capabilities.includes("connection.manage");
  const canManageAgent =
    principal.capabilities.includes("agent.policy.manage");
  const sharedConnectorConfig = Boolean(
    process.env.CONNECTOR_STATE_SECRET &&
      process.env.CONNECTOR_ENVELOPE_ACTIVE_KEY_ID &&
      process.env.CONNECTOR_ENVELOPE_KEYS_JSON
  );

  const googleOauthConfigured = Boolean(
    sharedConnectorConfig &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
  );

  const microsoftOauthConfigured = Boolean(
    sharedConnectorConfig &&
      process.env.MICROSOFT_CLIENT_ID &&
      process.env.MICROSOFT_CLIENT_SECRET
  );

  const messages = [
    connectionMessage(
      "Google",
      query.google
    ),
    connectionMessage(
      "Microsoft",
      query.microsoft
    )
  ].filter(
    (value): value is string =>
      Boolean(value)
  );

  const googleWritableCalendars =
    google?.sources.filter(
      (source) => source.writable
    ).length ?? 0;

  const microsoftWritableCalendars =
    microsoft?.sources.filter(
      (source) => source.writable
    ).length ?? 0;

  return (
    <>
      <PageTitle
        title="Indstillinger"
        subtitle="Sikkerhed, forbindelser og agentautoritet er eksplicitte produktindstillinger."
      />

      {messages.length > 0 ? (
        <div
          className="mb-6 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 text-sm text-[var(--text-secondary)]"
          role="status"
        >
          {messages.map((message) => (
            <div key={message}>
              {message}
            </div>
          ))}
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
          <h2 className="font-semibold">
            Connections
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Tilsluttede kalendere normaliseres til samme driftskalender og regelmotor.
          </p>

          <div className="mt-5 divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
            <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="font-medium">
                  Google Calendar
                </div>
                {google ? (
                  <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                    <div>
                      {google.account.displayName}
                    </div>
                    <div>
                      Status: {google.account.status} · {google.sources.length} kalendere · {googleWritableCalendars} skrivbare
                    </div>
                    <div>
                      {google.account.lastSuccessAt
                        ? `Sidst synkroniseret ${new Intl.DateTimeFormat("da-DK", {
                            timeZone: "Europe/Copenhagen",
                            dateStyle: "short",
                            timeStyle: "short"
                          }).format(google.account.lastSuccessAt)}`
                        : "Første synkronisering mangler."}
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    Ikke forbundet.
                  </p>
                )}
              </div>

              {canManageConnections ? (
                googleOauthConfigured ? (
                  <div className="flex flex-col items-start gap-2">
                    <a
                      href={`/api/connections/google/start?workspaceSlug=${encodeURIComponent(workspaceSlug)}`}
                      className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
                    >
                      <ExternalLink
                        size={15}
                        aria-hidden="true"
                      />
                      {google
                        ? "Forbind igen"
                        : "Forbind"}
                    </a>
                    {google ? (
                      <GoogleSyncButton
                        workspaceSlug={workspaceSlug}
                      />
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--status-warning)]">
                    Google OAuth er ikke konfigureret.
                  </span>
                )
              ) : null}
            </div>

            <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="font-medium">
                  Microsoft Calendar
                </div>
                {microsoft ? (
                  <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                    <div>
                      {microsoft.account.displayName}
                    </div>
                    <div>
                      Status: {microsoft.account.status} · {microsoft.sources.length} kalendere · {microsoftWritableCalendars} skrivbare
                    </div>
                    <div>
                      {microsoft.account.lastSuccessAt
                        ? `Sidst synkroniseret ${new Intl.DateTimeFormat("da-DK", {
                            timeZone: "Europe/Copenhagen",
                            dateStyle: "short",
                            timeStyle: "short"
                          }).format(microsoft.account.lastSuccessAt)}`
                        : "Første synkronisering mangler."}
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    Ikke forbundet.
                  </p>
                )}
              </div>

              {canManageConnections ? (
                microsoftOauthConfigured ? (
                  <div className="flex flex-col items-start gap-2">
                    <a
                      href={`/api/connections/microsoft/start?workspaceSlug=${encodeURIComponent(workspaceSlug)}`}
                      className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
                    >
                      <ExternalLink
                        size={15}
                        aria-hidden="true"
                      />
                      {microsoft
                        ? "Forbind igen"
                        : "Forbind"}
                    </a>
                    {microsoft ? (
                      <MicrosoftSyncButton
                        workspaceSlug={workspaceSlug}
                      />
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--status-warning)]">
                    Microsoft OAuth er ikke konfigureret.
                  </span>
                )
              ) : null}
            </div>
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
