import {
  listActivityEvents,
  listPendingApprovals,
  withPrincipalTransaction
} from "@skrivebord/database";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";
import { ApprovalCard } from "./_components/approval-card";

export const dynamic = "force-dynamic";

function actorLabel(actorType: string): string {
  if (actorType === "AGENT") return "Mojn";
  if (actorType === "SYSTEM") return "Systemet";
  return "En bruger";
}

function outcomeLabel(outcome: string): string {
  if (outcome === "SUCCEEDED") return "Gennemført";
  if (outcome === "PENDING_APPROVAL") return "Afventer godkendelse";
  if (outcome === "DENIED") return "Afvist";
  if (outcome === "FAILED") return "Kunne ikke gennemføres";
  return outcome;
}

export default async function ActivityPage({
  params
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (!principal) redirect("/sign-in");

  const {
    activity,
    approvals
  } = await withPrincipalTransaction(
    databasePool,
    principal,
    async ({ db }) => ({
      activity:
        await listActivityEvents(
          db,
          principal.workspaceId
        ),
      approvals:
        await listPendingApprovals(
          db,
          principal.workspaceId
        )
    })
  );

  const canResolveApprovals =
    principal.capabilities.includes(
      "approval.resolve"
    );

  const formatter = new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit"
  });

  return (
    <>
      <PageTitle
        title="Aktivitet"
        subtitle="Menneskeligt læsbar driftshistorik. Tekniske detaljer hører til i audit-inspektoren."
      />

      {approvals.length > 0 ? (
        <section className="mb-8">
          <div className="border-t border-[var(--border-default)]">
            {approvals.map(
              (approval) => (
                <ApprovalCard
                  key={approval.id}
                  workspaceSlug={
                    workspaceSlug
                  }
                  canResolve={
                    canResolveApprovals
                  }
                  approval={{
                    id:
                      approval.id,
                    humanSummary:
                      approval.humanSummary,
                    consequenceSummary:
                      approval.consequenceSummary,
                    reversibility:
                      approval.reversibility,
                    requestedByPrincipalType:
                      approval.requestedByPrincipalType,
                    expiresAt:
                      approval.expiresAt.toISOString()
                  }}
                />
              )
            )}
          </div>
        </section>
      ) : null}

      {activity.length > 0 ? (
        <div className="border-t border-[var(--border-default)]">
          {activity.map((event) => (
            <article
              key={event.id}
              className="grid gap-2 border-b border-[var(--border-default)] py-4 sm:grid-cols-[72px_1fr]"
            >
              <time className="text-sm text-[var(--text-muted)]">
                {formatter.format(event.occurredAt)}
              </time>
              <div>
                <div className="font-medium">
                  {event.humanSummary ?? event.action}
                </div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">
                  {actorLabel(event.actorType)} · {outcomeLabel(event.outcome)}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="border-y border-[var(--border-default)] py-5 text-sm text-[var(--text-secondary)]">
          Der er endnu ingen registreret aktivitet.
        </p>
      )}
    </>
  );
}
