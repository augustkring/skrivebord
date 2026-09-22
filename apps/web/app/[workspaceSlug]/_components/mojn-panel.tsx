"use client";

import { X } from "lucide-react";
import { useState } from "react";

export function MojnPanel({ open, onClose, route, workspace }: { open: boolean; onClose: () => void; route: string; workspace: string }) {
  const [value, setValue] = useState("");
  if (!open) return null;
  return <div className="fixed inset-0 z-50 bg-black/20" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Mojn" className="ml-auto flex h-full w-full max-w-[440px] flex-col border-l border-[var(--border-default)] bg-[var(--surface-raised)] shadow-xl">
      <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4"><div><div className="font-semibold">Mojn</div><div className="text-sm text-[var(--text-secondary)]">Kører normalt · {workspace}</div></div><button onClick={onClose} className="rounded-md p-2 hover:bg-[var(--surface-muted)]" aria-label="Luk Mojn"><X size={18}/></button></header>
      <div className="flex-1 overflow-auto px-5 py-5"><div className="rounded-lg bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--text-secondary)]">Jeg har kontekst fra <strong>{route}</strong>. I denne første build er samtalefladen klar, mens OpenClaw Gateway og MCP kobles på efter Action Layer og tenancy er valideret.</div></div>
      <form className="border-t border-[var(--border-default)] p-4" onSubmit={(event) => { event.preventDefault(); setValue(""); }}><label htmlFor="mojn-message" className="sr-only">Skriv til Mojn</label><textarea id="mojn-message" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Bed Mojn om noget…" rows={3} className="w-full resize-none rounded-lg border border-[var(--border-strong)] bg-white p-3 text-sm outline-none"/><div className="mt-3 flex justify-end"><button disabled={!value.trim()} className="rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Send</button></div></form>
    </section>
  </div>;
}
