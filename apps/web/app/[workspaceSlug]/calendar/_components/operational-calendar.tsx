"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import listPlugin from "@fullcalendar/react/list";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import daLocale from "@fullcalendar/react/locales/da";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import {
  useMemo,
  useState
} from "react";
import {
  MoveCalendarEvent
} from "./move-calendar-event";

export type OperationalCalendarEvent = {
  id: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
  timezone: string | null;
  recurrenceMasterId:
    string | null;
  recurrenceRule:
    string | null;
  category: string;
  status: string;
  provider: string;
  sourceName: string;
  writable: boolean;
  syncState: string;
};

export function OperationalCalendar({
  workspaceSlug,
  workspaceTimezone,
  events
}: {
  workspaceSlug: string;
  workspaceTimezone: string;
  events: OperationalCalendarEvent[];
}) {
  const [selectedId, setSelectedId] =
    useState<string | null>(
      events[0]?.id ?? null
    );

  const selected =
    events.find(
      (event) =>
        event.id === selectedId
    ) ?? null;

  const calendarEvents =
    useMemo(
      () =>
        events.map(
          (event) => ({
            id: event.id,
            title:
              event.title,
            start:
              event.allDay
                ? event.startDate ??
                  undefined
                : event.startAt ??
                  undefined,
            end:
              event.allDay
                ? event.endDate ??
                  undefined
                : event.endAt ??
                  undefined,
            allDay:
              event.allDay,
            extendedProps: {
              sourceName:
                event.sourceName,
              provider:
                event.provider,
              writable:
                event.writable,
              syncState:
                event.syncState
            }
          })
        ),
      [events]
    );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 rounded-lg border border-[var(--border-default)] bg-white p-3 sm:p-4">
        <FullCalendar
          plugins={[
            classicThemePlugin,
            dayGridPlugin,
            timeGridPlugin,
            listPlugin
          ]}
          themeSystem="classic"
          locale={daLocale}
          timeZone={
            workspaceTimezone
          }
          initialView="dayGridMonth"
          headerToolbar={{
            left:
              "prev,next today",
            center: "title",
            right:
              "dayGridMonth,timeGridWeek,listWeek"
          }}
          buttonText={{
            month: "Måned",
            week: "Uge",
            list: "Liste"
          }}
          firstDay={1}
          height="auto"
          expandRows
          nowIndicator
          navLinks
          eventInteractive
          events={calendarEvents}
          eventClick={(info) => {
            setSelectedId(
              info.event.id
            );
          }}
          eventClass={() =>
            "cursor-pointer"
          }
          eventTimeFormat={{
            hour: "2-digit",
            minute:
              "2-digit",
            hour12: false
          }}
          noEventsText="Ingen kalenderbegivenheder i perioden."
        />
      </div>

      <aside className="self-start rounded-lg border border-[var(--border-default)] bg-white p-4 xl:sticky xl:top-4">
        {selected ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Valgt begivenhed
            </div>
            <h2 className="mt-2 font-semibold">
              {selected.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
              {selected.sourceName}
              {" · "}
              {selected.provider}
              {" · "}
              {selected.syncState}
            </p>

            <div className="mt-4">
              {selected.provider ===
                "GOOGLE" &&
              selected.writable &&
              selected.syncState ===
                "CONNECTED" &&
              selected.status ===
                "CONFIRMED" &&
              !selected.allDay &&
              selected.startAt &&
              selected.endAt ? (
                <MoveCalendarEvent
                  workspaceSlug={
                    workspaceSlug
                  }
                  event={{
                    id:
                      selected.id,
                    title:
                      selected.title,
                    startAt:
                      selected.startAt,
                    endAt:
                      selected.endAt,
                    timezone:
                      selected.timezone ??
                      workspaceTimezone,
                    recurrenceMasterId:
                      selected
                        .recurrenceMasterId,
                    recurrenceRule:
                      selected
                        .recurrenceRule
                  }}
                />
              ) : (
                <p className="text-xs leading-5 text-[var(--text-muted)]">
                  Denne begivenhed kan ikke flyttes fra Skrivebord i sin nuværende tilstand.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            Vælg en begivenhed i kalenderen for at se detaljer og handlinger.
          </p>
        )}
      </aside>
    </div>
  );
}
