"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarDays, CircleAlert, Settings, Sparkles, Sun, Workflow } from "lucide-react";
import { useState } from "react";
import { MojnPanel } from "./mojn-panel";

const nav = [
  { href: "today", label: "I dag", icon: Sun },
  { href: "calendar", label: "Kalender", icon: CalendarDays },
  { href: "year", label: "År", icon: Workflow },
  { href: "attention", label: "Opmærksomhed", icon: CircleAlert, badge: "2" },
  { href: "activity", label: "Aktivitet", icon: Activity }
];

export function AppShell({ workspaceSlug, children }: { workspaceSlug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mojnOpen, setMojnOpen] = useState(false);
  const workspaceName = workspaceSlug === "alsleben" ? "AlsLeben" : workspaceSlug;
  return <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
    <aside className="border-b border-[var(--border-default)] bg-[var(--surface-raised)] lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
      <div className="flex h-16 items-center justify-between px-5 lg:h-20"><div><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Skrivebord</div><div className="mt-1 font-semibold">{workspaceName}</div></div><button className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm lg:hidden" onClick={() => setMojnOpen(true)}>Mojn</button></div>
      <nav aria-label="Primær" className="hidden px-3 lg:block">{nav.map((item) => { const Icon = item.icon; const href = `/${workspaceSlug}/${item.href}`; const active = pathname === href; return <Link key={item.href} href={href} aria-current={active ? "page" : undefined} className={`mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-[var(--surface-muted)] font-semibold" : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"}`}><Icon size={18} aria-hidden="true"/><span>{item.label}</span>{item.badge ? <span className="ml-auto rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{item.badge}</span> : null}</Link>; })}
        <div className="my-4 border-t border-[var(--border-default)]"/>
        <button onClick={() => setMojnOpen(true)} className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"><Sparkles size={18} aria-hidden="true"/><span>Mojn</span><span className="ml-auto h-2 w-2 rounded-full bg-[var(--text-muted)]" aria-label="Åbn Mojn for status"/></button>
        <Link href={`/${workspaceSlug}/settings`} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${pathname.endsWith("/settings") ? "bg-[var(--surface-muted)] font-semibold" : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"}`}><Settings size={18} aria-hidden="true"/> Indstillinger</Link>
      </nav>
    </aside>
    <main className="min-w-0"><div className="mx-auto w-full max-w-[1180px] px-5 py-7 sm:px-8 lg:px-10 lg:py-10">{children}</div></main>
    <MojnPanel open={mojnOpen} onClose={() => setMojnOpen(false)} route={pathname} workspace={workspaceName} workspaceSlug={workspaceSlug}/>
  </div>;
}
