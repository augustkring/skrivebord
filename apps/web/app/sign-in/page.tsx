"use client";

import { KeyRound, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"IDLE" | "SENDING" | "SENT" | "ERROR" | "PASSKEY">("IDLE");
  const [message, setMessage] = useState("");

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("SENDING");
    setMessage("");

    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/alsleben/today",
      errorCallbackURL: "/sign-in?error=magic-link"
    });

    if (error) {
      setState("ERROR");
      setMessage("Login-linket kunne ikke sendes. Prøv igen.");
      return;
    }

    setState("SENT");
    setMessage("Tjek din mail. Linket udløber efter 15 minutter.");
  }

  async function signInWithPasskey() {
    setState("PASSKEY");
    setMessage("");

    const result = await authClient.signIn.passkey({
      fetchOptions: {
        onSuccess() {
          window.location.href = "/alsleben/today";
        }
      }
    });

    if (result?.error) {
      setState("ERROR");
      setMessage("Passkey-login kunne ikke gennemføres.");
    }
  }

  return (
    <main className="min-h-screen bg-[var(--surface-base)] px-5 py-12 sm:py-20">
      <section className="mx-auto w-full max-w-[420px]">
        <div className="mb-10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Skrivebord
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
            Log ind
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            Brug din passkey, eller få et sikkert login-link på mail.
          </p>
        </div>

        <button
          type="button"
          onClick={signInWithPasskey}
          disabled={state === "PASSKEY"}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--action-primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-50"
        >
          <KeyRound size={17} aria-hidden="true" />
          {state === "PASSKEY" ? "Åbner passkey…" : "Fortsæt med passkey"}
        </button>

        <div className="my-6 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-[var(--border-default)]" />
          <span className="text-xs text-[var(--text-muted)]">eller</span>
          <div className="h-px flex-1 bg-[var(--border-default)]" />
        </div>

        <form onSubmit={sendMagicLink}>
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email webauthn"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="navn@virksomhed.dk"
            className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-3 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={state === "SENDING" || !email.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-4 py-3 text-sm font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"
          >
            <Mail size={17} aria-hidden="true" />
            {state === "SENDING" ? "Sender…" : "Send login-link"}
          </button>
        </form>

        {message ? (
          <p
            role={state === "ERROR" ? "alert" : "status"}
            className={"mt-4 text-sm leading-6 " + (state === "ERROR" ? "text-[var(--status-critical)]" : "text-[var(--text-secondary)]")}
          >
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
