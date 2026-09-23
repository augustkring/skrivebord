"use client";

import {
  Check,
  LoaderCircle,
  X
} from "lucide-react";
import {
  useRouter
} from "next/navigation";
import {
  useState
} from "react";

export function ApprovalCard({
  approval,
  workspaceSlug,
  canResolve
}: {
  approval: {
    id: string;
    humanSummary: string;
    consequenceSummary: string;
    reversibility: string;
    requestedByPrincipalType: string;
    expiresAt: string;
  };
  workspaceSlug: string;
  canResolve: boolean;
}) {
  const router =
    useRouter();
  const [pending, setPending] =
    useState<
      "APPROVE" |
      "REJECT" |
      null
    >(null);
  const [message, setMessage] =
    useState("");

  async function decide(
    decision:
      | "APPROVE"
      | "REJECT"
  ) {
    setPending(decision);
    setMessage("");

    const response = await fetch(
      `/api/approvals/${approval.id}/decision`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json"
        },
        body: JSON.stringify({
          workspaceSlug,
          decision
        })
      }
    );

    const result = (await response
      .json()
      .catch(() => null)) as
      | {
          status?: string;
          humanSummary?: string;
        }
      | null;

    if (!response.ok) {
      setMessage(
        result?.humanSummary ??
          "Godkendelsen kunne ikke behandles."
      );
      setPending(null);
      return;
    }

    setMessage(
      result?.humanSummary ??
        (decision === "APPROVE"
          ? "Handlingen er godkendt."
          : "Handlingen er afvist.")
    );
    setPending(null);
    router.refresh();
  }

  const expires =
    new Intl.DateTimeFormat(
      "da-DK",
      {
        dateStyle: "short",
        timeStyle: "short"
      }
    ).format(
      new Date(
        approval.expiresAt
      )
    );

  return (
    <article className="border-b border-[var(--border-default)] py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--status-warning)]">
            Afventer godkendelse
          </div>
          <h3 className="mt-2 font-semibold">
            {approval.humanSummary}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            {approval.consequenceSummary}
          </p>
          <div className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            Anmodet af{" "}
            {approval.requestedByPrincipalType ===
            "AGENT"
              ? "Mojn"
              : "en bruger"}
            {" · "}
            {approval.reversibility ===
            "REVERSIBLE"
              ? "Kan fortrydes"
              : approval.reversibility ===
                  "PARTIALLY_REVERSIBLE"
                ? "Delvist reversibel"
                : "Kan ikke fortrydes"}
            {" · "}
            Udløber {expires}
          </div>
        </div>

        {canResolve ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={
                pending !== null
              }
              onClick={() => {
                void decide(
                  "REJECT"
                );
              }}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {pending ===
              "REJECT" ? (
                <LoaderCircle
                  size={15}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <X
                  size={15}
                  aria-hidden="true"
                />
              )}
              Afvis
            </button>

            <button
              type="button"
              disabled={
                pending !== null
              }
              onClick={() => {
                void decide(
                  "APPROVE"
                );
              }}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--action-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ===
              "APPROVE" ? (
                <LoaderCircle
                  size={15}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Check
                  size={15}
                  aria-hidden="true"
                />
              )}
              Godkend
            </button>
          </div>
        ) : null}
      </div>

      {message ? (
        <p
          className="mt-3 text-sm text-[var(--text-secondary)]"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </article>
  );
}
