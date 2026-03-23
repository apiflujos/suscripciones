import { getCsrfToken } from "../lib/csrf";
import { NotificationsSimple } from "./NotificationsSimple";
import { saveReminder, saveRealtime, toggleRule } from "./actions";
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
  const env = "PRODUCTION" as const;
  const config = (await getNotificationsConfigForEnv(env)) || { templates: [], rules: [] };
  const templates = Array.isArray(config.templates) ? config.templates : [];
  const rules = Array.isArray(config.rules) ? config.rules : [];

  return (
    <main className="page pageWide notificationsPage">
      {sp.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof sp.scheduled === "string" ? <div className="card cardPad">Jobs programados: {sp.scheduled}.</div> : null}
      {normalizeErrorParam(sp.error) ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {String(normalizeErrorParam(sp.error))}
        </div>
      ) : null}

      <NotificationsSimple env={env} csrfToken={csrfToken} templates={templates} rules={rules} actions={{ saveRealtime, saveReminder, toggleRule }} />
    </main>
  );
}
