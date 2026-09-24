import {
  listYearPlanItems,
  withPrincipalTransaction
} from "@skrivebord/database";
import { redirect } from "next/navigation";
import { databasePool } from "@/lib/database";
import { resolveWorkspaceHumanPrincipal } from "@/lib/principal";
import { PageTitle } from "../_components/page-title";

export const dynamic = "force-dynamic";

const months = [
  "Januar",
  "Februar",
  "Marts",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "December"
];

export default async function YearPage({
  params
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (!principal) redirect("/sign-in");

  const items = await withPrincipalTransaction(
    databasePool,
    principal,
    ({ db }) => listYearPlanItems(db, principal.workspaceId)
  );

  const now = new Date();
  const currentMonth = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Copenhagen",
      month: "numeric"
    }).format(now)
  );

  return (
    <>
      <PageTitle
        title="År"
        subtitle="Tilbagevendende og sæsonbestemt arbejde på tværs af året."
      />

      <div className="space-y-2">
        {months.map((month, index) => {
          const monthNumber = index + 1;
          const monthItems = items.filter(
            (item) => item.month === monthNumber
          );
          const current = monthNumber === currentMonth;

          return (
            <section
              key={month}
              className={
                "rounded-lg border " +
                (current
                  ? "border-[var(--border-strong)] bg-white"
                  : "border-[var(--border-default)]")
              }
            >
              <div className="flex items-center justify-between px-4 py-3">
                <h2 className="font-semibold">{month}</h2>
                <span className="text-sm text-[var(--text-muted)]">
                  {monthItems.length === 1
                    ? "1 aktivitet"
                    : monthItems.length > 1
                      ? `${monthItems.length} aktiviteter`
                      : "Ingen aktiviteter"}
                </span>
              </div>

              {(current || monthItems.length > 0) &&
                monthItems.map((item) => (
                  <div
                    key={item.id}
                    className="border-t border-[var(--border-default)] px-4 py-4"
                  >
                    <div className="font-medium">{item.title}</div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">
                      {item.description}
                    </div>
                    <div className="mt-2 text-xs text-[var(--text-muted)]">
                      Vindue: {item.windowStartDay}.–{item.windowEndDay}. {month.toLowerCase()}
                    </div>
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
