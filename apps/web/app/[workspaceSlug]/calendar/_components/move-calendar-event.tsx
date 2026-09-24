"use client";

import {
  LoaderCircle,
  Move,
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
  toLocalInput,
  wallTimeToIso
} from "@/lib/calendar-local-time";

export function MoveCalendarEvent({
  workspaceSlug,
  event
}: {
  workspaceSlug: string;
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    timezone: string;
    recurrenceMasterId:
      | string
      | null;
    recurrenceRule:
      | string
      | null;
  };
}) {
  const router =
    useRouter();
  const [open, setOpen] =
    useState(false);
  const [start, setStart] =
    useState(() =>
      toLocalInput(
        event.startAt,
        event.timezone
      )
    );
  const [end, setEnd] =
    useState(() =>
      toLocalInput(
        event.endAt,
        event.timezone
      )
    );
  const [scope, setScope] =
    useState<
      "OCCURRENCE" |
      "SERIES"
    >(
      event.recurrenceRule &&
      !event.recurrenceMasterId
        ? "SERIES"
        : "OCCURRENCE"
    );
  const [pending, setPending] =
    useState(false);
  const [message, setMessage] =
    useState("");
  const idempotencyKey =
    useRef<string | null>(
      null
    );

  const scopeOptions =
    useMemo(() => {
      if (
        event.recurrenceMasterId
      ) {
        return [
          {
            value:
              "OCCURRENCE" as const,
            label:
              "Denne forekomst"
          },
          {
            value:
              "SERIES" as const,
            label:
              "Hele serien"
          }
        ];
      }

      if (
        event.recurrenceRule
      ) {
        return [
          {
            value:
              "SERIES" as const,
            label:
              "Hele serien"
          }
        ];
      }

      return [
        {
          value:
            "OCCURRENCE" as const,
          label:
            "Denne begivenhed"
        }
      ];
    }, [
      event.recurrenceMasterId,
      event.recurrenceRule
    ]);

  function updateStart(
    value: string
  ) {
    setStart(value);
    idempotencyKey.current =
      null;
  }

  function updateEnd(
    value: string
  ) {
    setEnd(value);
    idempotencyKey.current =
      null;
  }

  function updateScope(
    value:
      | "OCCURRENCE"
      | "SERIES"
  ) {
    setScope(value);
    idempotencyKey.current =
      null;
  }

  async function submit(
    submitEvent:
      FormEvent<HTMLFormElement>
  ) {
    submitEvent.preventDefault();
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
          event.timezone
        );
      endsAt =
        wallTimeToIso(
          end,
          event.timezone
        );
    } catch {
      setPending(false);
      setMessage(
        "Tidspunktet findes ikke i kalenderens tidszone."
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
          "/api/actions/calendar/move",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json"
            },
            body: JSON.stringify({
              workspaceSlug,
              eventId:
                event.id,
              startsAt,
              endsAt,
              scope,
              idempotencyKey:
                idempotencyKey.current
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
          "Begivenheden er flyttet."
        );
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
          "Begivenheden kunne ikke flyttes."
      );
    } catch {
      setMessage(
        "Forbindelsen blev afbrudt. Prøv igen for at genbruge den samme sikre handling."
      );
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
      >
        <Move
          size={15}
          aria-hidden="true"
        />
        Flyt
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-muted)] p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">
            Flyt {event.title}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Tidszone:{" "}
            {event.timezone}
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setOpen(false)
          }
          className="rounded-md p-1 hover:bg-white"
          aria-label="Luk flytning"
        >
          <X
            size={16}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">
            Start
          </span>
          <input
            type="datetime-local"
            value={start}
            onChange={(event) =>
              updateStart(
                event.target.value
              )
            }
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
            onChange={(event) =>
              updateEnd(
                event.target.value
              )
            }
            required
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2"
          />
        </label>
      </div>

      {scopeOptions.length >
      1 ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">
            Omfang
          </legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {scopeOptions.map(
              (option) => (
                <label
                  key={
                    option.value
                  }
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name={`scope-${event.id}`}
                    value={
                      option.value
                    }
                    checked={
                      scope ===
                      option.value
                    }
                    onChange={() =>
                      updateScope(
                        option.value
                      )
                    }
                  />
                  {option.label}
                </label>
              )
            )}
          </div>
        </fieldset>
      ) : null}

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
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle
              size={15}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : (
            <Move
              size={15}
              aria-hidden="true"
            />
          )}
          {pending
            ? "Flytter…"
            : "Flyt begivenhed"}
        </button>
      </div>
    </form>
  );
}
