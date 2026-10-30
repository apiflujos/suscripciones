"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FormActions, PageSection } from "../ui/PageShell";
import { PendingButton } from "../ui/PendingButton";
import { WaTemplateFields, defaultTemplateParamString, type ChatwootTemplate } from "./WaTemplateFields";
import { getRealtimeVariableMatrix, getReminderVariableMatrix } from "./templateVariableMatrix";
import { secondsFromOffset, offsetsToItems, type Env, type NotificationEntry } from "./notificationsModel";

/**
 * Formulario de una notificación (de tiempo real o recordatorio). Era un modal de 900 px;
 * ahora es la página /notifications/[id]. Los campos y la forma de guardar son los mismos.
 * El selector de variables es un panel en línea (<details>), nunca una capa encima.
 */
export function NotificationEditor({
  env,
  csrfToken,
  entry,
  returnTo,
  errorTo,
  saveRealtime,
  saveReminder
}: {
  env: Env;
  csrfToken: string;
  entry: NotificationEntry;
  returnTo: string;
  errorTo: string;
  saveRealtime: (formData: FormData) => void;
  saveReminder: (formData: FormData) => void;
}) {
  const [waTemplates, setWaTemplates] = useState<ChatwootTemplate[]>([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");

  const loadWaTemplates = useCallback(async () => {
    setWaLoading(true);
    setWaError("");
    try {
      const res = await fetch("/admin/comms?op=whatsapp_templates", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok && Array.isArray(json.templates)) {
        setWaTemplates(json.templates);
      } else {
        setWaTemplates([]);
        setWaError(String(json?.error || "No se pudieron cargar las plantillas"));
      }
    } catch (err: any) {
      setWaTemplates([]);
      setWaError(String(err?.message || "No se pudieron cargar las plantillas"));
    } finally {
      setWaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWaTemplates();
  }, [loadWaTemplates, env]);

  const reminder = entry.reminder;
  const realtime = entry.realtime;
  const variableMatrix = useMemo(
    () =>
      reminder
        ? getReminderVariableMatrix({ kind: reminder.kind, paymentType: reminder.paymentType })
        : getRealtimeVariableMatrix(realtime!.key),
    [reminder, realtime]
  );
  const [reminderOffsets] = useState(() => offsetsToItems(entry.rule?.offsetsSeconds));
  const tplCw = entry.template?.chatwootTemplate;
  const enabledValue = (entry.rule?.enabled ?? true) ? "on" : "";

  const [copied, setCopied] = useState("");
  const copyVariable = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // sin portapapeles: el valor sigue visible para copiarlo a mano
    }
  };

  return (
    <form action={reminder ? saveReminder : saveRealtime} className="page-shell-body notification-form">
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="environment" value={env} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="errorTo" value={errorTo} />
      <input type="hidden" name="templateKind" value="WHATSAPP_TEMPLATE" />
      <input type="hidden" name="enabled" value={enabledValue} />
      {reminder ? (
        <>
          <input type="hidden" name="kind" value={reminder.kind} />
          <input type="hidden" name="paymentType" value={reminder.paymentType} />
          <input type="hidden" name="templateId" value={reminder.templateId} />
          <input
            type="hidden"
            name="offsetsSeconds"
            value={reminderOffsets.map((o) => secondsFromOffset(o, reminder.kind === "DUE" ? -1 : 1)).join(",")}
          />
        </>
      ) : (
        <>
          <input type="hidden" name="key" value={realtime!.key} />
          <input type="hidden" name="chatwootType" value={realtime!.chatwootType || ""} />
          <input type="hidden" name="paymentType" value={realtime!.paymentType || ""} />
        </>
      )}

      <PageSection
        title="Plantilla de WhatsApp"
        description="Canal: WhatsApp. Solo se aceptan plantillas WhatsApp activas; no se usan mensajes libres en estos envíos."
      >
        <div className="field-hint">{variableMatrix.helpText}</div>
        <WaTemplateFields
          templates={waTemplates}
          defaultName={tplCw?.name || ""}
          defaultLang={tplCw?.language || "es"}
          defaultParams={defaultTemplateParamString(tplCw?.processed_params?.body, "body")}
          defaultHeaderParams={defaultTemplateParamString(tplCw?.processed_params?.header, "header")}
          defaultButtonParams={defaultTemplateParamString(tplCw?.processed_params?.buttons, "buttons")}
          variables={variableMatrix.bodyVariables}
          buttonVariables={variableMatrix.buttonVariables}
          onSync={loadWaTemplates}
          syncing={waLoading}
          syncError={waError}
        />
      </PageSection>

      <PageSection>
        <details className="notif-variables">
          <summary>Variables disponibles para esta notificación</summary>
          <p className="field-hint">Usa estas variables al asignar los parámetros de la plantilla. Pulsa una para copiarla.</p>
          <div className="notif-variables-list">
            {variableMatrix.bodyVariables.map((v) => (
              <button
                key={v.value}
                type="button"
                className="ghost btn-compact"
                onClick={() => copyVariable(v.value)}
                title={v.value}
                data-loader="off"
              >
                {copied === v.value ? "Copiada" : v.label}
              </button>
            ))}
          </div>
          {variableMatrix.buttonVariables.length ? (
            <>
              <p className="field-hint">Variables para botones</p>
              <div className="notif-variables-list">
                {variableMatrix.buttonVariables.map((v) => (
                  <button
                    key={`btn-${v.value}`}
                    type="button"
                    className="ghost btn-compact"
                    onClick={() => copyVariable(v.value)}
                    title={v.value}
                    data-loader="off"
                  >
                    {copied === v.value ? "Copiada" : v.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </details>
      </PageSection>

      <FormActions cancelHref={returnTo}>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </FormActions>
    </form>
  );
}
