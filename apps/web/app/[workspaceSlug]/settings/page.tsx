import { PageTitle } from "../_components/page-title";
import { PasskeySecurity } from "./_components/passkey-security";

const sections = [
  ["Workspace", "AlsLeben · Dansk · Europe/Copenhagen"],
  ["Connections", "Google Calendar · klar til connectorfase"],
  ["Mojn", "Aktiveret · business capabilities håndhæves i Action Layer"],
  ["Usage", "Viser kun autoritative målinger når runtime/provider-data findes"]
] as const;

export default function SettingsPage() {
  return (
    <>
      <PageTitle
        title="Indstillinger"
        subtitle="Sikkerhed og agentautoritet er eksplicitte produktindstillinger, ikke skjulte runtime-detaljer."
      />

      <div className="divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
        {sections.slice(0, 3).map(([title, detail]) => (
          <section key={title} className="py-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
              {detail}
            </p>
          </section>
        ))}

        <section className="py-5">
          <h2 className="font-semibold">Access & Security</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Owner / Member / Viewer. Følsomme ændringer skal bruge frisk step-up-verifikation.
          </p>
          <PasskeySecurity />
        </section>

        {sections.slice(3).map(([title, detail]) => (
          <section key={title} className="py-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
              {detail}
            </p>
          </section>
        ))}
      </div>
    </>
  );
}
