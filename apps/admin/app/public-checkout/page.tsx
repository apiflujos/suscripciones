import {
  createPublicCheckoutTemplate,
  deactivatePublicCheckoutTemplate,
  updatePublicCheckoutDefaults,
  updatePublicCheckoutTemplate
} from "./actions";
import { fetchAdminCached } from "../lib/adminApi";
import { getCsrfToken } from "../lib/csrf";
import { PublicCheckoutTemplatesPanel } from "./PublicCheckoutTemplatesPanel";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";

export const dynamic = "force-dynamic";

async function fetchTemplates() {
  return fetchAdminCached("/admin/public-checkout/templates", { ttlMs: 1500 });
}

async function fetchPlans() {
  return fetchAdminCached("/admin/plans?take=200", { ttlMs: 1500 });
}

async function fetchSettings() {
  return fetchAdminCached("/admin/settings", { ttlMs: 1500 });
}

export default async function PublicCheckoutPage({
  searchParams
}: {
  searchParams?: Promise<{ a?: string; status?: string; error?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const [templatesRes, plansRes, settingsRes] = await Promise.all([fetchTemplates(), fetchPlans(), fetchSettings()]);
  const templates = templatesRes.ok ? templatesRes.json?.items || [] : [];
  const plans = plansRes.ok ? plansRes.json?.items || [] : [];
  const settings = settingsRes.ok ? settingsRes.json : null;
  const publicCheckout = (settings?.publicCheckout || {}) as any;

  const sp = (await searchParams) ?? {};
  const action = String(sp.a || "");
  const status = String(sp.status || "");
  const errorText = sp.error ? String(sp.error) : "";
  const inlineMsg = (key: string, okText: string, failPrefix: string) => {
    if (action !== key) return null;
    if (status === "ok") return <div className="field-hint">{okText}</div>;
    if (status === "fail") return <div className="field-hint" style={{ color: "var(--danger)" }}>{failPrefix}: {errorText || "unknown_error"}</div>;
    return null;
  };

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Checkout público</h1>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Plantillas</h3>
              <HelpTip text="Crea múltiples URLs públicas con configuración propia." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <PublicCheckoutTemplatesPanel
            templates={templates}
            plans={plans}
            csrfToken={csrfToken}
            publicBaseUrl={publicCheckout.baseUrl || ""}
            inlineMsg={inlineMsg}
            actions={{
              create: createPublicCheckoutTemplate,
              update: updatePublicCheckoutTemplate,
              deactivate: deactivatePublicCheckoutTemplate
            }}
          />
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Defaults del checkout</h3>
              <HelpTip text="Se usan cuando una plantilla no define su propia marca." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="panel module">
            <form action={updatePublicCheckoutDefaults} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <div className="field">
                <label>URL pública base</label>
                <input className="input" name="publicBaseUrl" defaultValue={publicCheckout.baseUrl || ""} placeholder="https://mdv.subs.apiflujos.com" />
              </div>
              <div className="field">
                <label>Título</label>
                <input className="input" name="publicTitle" defaultValue={publicCheckout.title || ""} placeholder="Activa tu suscripción" />
              </div>
              <div className="field">
                <label>Subtítulo</label>
                <input className="input" name="publicSubtitle" defaultValue={publicCheckout.subtitle || ""} placeholder="Guarda tu método de pago" />
              </div>
              <div className="field">
                <label>Descripción</label>
                <textarea className="input" name="publicDescription" defaultValue={publicCheckout.description || ""} rows={3} />
              </div>
              <div className="field">
                <label>Email de contacto</label>
                <input className="input" name="publicContactEmail" defaultValue={publicCheckout.contactEmail || ""} placeholder="mdv.subs@apiflujos.com" />
              </div>
              <div className="field">
                <label>Expiración del link (horas)</label>
                <input className="input" name="publicTokenExpiryHours" defaultValue={publicCheckout.tokenExpiryHours || 24} />
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                {inlineMsg("public_defaults", "Guardado.", "Error guardando")}
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
