import { getCsrfToken } from "../lib/csrf";
import { NotificationsSimple } from "../notifications/NotificationsSimple";
import { saveReminder, saveRealtime, toggleRule } from "../notifications/actions";
import { normalizeErrorParam } from "../lib/errorParam";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { getPaymentsConfig } from "@suscripciones/core/services/runtimeConfig";
import { updatePaymentsConfig } from "./actions";

export async function WhatsappNotificationsPanel({
  env,
  saved,
  error
}: {
  env: "PRODUCTION" | "SANDBOX";
  saved?: string;
  error?: string;
}) {
  const csrfToken = await getCsrfToken();
  const config = (await getNotificationsConfigForEnv(env)) || { templates: [], rules: [] };
  const templates = Array.isArray(config.templates) ? config.templates : [];
  const rules = Array.isArray(config.rules) ? config.rules : [];
  const paymentsConfig = await getPaymentsConfig().catch(() => null);

  return (
    <section className="settings-group">
      {saved ? <div className="card cardPad">Guardado.</div> : null}
      {normalizeErrorParam(error) ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {String(normalizeErrorParam(error))}
        </div>
      ) : null}

      <NotificationsSimple
        env={env}
        csrfToken={csrfToken}
        templates={templates}
        rules={rules}
        paymentsConfig={paymentsConfig}
        actions={{ saveRealtime, saveReminder, toggleRule, updatePaymentsConfig }}
      />
    </section>
  );
}
