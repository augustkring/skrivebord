import {
  getWorkspaceProfile,
  listCalendarEvents,
  listCalendarSources,
  withPrincipalTransaction
} from "@skrivebord/database";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";
import {
  CreateCalendarEvent
} from "./_components/create-calendar-event";
import {
  OperationalCalendar
} from "./_components/operational-calendar";

export const dynamic =
  "force-dynamic";

export default async function CalendarPage({
  params
}: {
  params: Promise<{
    workspaceSlug: string;
  }>;
}) {
  const { workspaceSlug } =
    await params;

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug,
      requestId:
        crypto.randomUUID()
    });

  if (!principal) {
    redirect("/sign-in");
  }

  const state =
    await withPrincipalTransaction(
      databasePool,
      principal,
      async ({ db }) => ({
        events:
          await listCalendarEvents(
            db,
            principal.workspaceId
          ),
        workspace:
          await getWorkspaceProfile(
            db,
            principal.workspaceId
          ),
        sources:
          await listCalendarSources(
            db,
            principal.workspaceId
          )
      })
    );

  const canUpdateCalendar =
    principal.capabilities.includes(
      "calendar.update"
    );

  const canCreateCalendar =
    principal.capabilities.includes(
      "calendar.create"
    );

  const workspaceTimezone =
    state.workspace?.timezone ??
    "Europe/Copenhagen";

  return (
    <>
      <PageTitle
        title="Kalender"
        subtitle="Én normaliseret driftskalender på tværs af Skrivebord og tilsluttede kalendere."
      />

      <div className="mb-4">
        <div className="text-sm font-semibold">
          Driftskalender
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Måned, uge og liste bygger på den samme normaliserede kalender-cache. Vælg en begivenhed for at se detaljer eller flytte den.
        </p>
      </div>

      {canCreateCalendar ? (
        <CreateCalendarEvent
          workspaceSlug={workspaceSlug}
          workspaceTimezone={
            workspaceTimezone
          }
          sources={state.sources.map(
            (source) => ({
              id: source.id,
              provider:
                source.provider,
              displayName:
                source.displayName,
              writable:
                source.writable,
              isPrimary:
                source.isPrimary,
              syncState:
                source.syncState
            })
          )}
        />
      ) : null}

      {state.events.length ===
      0 ? (
        <p className="rounded-lg border border-[var(--border-default)] bg-white p-5 text-sm text-[var(--text-secondary)]">
          Der er ingen kalenderbegivenheder endnu. Tilslut en kalender eller opret en intern driftsbegivenhed.
        </p>
      ) : (
        <OperationalCalendar
          workspaceSlug={
            workspaceSlug
          }
          workspaceTimezone={
            workspaceTimezone
          }
          canUpdateCalendar={
            canUpdateCalendar
          }
          events={state.events.map(
            (event) => ({
              id: event.id,
              title:
                event.title,
              startAt:
                event.startAt
                  ?.toISOString() ??
                null,
              endAt:
                event.endAt
                  ?.toISOString() ??
                null,
              startDate:
                event.startDate ??
                null,
              endDate:
                event.endDate ??
                null,
              allDay:
                event.allDay,
              timezone:
                event.timezone,
              recurrenceMasterId:
                event
                  .recurrenceMasterId,
              recurrenceRule:
                event
                  .recurrenceRule,
              category:
                event.category,
              status:
                event.status,
              provider:
                event.provider,
              sourceName:
                event.sourceName,
              writable:
                event.writable,
              syncState:
                event.syncState,
              lastSyncedAt:
                event.lastSyncedAt
                  ?.toISOString() ??
                null
            })
          )}
        />
      )}
    </>
  );
}
