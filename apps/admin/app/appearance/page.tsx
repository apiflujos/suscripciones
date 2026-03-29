import { AppearanceSelector } from "../ui/AppearanceSelector";

export const dynamic = "force-dynamic";

export default function AppearancePage() {
  return (
    <main className="page pageWide">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Apariencia</h3>
            <div className="field-hint">Claro, oscuro, alto contraste y accesibilidad.</div>
          </div>
        </div>
        <div className="settings-group-body">
          <AppearanceSelector cards />
        </div>
      </section>
    </main>
  );
}
