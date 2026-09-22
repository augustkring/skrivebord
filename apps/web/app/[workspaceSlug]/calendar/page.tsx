import {
  listCalendarEvents,
  withPrincipalTransaction
} from "@skrivebord/database";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";

export const dynamic = "force-dynamic";

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    BOOKING: "Booking",
    TURNOVER: "Rengøring",
    MAINTENANCE: "Vedligehold",
    ADMIN: "Administration",
    YEAR_PLAN: "Årsplan"
  };
  return labels[category] ?? category;
}

function providerLabel(provider: string): string {
  if (provider === "GOOGLE") return "Google";
  if (provider === "MICROSOFT") return "Microsoft";
  if (provider === "SKRIVEBORD") return "Skrivebord";
  return provider;
}

function eventStartLabel(event: {
  allDay: boolean;
  startAt: Date | null;
  startDate: string | null;
}): string {
  if (event.allDay && event.startDate) {
    return new Intl.DateTimeFormat("da-DK", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "numeric"
    }).format(new Date(`${event.startDate}T12:00:00Z`));
  }

  if (event.startAt) {
    return new Intl.DateTimeFormat("da-DK", {
      timeZone: "Europe/Copenhagen",
      weekday: "short",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(event.startAt);
  }

  return "Tid ikke tilgængelig";
}

export default async function CalendarPage({
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

  const events = await withPrincipalTransaction(
    databasePool,
    principal,
    ({ db }) => listCalendarEvents(db, principal.workspaceId)
  );

  const sorted = [...events].sort((a, b) => {
    const aTime = a.startAt?.getTime() ??
      (a.startDate ? new Date(`${a.startDate}T12:00:00Z`).getTime() : 0);
    const bTime = b.startAt?.getTime() ??
      (b.startDate ? new Date(`${b.startDate}T12:00:00Z`).getTime() : 0);
    return aTime - bTime;
  });

  return (
    <>
      <PageTitle
        title="Kalender"
        subtitle="Én normaliseret driftskalender på tværs af Skrivebord og tilsluttede kalendere."
      />

      <div className="mb-4 flex gap-2 text-sm">
        <button className="rounded-md border border-[var(--border-strong)] bg-white px-3 py-2">
          Liste
        </button>
        <span className="self-center text-xs text-[var(--text-muted)]">
          Måned og uge kobles på FullCalendar-visningen i connectorfasen.
        </span>
      </div>

      {sorted.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-white">
          {sorted.map((event) => (
            <article
              key={event.id}
              className="grid gap-2 border-b border-[var(--border-default)] p-4 last:border-b-0 sm:grid-cols-[170px_1fr_170px] sm:items-center"
            >
              <div className="text-sm font-medium">
                {eventStartLabel(event)}
              </div>

              <div>
                <div className="font-medium">{event.title}</div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">
                  {categoryLabel(event.category)}
                </div>
              </div>

              <div className="text-sm text-[var(--text-muted)] sm:text-right">
                <div>{providerLabel(event.provider)}</div>
                <div className="mt-1 text-xs">
                  {event.syncState}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-[var(--border-default)] bg-white p-5 text-sm text-[var(--text-secondary)]">
          Der er ingen kalenderbegivenheder endnu. Tilslut en kalender eller opret en intern driftsbegivenhed.
        </p>
      )}
    </>
  );
}
