"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CompleteWorkButton({
  workspaceSlug,
  workItemId
}: {
  workspaceSlug: string;
  workItemId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"IDLE" | "SAVING" | "ERROR">("IDLE");
  const [message, setMessage] = useState("");

  async function complete() {
    setState("SAVING");
    setMessage("");

    const response = await fetch("/api/actions/today/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceSlug,
        workItemId
      })
    });

    const result = (await response.json().catch(() => null)) as
      | { status?: string; humanSummary?: string }
      | null;

    if (!response.ok || result?.status !== "SUCCEEDED") {
      setState("ERROR");
      setMessage(
        result?.humanSummary ??
          "Arbejdet kunne ikke markeres som færdigt."
      );
      return;
    }

    setState("IDLE");
    router.refresh();
  }

  return (
    <div className="justify-self-start sm:justify-self-end">
      <button
        type="button"
        onClick={complete}
        disabled={state === "SAVING"}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"
      >
        {state === "SAVING" ? (
          <LoaderCircle
            size={15}
            className="animate-spin"
            aria-hidden="true"
          />
        ) : (
          <Check size={15} aria-hidden="true" />
        )}
        {state === "SAVING" ? "Gemmer…" : "Markér færdig"}
      </button>

      {state === "ERROR" ? (
        <p
          className="mt-2 max-w-56 text-xs leading-5 text-[var(--status-critical)]"
          role="alert"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
