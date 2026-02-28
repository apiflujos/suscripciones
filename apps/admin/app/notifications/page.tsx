import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { NotificationsSimple } from "./NotificationsSimple";
import { saveReminder, saveRealtime } from "./actions";
import { normalizeErrorParam } from "../lib/errorParam";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchConfig(environment: "PRODUCTION" | "SANDBOX") {
  return fetchAdminCached(`/admin/notifications/config?environment=${encodeURIComponent(environment)}`, { ttlMs: 1500 });
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ env?: string; saved?: string; error?: string; scheduled?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main className="page pageWide">
        <p>Configura `ADMIN_API_TOKEN` en el Admin.</p>
      </main>
    );
  }

  const sp = (await searchParams) ?? {};
  const env = (String(sp.env || "").trim().toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const res = await fetchConfig(env);
  const config = res.ok ? (res.json?.config || {}) : {};
  const templates = Array.isArray(config?.templates) ? config.templates : [];
  const rules = Array.isArray(config?.rules) ? config.rules : [];

  return (
    <main className="page pageWide notificationsPage">
      <div className="filtersRow">
        <div className="filtersLeft">
          <div className="filtersNote">Configura reglas y recordatorios para notificaciones en producción o sandbox.</div>
          <div className="filtersPanel">
            <form action="/notifications" method="GET" className="filtersForm">
              <div className="field" style={{ margin: 0, minWidth: 220 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>Entorno</span>
                  <HelpTip text="Selecciona Producción o Sandbox para ver y crear reglas." />
                </label>
                <select className="select" name="env" defaultValue={env}>
                  <option value="PRODUCTION">Producción</option>
                  <option value="SANDBOX">Sandbox</option>
                </select>
              </div>
              <button className="ghost" type="submit">
                Cambiar
              </button>
            </form>
          </div>
        </div>
      </div>

      {sp.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof sp.scheduled === "string" ? <div className="card cardPad">Jobs programados: {sp.scheduled}.</div> : null}
      {normalizeErrorParam(sp.error) ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {String(normalizeErrorParam(sp.error))}
        </div>
      ) : null}

      {!res.ok ? (
        <div className="card cardPad">
          No se pudo consultar el API (
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{res.status || "sin respuesta"}</span>). Revisa `NEXT_PUBLIC_API_BASE_URL` y el token del Admin.
        </div>
      ) : null}

      {res.ok ? (
        <NotificationsSimple
          env={env}
          csrfToken={csrfToken}
          templates={templates}
          rules={rules}
          actions={{ saveRealtime, saveReminder }}
        />
      ) : null}
    </main>
  );
}
