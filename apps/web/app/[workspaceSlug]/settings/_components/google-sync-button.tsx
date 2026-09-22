"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function GoogleSyncButton({
  workspaceSlug
}: {
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    "IDLE" | "SYNCING" | "ERROR"
  >("IDLE");
  const [message, setMessage] = useState("");

  async function sync() {
    setState("SYNCING");
    setMessage("");

    const response = await fetch(
      "/api/connections/google/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          workspaceSlug
        })
      }
    );

    const result = (await response.json().catch(() => null)) as
      | {
          status?: string;
          humanSummary?: string;
          data?: {
            calendarsSucceeded?: number;
            calendarsFailed?: number;
            eventsSeen?: number;
          };
        }
      | null;

    if (
      !response.ok ||
      result?.status !== "SUCCEEDED"
    ) {
      setState("ERROR");
      setMessage(
        result?.humanSummary ??
          "Google Calendar kunne ikke synkroniseres."
      );
      return;
    }

    setState("IDLE");
    setMessage(
      `${result.data?.calendarsSucceeded ?? 0} kalendere synkroniseret · ${result.data?.eventsSeen ?? 0} events behandlet.`
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={state === "SYNCING"}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"
      >
        {state === "SYNCING" ? (
          <LoaderCircle
            size={15}
            className="animate-spin"
            aria-hidden="true"
          />
        ) : (
          <RefreshCw size={15} aria-hidden="true" />
        )}
        {state === "SYNCING"
          ? "Synkroniserer…"
          : "Synkronisér nu"}
      </button>

      {message ? (
        <p
          className={
            "max-w-64 text-xs leading-5 " +
            (state === "ERROR"
              ? "text-[var(--status-critical)]"
              : "text-[var(--status-success)]")
          }
          role={state === "ERROR" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
