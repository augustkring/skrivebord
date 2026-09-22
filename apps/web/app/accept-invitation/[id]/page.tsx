"use client";

import { CheckCircle2, Mail } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type State = "CHECKING" | "READY" | "ACCEPTING" | "ERROR" | "DONE";

export default function AcceptInvitationPage() {
  const params = useParams<{ id: string }>();
  const invitationId = params.id;
  const [state, setState] = useState<State>("CHECKING");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const { data } = await authClient.getSession();
      if (cancelled) return;

      if (!data?.session) {
        const next = `/accept-invitation/${encodeURIComponent(invitationId)}`;
        window.location.replace(`/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }

      setState("READY");
    }

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  async function accept() {
    setState("ACCEPTING");
    setMessage("");

    const { error } = await authClient.organization.acceptInvitation({
      invitationId
    });

    if (error) {
      setState("ERROR");
      setMessage("Invitationen kunne ikke accepteres. Den kan være udløbet eller tilhøre en anden e-mail.");
      return;
    }

    const { data: organizations } = await authClient.organization.list();
    const destination = organizations?.[0]?.slug
      ? `/${organizations[0].slug}/today`
      : "/";

    setState("DONE");
    setMessage("Invitationen er accepteret.");
    window.location.replace(destination);
  }

  return (
    <main className="min-h-screen bg-[var(--surface-base)] px-5 py-12 sm:py-20">
      <section className="mx-auto w-full max-w-[460px]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Skrivebord
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
          Invitation
        </h1>

        {state === "CHECKING" ? (
          <p className="mt-4 text-sm text-[var(--text-secondary)]" role="status">
            Kontrollerer din session…
          </p>
        ) : null}

        {state === "READY" || state === "ACCEPTING" ? (
          <div className="mt-8 rounded-lg border border-[var(--border-default)] bg-white p-5">
            <div className="flex items-start gap-3">
              <Mail size={20} className="mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">Bliv medlem af workspace</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  Når du accepterer, får din konto adgang med den rolle, invitationen er oprettet med.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={accept}
              disabled={state === "ACCEPTING"}
              className="mt-5 w-full rounded-md bg-[var(--action-primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-50"
            >
              {state === "ACCEPTING" ? "Accepterer…" : "Accepter invitation"}
            </button>
          </div>
        ) : null}

        {state === "DONE" ? (
          <div className="mt-8 flex items-center gap-3 text-sm text-[var(--status-success)]" role="status">
            <CheckCircle2 size={20} aria-hidden="true" />
            {message}
          </div>
        ) : null}

        {state === "ERROR" ? (
          <p className="mt-6 text-sm leading-6 text-[var(--status-critical)]" role="alert">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
