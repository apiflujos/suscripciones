import { AppearanceSelector } from "../ui/AppearanceSelector";

export const dynamic = "force-dynamic";

export default function AppearancePage() {
  return (
    <main className="page pageWide">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "grid", gap: 4 }}>
              <h3>Apariencia</h3>
              <div className="field-hint">Tema, visión y contraste.</div>
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <AppearanceSelector cards />
        </div>
      </section>
    </main>
  );
}
