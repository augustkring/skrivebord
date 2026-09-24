import {
  listAttentionItems,
  recomputeToday,
  withPrincipalTransaction
} from "@skrivebord/database";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";

export const dynamic = "force-dynamic";

function typeLabel(kind: string): string {
  if (kind === "BOOKING_CONFLICT") return "Konflikt";
  if (kind === "CONNECTOR_ACCESS") return "Adgang";
  if (kind.includes("SECURITY")) return "Sikkerhed";
  return "Opmærksomhed";
}

function actionLabel(actionId: string | null): string | null {
  if (!actionId) return null;
  const labels: Record<string, string> = {
    "booking.resolve_conflict": "Gennemgå konflikt",
    "connection.reconnect": "Forbind igen"
  };
  return labels[actionId] ?? null;
}

export default async function AttentionPage({
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

  const items = await withPrincipalTransaction(
    databasePool,
    principal,
    async ({ db }) => {
      await recomputeToday(db, principal.workspaceId, new Date());
      return listAttentionItems(db, principal.workspaceId);
    }
  );

  return (
    <>
      <PageTitle
        title="Opmærksomhed"
        subtitle="Kun arbejde hvor et menneske faktisk er nødvendigt. Ikke en generel notifikationsfeed."
      />

      {items.length > 0 ? (
        <div className="border-y border-[var(--border-default)]">
          {items.map((item) => {
            const action = actionLabel(item.suggestedActionId);

            return (
              <article
                key={item.id}
                className="border-b border-[var(--border-default)] py-5 last:border-b-0"
              >
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--status-warning)]">
                  {typeLabel(item.kind)}
                </div>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                  {item.reason}
                </p>
                {action ? (
                  <div className="mt-3 text-sm font-medium">
                    Næste handling: {action}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="border-y border-[var(--border-default)] py-5 text-sm text-[var(--text-secondary)]">
          Der er ikke noget, der kræver din opmærksomhed lige nu.
        </p>
      )}
    </>
  );
}
