import { notFound } from "next/navigation";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { PageShell } from "../../ui/PageShell";
import { getCsrfToken } from "../../lib/csrf";
import { normalizeErrorParam } from "../../lib/errorParam";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { saveRealtime, saveReminder } from "../actions";
import { NotificationEditor } from "../NotificationEditor";
import { findNotificationEntry, type Env, type Rule, type Template } from "../notificationsModel";
import "../notifications.css";

export const dynamic = "force-dynamic";

/**
 * Configurar una notificación de WhatsApp (de tiempo real o recordatorio). [id] es la clave
 * de la notificación (`payment_link_created`, `reminder_due_link`…). Antes era un modal.
 */
export default async function NotificationEditorPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const env: Env = String(sp.env || "").toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  const returnTo = resolveReturnTo(sp.returnTo, `/settings?tab=notificaciones-whatsapp&env=${env}`);
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");

  const config: any = (await getNotificationsConfigForEnv(env).catch(() => null)) || { templates: [], rules: [] };
  const templates = (Array.isArray(config.templates) ? config.templates : []) as Template[];
  const rules = (Array.isArray(config.rules) ? config.rules : []) as Rule[];
  const entry = findNotificationEntry(id, templates, rules);
  if (!entry) notFound();
  const csrfToken = await getCsrfToken();
  const selfHref = withReturnTo(`/notifications/${encodeURIComponent(id)}?env=${env}`, returnTo);

  return (
    <PageShell
      title={entry.label}
      subtitle={`Notificación de WhatsApp · ${entry.subtitle}${env === "SANDBOX" ? " · Sandbox" : ""}`}
      crumbs={[{ label: "Notificaciones", href: returnTo }, { label: entry.label }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      <NotificationEditor
        env={env}
        csrfToken={csrfToken}
        entry={entry}
        returnTo={returnTo}
        errorTo={selfHref}
        saveRealtime={saveRealtime}
        saveReminder={saveReminder}
      />
    </PageShell>
  );
}
