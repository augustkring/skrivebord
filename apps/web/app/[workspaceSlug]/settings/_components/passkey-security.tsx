"use client";

import { CheckCircle2, KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt?: Date | string;
};

export function PasskeySecurity() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [state, setState] = useState<"LOADING" | "READY" | "ADDING" | "ERROR">("LOADING");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys();

    if (error) {
      setState("ERROR");
      setMessage("Passkeys kunne ikke hentes.");
      return;
    }

    setPasskeys((data ?? []) as PasskeyRow[]);
    setState("READY");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addPasskey() {
    setState("ADDING");
    setMessage("");

    const { error } = await authClient.passkey.addPasskey({
      name: "Primær passkey",
      authenticatorAttachment: "platform"
    });

    if (error) {
      setState("ERROR");
      setMessage("Passkey kunne ikke tilføjes. Prøv igen fra denne enhed.");
      return;
    }

    setMessage("Passkey er tilføjet.");
    await refresh();
  }

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-white p-4">
      <div className="flex items-start gap-3">
        <KeyRound size={19} className="mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Passkey</div>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Brug en passkey som din foretrukne, phishing-resistente loginmetode.
          </p>

          {state === "LOADING" ? (
            <p className="mt-3 text-sm text-[var(--text-muted)]" role="status">
              Henter passkeys…
            </p>
          ) : null}

          {state !== "LOADING" && passkeys.length > 0 ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-[var(--status-success)]">
              <CheckCircle2 size={16} aria-hidden="true" />
              {passkeys.length === 1
                ? "1 passkey er registreret"
                : `${passkeys.length} passkeys er registreret`}
            </div>
          ) : null}

          {state !== "LOADING" && passkeys.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--status-warning)]">
              Ingen passkey er registreret endnu.
            </p>
          ) : null}

          <button
            type="button"
            onClick={addPasskey}
            disabled={state === "ADDING" || state === "LOADING"}
            className="mt-4 rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"
          >
            {state === "ADDING"
              ? "Tilføjer…"
              : passkeys.length > 0
                ? "Tilføj endnu en passkey"
                : "Tilføj passkey"}
          </button>

          {message ? (
            <p
              className={"mt-3 text-sm " + (state === "ERROR" ? "text-[var(--status-critical)]" : "text-[var(--status-success)]")}
              role={state === "ERROR" ? "alert" : "status"}
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
