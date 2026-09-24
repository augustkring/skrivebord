"use client";

import {
  CalendarPlus,
  LoaderCircle,
  X
} from "lucide-react";
import {
  FormEvent,
  useMemo,
  useRef,
  useState
} from "react";
import {
  useRouter
} from "next/navigation";
import {
  wallTimeToIso
} from "@/lib/calendar-local-time";

type CalendarSourceOption = {
  id: string;
  provider: string;
  displayName: string;
  writable: boolean;
  isPrimary: boolean;
  syncState: string;
};

export function CreateCalendarEvent({
  workspaceSlug,
  workspaceTimezone,
  sources
}: {
  workspaceSlug: string;
  workspaceTimezone: string;
  sources: CalendarSourceOption[];
}) {
  const router =
    useRouter();

  const writableSources =
    useMemo(
      () =>
        sources.filter(
          (source) =>
            source.writable &&
            [
              "CONNECTED",
              "HEALTHY"
            ].includes(
              source.syncState
            ) &&
            [
              "GOOGLE",
              "MICROSOFT"
            ].includes(
              source.provider
            )
        ),
      [sources]
    );

  const defaultSource =
    writableSources.find(
      (source) =>
        source.isPrimary
    ) ??
    writableSources[0];

  const [open, setOpen] =
    useState(false);
  const [title, setTitle] =
    useState("");
  const [sourceId, setSourceId] =
    useState(
      defaultSource?.id ?? ""
    );
  const [start, setStart] =
    useState("");
  const [end, setEnd] =
    useState("");
  const [pending, setPending] =
    useState(false);
  const [message, setMessage] =
    useState("");
  const idempotencyKey =
    useRef<string | null>(
      null
    );

  function resetIdempotency() {
    idempotencyKey.current =
      null;
  }

  async function submit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    let startsAt:
      | string;
    let endsAt:
      | string;

    try {
      startsAt =
        wallTimeToIso(
          start,
          workspaceTimezone
        );
      endsAt =
        wallTimeToIso(
          end,
          workspaceTimezone
        );
    } catch {
      setPending(false);
      setMessage(
        "Tidspunktet findes ikke i workspace-tidszonen."
      );
      return;
    }

    if (
      !idempotencyKey.current
    ) {
      idempotencyKey.current =
        crypto.randomUUID();
    }

    try {
      const response =
        await fetch(
          "/api/actions/calendar/create",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json"
            },
            body:
              JSON.stringify({
                workspaceSlug,
                idempotencyKey:
                  idempotencyKey.current,
                command: {
                  calendarSourceId:
                    sourceId,
                  title,
                  timing: {
                    kind:
                      "TIMED",
                    startsAt,
                    endsAt,
                    timezone:
                      workspaceTimezone
                  }
                }
              })
          }
        );

      const result =
        (await response
          .json()
          .catch(
            () => null
          )) as
          | {
              status?: string;
              humanSummary?: string;
            }
          | null;

      if (
        response.ok &&
        result?.status ===
          "SUCCEEDED"
      ) {
        idempotencyKey.current =
          null;
        setMessage(
          result.humanSummary ??
            "Begivenheden er oprettet."
        );
        setTitle("");
        setStart("");
        setEnd("");
        setOpen(false);
        router.refresh();
        return;
      }

      if (
        result?.status ===
        "PENDING_APPROVAL"
      ) {
        idempotencyKey.current =
          null;
        setMessage(
          "Handlingen afventer godkendelse i Aktivitet."
        );
        setOpen(false);
        router.refresh();
        return;
      }

      setMessage(
        result?.humanSummary ??
          "Begivenheden kunne ikke oprettes."
      );
    } catch {
      setMessage(
        "Forbindelsen blev afbrudt. Prøv igen for at genbruge den samme sikre handling."
      );
    } finally {
      setPending(false);
    }
  }

  if (
    writableSources.length ===
    0
  ) {
    return (
      <span className="text-xs text-[var(--text-muted)]">
        Ingen skrivbar kalender er forbundet.
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
        className="inline-flex items-center gap-2 rounded-md bg-[var(--action-primary)] px-3 py-2 text-sm font-semibold text-white"
      >
        <CalendarPlus
          size={15}
          aria-hidden="true"
        />
        Ny begivenhed
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mb-5 rounded-lg border border-[var(--border-default)] bg-white p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">
            Ny begivenhed
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Tidszone:{" "}
            {workspaceTimezone}
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setOpen(false)
          }
          className="rounded-md p-1 hover:bg-[var(--surface-muted)]"
          aria-label="Luk oprettelse"
        >
          <X
            size={16}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium">
            Titel
          </span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(
                event.target.value
              );
              resetIdempotency();
            }}
            required
            maxLength={300}
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2"
          />
        </label>

        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium">
            Kalender
          </span>
          <select
            value={sourceId}
            onChange={(event) => {
              setSourceId(
                event.target.value
              );
              resetIdempotency();
            }}
            required
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2"
          >
            {writableSources.map(
              (source) => (
                <option
                  key={source.id}
                  value={source.id}
                >
                  {source.displayName} ·{" "}
                  {source.provider ===
                  "GOOGLE"
                    ? "Google"
                    : "Microsoft"}
                </option>
              )
            )}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">
            Start
          </span>
          <input
            type="datetime-local"
            value={start}
            onChange={(event) => {
              setStart(
                event.target.value
              );
              resetIdempotency();
            }}
            required
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">
            Slut
          </span>
          <input
            type="datetime-local"
            value={end}
            onChange={(event) => {
              setEnd(
                event.target.value
              );
              resetIdempotency();
            }}
            required
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2"
          />
        </label>
      </div>

      {message ? (
        <p
          className="mt-3 text-sm text-[var(--text-secondary)]"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={
            pending ||
            !title.trim() ||
            !sourceId ||
            !start ||
            !end
          }
          className="inline-flex items-center gap-2 rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle
              size={15}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : (
            <CalendarPlus
              size={15}
              aria-hidden="true"
            />
          )}
          {pending
            ? "Opretter…"
            : "Opret begivenhed"}
        </button>
      </div>
    </form>
  );
}
