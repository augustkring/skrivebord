"use client";

import {
  LoaderCircle,
  RefreshCw,
  Send,
  X
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

type RuntimeStatus =
  | "LOADING"
  | "READY"
  | "RUNNING"
  | "UNAVAILABLE"
  | "NOT_PROVISIONED"
  | "ERROR";

type DisplayMessage = {
  id?: string;
  role:
    | "user"
    | "assistant"
    | "system"
    | "tool";
  text: string;
  timestamp?: string;
};

type HistoryResponse = {
  status?: string;
  humanSummary?: string;
  messages?: DisplayMessage[];
  running?: boolean;
  runId?: string | null;
};

export function MojnPanel({
  open,
  onClose,
  route,
  workspace,
  workspaceSlug
}: {
  open: boolean;
  onClose: () => void;
  route: string;
  workspace: string;
  workspaceSlug: string;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] =
    useState<RuntimeStatus>("LOADING");
  const [statusText, setStatusText] =
    useState("Kontrollerer Mojn…");
  const [messages, setMessages] =
    useState<DisplayMessage[]>([]);
  const [sending, setSending] =
    useState(false);
  const [pendingRunId, setPendingRunId] =
    useState<string | null>(null);
  const [error, setError] =
    useState("");
  const scrollRef =
    useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(
    async () => {
      const response = await fetch(
        `/api/agent/status?workspaceSlug=${encodeURIComponent(workspaceSlug)}`,
        {
          cache: "no-store"
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

      if (
        response.ok &&
        result?.status === "READY"
      ) {
        setStatus("READY");
        setStatusText(
          result.humanSummary ??
            "Mojn kører normalt."
        );
        return true;
      }

      if (
        result?.status ===
        "NOT_PROVISIONED"
      ) {
        setStatus("NOT_PROVISIONED");
        setStatusText(
          result.humanSummary ??
            "Mojn er ikke provisioneret endnu."
        );
        return false;
      }

      setStatus("UNAVAILABLE");
      setStatusText(
        result?.humanSummary ??
          "Mojn kan ikke kontaktes lige nu."
      );
      return false;
    },
    [workspaceSlug]
  );

  const loadHistory = useCallback(
    async () => {
      const query =
        new URLSearchParams({
          workspaceSlug,
          route
        });

      const response = await fetch(
        `/api/agent/history?${query.toString()}`,
        {
          cache: "no-store"
        }
      );

      const result = (await response
        .json()
        .catch(() => null)) as
        | HistoryResponse
        | null;

      if (
        response.ok &&
        result?.status === "READY"
      ) {
        setMessages(
          result.messages ?? []
        );

        if (result.running) {
          setPendingRunId(
            result.runId ?? null
          );
          setStatus("RUNNING");
          setStatusText(
            "Mojn arbejder…"
          );
        } else {
          setPendingRunId(null);
          setStatus("READY");
          setStatusText(
            "Mojn kører normalt."
          );
        }

        return Boolean(
          result.running
        );
      }

      if (
        result?.status ===
        "NOT_PROVISIONED"
      ) {
        setStatus("NOT_PROVISIONED");
        setStatusText(
          result.humanSummary ??
            "Mojn er ikke klar endnu."
        );
        return false;
      }

      if (response.status === 503) {
        setStatus("UNAVAILABLE");
        setStatusText(
          result?.humanSummary ??
            "Mojn kan ikke kontaktes lige nu."
        );
      }

      return false;
    },
    [route, workspaceSlug]
  );

  const refresh = useCallback(
    async () => {
      setError("");
      setStatus("LOADING");
      setStatusText(
        "Kontrollerer Mojn…"
      );

      const ready =
        await loadStatus();

      if (ready) {
        await loadHistory();
      }
    },
    [loadHistory, loadStatus]
  );

  useEffect(() => {
    if (!open) return;

    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (
      !open ||
      status !== "RUNNING"
    ) {
      return;
    }

    const timer = window.setInterval(
      () => {
        void (async () => {
          if (!pendingRunId) {
            await loadHistory();
            return;
          }

          const query =
            new URLSearchParams({
              workspaceSlug,
              runId: pendingRunId
            });

          const response = await fetch(
            `/api/agent/run?${query.toString()}`,
            {
              cache: "no-store"
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

          if (
            result?.status === "SUCCEEDED"
          ) {
            setPendingRunId(null);
            setStatus("READY");
            setStatusText(
              "Mojn kører normalt."
            );
            await loadHistory();
            return;
          }

          if (
            result?.status === "FAILED" ||
            result?.status === "CANCELLED"
          ) {
            setPendingRunId(null);
            setStatus("ERROR");
            setStatusText(
              result.humanSummary ??
                "Mojn kunne ikke færdiggøre opgaven."
            );
            setError(
              result.humanSummary ??
                "Mojn kunne ikke færdiggøre opgaven."
            );
            await loadHistory();
            return;
          }

          if (
            result?.status === "UNAVAILABLE"
          ) {
            setStatus("UNAVAILABLE");
            setStatusText(
              result.humanSummary ??
                "Mojn kan ikke kontaktes lige nu."
            );
          }
        })();
      },
      2500
    );

    return () => {
      window.clearInterval(timer);
    };
  }, [
    loadHistory,
    open,
    pendingRunId,
    status,
    workspaceSlug
  ]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top:
        scrollRef.current
          .scrollHeight,
      behavior: "smooth"
    });
  }, [messages, sending, status]);

  async function sendMessage(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const message = value.trim();
    if (
      !message ||
      sending ||
      status === "UNAVAILABLE" ||
      status ===
        "NOT_PROVISIONED"
    ) {
      return;
    }

    setSending(true);
    setError("");
    setValue("");

    const optimistic: DisplayMessage = {
      id:
        `local:${crypto.randomUUID()}`,
      role: "user",
      text: message
    };

    setMessages((current) => [
      ...current,
      optimistic
    ]);

    try {
      const response = await fetch(
        "/api/agent/message",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json"
          },
          body: JSON.stringify({
            workspaceSlug,
            message,
            route,
            idempotencyKey:
              crypto.randomUUID()
          })
        }
      );

      const result = (await response
        .json()
        .catch(() => null)) as
        | {
            status?: string;
            humanSummary?: string;
            reply?: string | null;
            runId?: string;
          }
        | null;

      if (
        result?.status === "RUNNING"
      ) {
        setPendingRunId(
          result.runId ?? null
        );
        setStatus("RUNNING");
        setStatusText(
          result.humanSummary ??
            "Mojn arbejder…"
        );
        return;
      }

      if (
        response.ok &&
        result?.status ===
          "SUCCEEDED"
      ) {
        setPendingRunId(null);
        setStatus("READY");
        setStatusText(
          "Mojn kører normalt."
        );

        if (result.reply) {
          setMessages(
            (current) => [
              ...current,
              {
                id:
                  `local:${crypto.randomUUID()}`,
                role: "assistant",
                text: result.reply ?? ""
              }
            ]
          );
        } else {
          await loadHistory();
        }

        return;
      }

      if (
        result?.status ===
        "UNAVAILABLE"
      ) {
        setPendingRunId(null);
        setStatus("UNAVAILABLE");
        setStatusText(
          result.humanSummary ??
            "Mojn kan ikke kontaktes lige nu."
        );
      }

      setError(
        result?.humanSummary ??
          "Beskeden kunne ikke sendes."
      );
    } catch {
      setStatus("UNAVAILABLE");
      setStatusText(
        "Mojn kan ikke kontaktes lige nu."
      );
      setError(
        "Beskeden kunne ikke sendes."
      );
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const readyToSend =
    status === "READY" ||
    status === "RUNNING";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/20"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mojn"
        className="ml-auto flex h-full w-full max-w-[440px] flex-col border-l border-[var(--border-default)] bg-[var(--surface-raised)] shadow-xl"
      >
        <header className="flex items-start justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div>
            <div className="font-semibold">
              Mojn
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <span
                className={
                  "h-2 w-2 rounded-full " +
                  (status === "READY"
                    ? "bg-[var(--status-success)]"
                    : status === "RUNNING" ||
                        status === "LOADING"
                      ? "bg-[var(--status-warning)]"
                      : "bg-[var(--status-critical)]")
                }
                aria-hidden="true"
              />
              <span>{statusText}</span>
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {workspace}
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-md p-2 hover:bg-[var(--surface-muted)]"
            aria-label="Luk Mojn"
          >
            <X size={18} />
          </button>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto px-5 py-5"
          aria-live="polite"
        >
          {status === "LOADING" ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <LoaderCircle
                size={16}
                className="animate-spin"
                aria-hidden="true"
              />
              Henter Mojn…
            </div>
          ) : null}

          {status ===
            "NOT_PROVISIONED" ? (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
              Mojn er ikke provisioneret til dette workspace endnu. En owner kan gøre det under Indstillinger.
            </div>
          ) : null}

          {status ===
            "UNAVAILABLE" ? (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-muted)] p-4">
              <div className="font-medium">
                Mojn kræver opmærksomhed
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                Mojn kan ikke kontaktes lige nu. Kalender og øvrige data fungerer stadig.
              </p>
              <button
                type="button"
                onClick={() => {
                  void refresh();
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold"
              >
                <RefreshCw
                  size={15}
                  aria-hidden="true"
                />
                Prøv igen
              </button>
            </div>
          ) : null}

          {readyToSend &&
          messages.length === 0 ? (
            <div className="rounded-lg bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
              Jeg har kontekst fra{" "}
              <strong>{route}</strong>.
              Hvad vil du have mig til at hjælpe med?
            </div>
          ) : null}

          {messages.length > 0 ? (
            <div className="space-y-4">
              {messages.map(
                (message, index) => (
                  <article
                    key={
                      message.id ??
                      `${message.role}:${index}`
                    }
                    className={
                      message.role ===
                      "user"
                        ? "ml-8 rounded-lg bg-[var(--action-primary)] px-4 py-3 text-sm leading-6 text-white"
                        : "mr-8 rounded-lg bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--text-primary)]"
                    }
                  >
                    {message.text}
                  </article>
                )
              )}

              {status ===
                "RUNNING" ? (
                <div className="mr-8 flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  <LoaderCircle
                    size={15}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  Mojn arbejder…
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p
              className="mt-4 text-sm leading-6 text-[var(--status-critical)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <form
          className="border-t border-[var(--border-default)] p-4"
          onSubmit={sendMessage}
        >
          <label
            htmlFor="mojn-message"
            className="sr-only"
          >
            Skriv til Mojn
          </label>
          <textarea
            id="mojn-message"
            value={value}
            onChange={(event) =>
              setValue(
                event.target.value
              )
            }
            placeholder={
              readyToSend
                ? "Bed Mojn om noget…"
                : "Mojn er ikke tilgængelig"
            }
            rows={3}
            disabled={!readyToSend}
            className="w-full resize-none rounded-lg border border-[var(--border-strong)] bg-white p-3 text-sm outline-none disabled:bg-[var(--surface-muted)]"
          />
          <div className="mt-3 flex justify-end">
            <button
              disabled={
                !value.trim() ||
                sending ||
                !readyToSend
              }
              className="inline-flex items-center gap-2 rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {sending ? (
                <LoaderCircle
                  size={15}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Send
                  size={15}
                  aria-hidden="true"
                />
              )}
              Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
