import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { saveNotificationsConfig, scheduleSubscription } from "./actions";
import { HelpTip } from "../ui/HelpTip";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchConfig() {
  return fetchAdminCached("/admin/notifications/config", { ttlMs: 1500 });
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string; scheduled?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`) en el Admin.</p>
      </main>
    );
  }

  const res = await fetchConfig();
  const config = res.ok ? res.json?.config : null;
  const pretty = config ? JSON.stringify(config, null, 2) : "";

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
      {searchParams.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof searchParams.scheduled === "string" ? <div className="card cardPad">Jobs programados: {searchParams.scheduled}.</div> : null}
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {String(searchParams.error)}
        </div>
      ) : null}

      {!res.ok ? (
        <div className="card cardPad">
          No se pudo consultar el API (
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{res.status || "sin respuesta"}</span>). Revisa `NEXT_PUBLIC_API_BASE_URL` y el token del Admin.
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Configuración central</h3>
              <HelpTip text="Define plantillas y reglas (antes/después del cobro, aprobado/rechazado). Se guarda por entorno (Producción/Sandbox)." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form action={saveNotificationsConfig} className="panel module" style={{ display: "grid", gap: 10 }}>
            <div className="field" style={{ maxWidth: 280 }}>
              <label>Entorno</label>
              <select className="select" name="environment" defaultValue="PRODUCTION">
                <option value="PRODUCTION">Producción</option>
                <option value="SANDBOX">Sandbox</option>
              </select>
            </div>
            <div className="field">
              <label>JSON de notificaciones</label>
              <textarea
                className="input"
                name="configJson"
                rows={22}
                defaultValue={pretty}
                placeholder='{"version":1,"templates":[],"rules":[]}'
                style={{ padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
              <div className="field-hint">
                Variables comunes: <code>{"{{customer.name}}"}</code>, <code>{"{{plan.name}}"}</code>, <code>{"{{subscription.currentPeriodEndAt}}"}</code>, <code>{"{{payment.checkoutUrl}}"}</code>, <code>{"{{payment.reference}}"}</code>.
              </div>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="primary" type="submit">
                Guardar
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Programar recordatorios</h3>
              <HelpTip text="Crea jobs en la cola para una suscripción (útil para probar). Con forceNow, los que estén en el pasado se ejecutan de inmediato." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form action={scheduleSubscription} className="panel module" style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr auto" } as any}>
            <div className="field">
              <label>Subscription ID</label>
              <input className="input" name="subscriptionId" placeholder="uuid" />
              <div style={{ marginTop: 8 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="forceNow" value="1" />
                  <span>forceNow</span>
                </label>
              </div>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "end" }}>
              <button className="primary" type="submit">
                Programar
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
