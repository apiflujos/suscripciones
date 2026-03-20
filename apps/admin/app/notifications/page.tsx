import Link from "next/link";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { NotificationsSimple } from "./NotificationsSimple";
import { saveReminder, saveRealtime } from "./actions";
import { normalizeErrorParam } from "../lib/errorParam";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ env?: string; saved?: string; error?: string; scheduled?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const env = (String(sp.env ?? "").trim().toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const config = (await getNotificationsConfigForEnv(env)) || { templates: [], rules: [] };
  const templates = Array.isArray(config.templates) ? config.templates : [];
  const rules = Array.isArray(config.rules) ? config.rules : [];

  return (
    <main className="page pageWide notificationsPage">
      <div className="filtersRow">
        <div className="filtersLeft">
          <div className="filtersNote">Configura reglas y recordatorios para notificaciones en producción o sandbox.</div>
          <div className="filtersPanel">
            <div className="field" style={{ margin: 0, minWidth: 220 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>Entorno</span>
                <HelpTip text="Selecciona Producción o Sandbox para ver y crear reglas." />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className={env === "PRODUCTION" ? "primary" : "ghost"} href="/notifications?env=PRODUCTION">
                  Producción
                </Link>
                <Link className={env === "SANDBOX" ? "primary" : "ghost"} href="/notifications?env=SANDBOX">
                  Sandbox
                </Link>
              </div>
            </div>
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

      <NotificationsSimple env={env} csrfToken={csrfToken} templates={templates} rules={rules} actions={{ saveRealtime, saveReminder }} />
    </main>
  );
}
