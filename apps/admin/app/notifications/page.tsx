import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { NotificationWizard } from "./NotificationWizard";
import { createNotification } from "./actions";

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
  searchParams?: { env?: string; saved?: string; error?: string; scheduled?: string };
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <p>Configura `ADMIN_API_TOKEN` en el Admin.</p>
      </main>
    );
  }

  const env = (String(searchParams?.env || "").trim().toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const res = await fetchConfig(env);

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <div className="panelHeaderRow">
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <form action="/notifications" method="GET" style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

      {searchParams?.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof searchParams?.scheduled === "string" ? <div className="card cardPad">Jobs programados: {searchParams.scheduled}.</div> : null}
      {searchParams?.error ? (
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

      <NotificationWizard envDefault={env} createNotification={createNotification} csrfToken={csrfToken} />
    </main>
  );
}
