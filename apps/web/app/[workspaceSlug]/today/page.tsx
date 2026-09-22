import {
  listTodayItems,
  recomputeToday,
  withPrincipalTransaction
} from "@skrivebord/database";
import { CircleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";
import { CompleteWorkButton } from "./_components/complete-work-button";

export const dynamic = "force-dynamic";

type Item = Awaited<ReturnType<typeof listTodayItems>>[number];

function suggestedActionLabel(actionId: string | null): string | null {
  if (!actionId) return null;

  const labels: Record<string, string> = {
    "booking.resolve_conflict": "Gennemgå konflikt",
    "connection.reconnect": "Forbind igen",
    "guest_message.draft": "Klargør besked",
    "yearplan.complete": "Åbn aktivitet"
  };

  return labels[actionId] ?? null;
}

function WorkRow({
  item,
  workspaceSlug
}: {
  item: Item;
  workspaceSlug: string;
}) {
  const suggestion = suggestedActionLabel(item.suggestedActionId);

  return (
    <div className="grid gap-3 border-t border-[var(--border-default)] py-5 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <div className="font-medium">{item.title}</div>
        <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
          {item.reason}
        </div>
        {suggestion ? (
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            Næste handling: {suggestion}
          </div>
        ) : null}
      </div>

      <CompleteWorkButton
        workspaceSlug={workspaceSlug}
        workItemId={item.id}
      />
    </div>
  );
}

export default async function TodayPage({
  params
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (!principal) {
    redirect("/sign-in");
  }

  const now = new Date();
  const items = await withPrincipalTransaction(
    databasePool,
    principal,
    async ({ db }) => {
      await recomputeToday(db, principal.workspaceId, now);
      return listTodayItems(db, principal.workspaceId);
    }
  );

  const active = items.filter(
    (item) =>
      item.status !== "DONE" &&
      item.status !== "DISMISSED"
  );
  const requiresYou = active.filter(
    (item) => item.priorityClass === "REQUIRES_YOU"
  );
  const today = active.filter(
    (item) => item.priorityClass === "TODAY"
  );
  const upcoming = active.filter(
    (item) => item.priorityClass === "UPCOMING"
  );
  const thisMonth = active.filter(
    (item) => item.kind === "YEAR_PLAN"
  );

  const dateLabel = new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(now);

  return (
    <>
      <PageTitle
        title="I dag"
        subtitle={`${dateLabel} · Et lille, begrundet overblik over det der faktisk kræver handling.`}
      />

      {requiresYou.length > 0 ? (
        <section className="mb-10" aria-labelledby="requires-you">
          <div className="mb-3 flex items-center gap-2">
            <CircleAlert size={18} aria-hidden="true" />
            <h2 id="requires-you" className="text-lg font-semibold">
              Kræver dig
            </h2>
            <span className="text-sm text-[var(--text-muted)]">
              {requiresYou.length}
            </span>
          </div>
          <div className="border-y border-[var(--border-default)]">
            {requiresYou.map((item) => (
              <WorkRow
                key={item.id}
                item={item}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-10" aria-labelledby="today-work">
        <h2 id="today-work" className="mb-3 text-lg font-semibold">
          Bør gøres i dag
        </h2>
        {today.length > 0 ? (
          <div className="border-y border-[var(--border-default)]">
            {today.map((item) => (
              <WorkRow
                key={item.id}
                item={item}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        ) : (
          <p className="border-y border-[var(--border-default)] py-5 text-sm text-[var(--text-secondary)]">
            Der er ikke noget planlagt arbejde, der kræver handling i dag.
          </p>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Næste 7 dage
          </h2>
          <div className="border-t border-[var(--border-default)]">
            {upcoming.map((item) => (
              <div
                key={item.id}
                className="border-b border-[var(--border-default)] py-4"
              >
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">
                  {item.reason}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Denne måned
          </h2>
          <div className="border-t border-[var(--border-default)]">
            {thisMonth.map((item) => (
              <div
                key={item.id}
                className="border-b border-[var(--border-default)] py-4"
              >
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">
                  {item.reason}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
