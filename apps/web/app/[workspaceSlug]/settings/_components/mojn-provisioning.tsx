"use client";

import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle
} from "lucide-react";
import { useState } from "react";

type ExistingAgent = {
  agentId: string;
  name: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  capabilities: string[];
} | null;

type ProvisionedAgent = {
  agentId: string;
  name: string;
  apiKey: string;
  apiKeyId: string;
  expiresAt: string | null;
  capabilities: string[];
};

export function MojnProvisioning({
  workspaceSlug,
  existing,
  canManage
}: {
  workspaceSlug: string;
  existing: ExistingAgent;
  canManage: boolean;
}) {
  const [state, setState] = useState<
    "IDLE" | "PROVISIONING" | "READY" | "ERROR"
  >("IDLE");
  const [provisioned, setProvisioned] =
    useState<ProvisionedAgent | null>(null);
  const [message, setMessage] = useState("");

  async function provision() {
    setState("PROVISIONING");
    setMessage("");

    const response = await fetch(
      "/api/agents/mojn/provision",
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

    const result = (await response
      .json()
      .catch(() => null)) as
      | {
          status?: string;
          humanSummary?: string;
          data?: ProvisionedAgent;
        }
      | null;

    if (
      !response.ok ||
      result?.status !== "SUCCEEDED" ||
      !result.data
    ) {
      setState("ERROR");
      setMessage(
        result?.humanSummary ??
          "Mojn kunne ikke provisioneres."
      );
      return;
    }

    setProvisioned(result.data);
    setState("READY");
    setMessage(
      "Credential er oprettet. Kopiér den nu. Den vises ikke igen."
    );
  }

  async function copyKey() {
    if (!provisioned?.apiKey) return;

    await navigator.clipboard.writeText(
      provisioned.apiKey
    );
    setMessage(
      "Credential er kopieret."
    );
  }

  const active:
    | {
        agentId: string;
        name: string;
        expiresAt: string | null;
        lastUsedAt: string | null;
        capabilities: string[];
      }
    | null = provisioned
      ? {
          agentId: provisioned.agentId,
          name: provisioned.name,
          expiresAt: provisioned.expiresAt,
          lastUsedAt: null,
          capabilities: provisioned.capabilities
        }
      : existing;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-white p-4">
      <div className="flex items-start gap-3">
        <KeyRound
          size={19}
          className="mt-0.5"
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="font-medium">
            Mojn credential
          </div>

          {active ? (
            <>
              <div className="mt-2 flex items-center gap-2 text-sm text-[var(--status-success)]">
                <Check
                  size={16}
                  aria-hidden="true"
                />
                Aktiv agent-binding
              </div>

              <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                <div>
                  Agent: {active.name}
                </div>
                <div>
                  Capabilities:{" "}
                  {active.capabilities.join(", ")}
                </div>
                {active.expiresAt ? (
                  <div>
                    Udløber:{" "}
                    {new Intl.DateTimeFormat(
                      "da-DK",
                      {
                        dateStyle: "medium",
                        timeStyle: "short"
                      }
                    ).format(
                      new Date(
                        active.expiresAt
                      )
                    )}
                  </div>
                ) : null}
                {active.lastUsedAt ? (
                  <div>
                    Sidst brugt:{" "}
                    {new Intl.DateTimeFormat(
                      "da-DK",
                      {
                        dateStyle: "short",
                        timeStyle: "short"
                      }
                    ).format(
                      new Date(
                        active.lastUsedAt
                      )
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Mojn har endnu ikke en bound API credential til MCP.
            </p>
          )}

          {provisioned?.apiKey ? (
            <div className="mt-4 rounded-md border border-[var(--border-strong)] bg-[var(--surface-muted)] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Vises kun nu
              </div>
              <code className="mt-2 block break-all text-xs leading-5">
                {provisioned.apiKey}
              </code>
              <button
                type="button"
                onClick={copyKey}
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold"
              >
                <Clipboard
                  size={15}
                  aria-hidden="true"
                />
                Kopiér credential
              </button>
            </div>
          ) : null}

          {!active && canManage ? (
            <button
              type="button"
              onClick={provision}
              disabled={
                state ===
                "PROVISIONING"
              }
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {state ===
              "PROVISIONING" ? (
                <LoaderCircle
                  size={15}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <KeyRound
                  size={15}
                  aria-hidden="true"
                />
              )}
              {state ===
              "PROVISIONING"
                ? "Provisionerer…"
                : "Provisionér Mojn"}
            </button>
          ) : null}

          {message ? (
            <p
              className={
                "mt-3 text-xs leading-5 " +
                (state === "ERROR"
                  ? "text-[var(--status-critical)]"
                  : "text-[var(--text-secondary)]")
              }
              role={
                state === "ERROR"
                  ? "alert"
                  : "status"
              }
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
