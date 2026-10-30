"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FormActions, PageSection } from "../ui/PageShell";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { FilterButton } from "../ui/FilterButton";
import { CampaignTemplateFields, type ChatwootTemplate, type WaTemplateState } from "./CampaignTemplateFields";
import { CAMPAIGN_BUTTON_VARIABLES, MESSAGE_VARIABLES } from "./campaignVariables";

type SmartView = { id: string; name: string; visibility: "ORG" | "PRIVATE"; type: "DYNAMIC" | "STATIC"; filters?: any };

/**
 * Formulario de "Nueva campaña". Era un modal de 900 px sobre la lista; ahora es la página
 * /campaigns/new. La lógica (audiencia, confirmación, plantilla de WhatsApp) es la misma.
 */
export function NewCampaignForm({
  csrfToken,
  returnTo,
  errorTo,
  views,
  tenantId,
  action
}: {
  csrfToken: string;
  returnTo: string;
  errorTo: string;
  views: SmartView[];
  tenantId?: string | null;
  action: (formData: FormData) => void;
}) {
  const [supportContent, setSupportContent] = useState("");
  const [waTemplates, setWaTemplates] = useState<ChatwootTemplate[]>([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");
  const [waState, setWaState] = useState<WaTemplateState>({ name: "", lang: "es", bodyParams: [], headerParams: [], buttonParams: [] });
  const [smartViewId, setSmartViewId] = useState("");
  const [availableViews, setAvailableViews] = useState<SmartView[]>(views);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const [audienceApproved, setAudienceApproved] = useState(false);

  const isFormValid = useMemo(
    () => audienceApproved && audienceCount !== null && audienceCount > 0 && waState.name !== "",
    [audienceApproved, audienceCount, waState.name]
  );

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
    setAvailableViews(views);
  }, [views]);

  useEffect(() => {
    loadWaTemplates();
  }, [loadWaTemplates]);

  const loadViews = useCallback(async () => {
    try {
      const res = await fetch("/api/smart-views/customers", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && Array.isArray(json?.views)) {
        setAvailableViews(json.views);
        return json.views as SmartView[];
      }
      if (res.ok && Array.isArray(json)) {
        setAvailableViews(json as SmartView[]);
        return json as SmartView[];
      }
    } catch {
      // se conserva la lista actual
    }
    return availableViews;
  }, [availableViews]);

  useEffect(() => {
    loadViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAudiencePreview = useCallback(
    async (id: string) => {
      const trimmed = String(id || "").trim();
      if (!trimmed) {
        setAudienceCount(null);
        setAudienceError("");
        return;
      }
      setAudienceLoading(true);
      setAudienceError("");
      setAudienceApproved(false);
      try {
        const res = await fetch(`/admin/smart-views/customers/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ viewId: trimmed, ...(tenantId ? { tenantId } : {}) })
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json && typeof json.count === "number") {
          setAudienceCount(json.count);
        } else {
          setAudienceCount(null);
          setAudienceError(String(json?.error || "No se pudo cargar la audiencia"));
        }
      } catch (err: any) {
        setAudienceCount(null);
        setAudienceError(String(err?.message || "No se pudo cargar la audiencia"));
      } finally {
        setAudienceLoading(false);
      }
    },
    [tenantId]
  );

  return (
    <form action={action} className="page-shell-body">
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="errorTo" value={errorTo} />
      <input type="hidden" name="templateKind" value="WHATSAPP_TEMPLATE" />
      <input type="hidden" name="waTemplateName" value={waState.name} />
      <input type="hidden" name="waLanguage" value={waState.lang} />
      <input type="hidden" name="waBodyParams" value={waState.bodyParams.join("|")} />
      <input type="hidden" name="waHeaderParams" value={waState.headerParams.join("|")} />
      <input type="hidden" name="waButtonParams" value={waState.buttonParams.join("|")} />

      <PageSection title="Datos de la campaña">
        <div className="field">
          <label htmlFor="campaign-name">Nombre</label>
          <input id="campaign-name" className="input" name="name" required placeholder="Ej: Recordatorio cartera marzo" />
        </div>
      </PageSection>

      <PageSection title="Audiencia" description="Selecciona un filtro para definir a quiénes llegará esta campaña.">
        <div className="field">
          <label htmlFor="campaign-view" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Filtro inteligente (audiencia)</span>
            <HelpTip text="Selecciona un filtro para definir a quiénes llegará esta campaña." />
          </label>
          <select
            id="campaign-view"
            className="select"
            name="smartViewId"
            required
            value={smartViewId}
            onChange={(e) => {
              const next = e.target.value;
              setSmartViewId(next);
              loadAudiencePreview(next);
            }}
          >
            <option value="">Selecciona un filtro...</option>
            {availableViews.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {v.visibility === "PRIVATE" ? "(Privada)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FilterButton
            scope="customers"
            label="Crear nuevo filtro"
            fullWidth
            reloadOnSave={false}
            onSaved={async (created) => {
              const nextViews = await loadViews();
              const nextId = String(created?.id || "");
              if (nextId && nextViews.some((v) => String(v.id) === nextId)) {
                setSmartViewId(nextId);
                loadAudiencePreview(nextId);
              }
            }}
          />
        </div>

        {audienceLoading ? <div className="field-hint" role="status">Calculando audiencia...</div> : null}
        {audienceError ? <div className="field-hint" style={{ color: "var(--danger)" }} role="alert">{audienceError}</div> : null}
        {audienceCount !== null && !audienceLoading ? (
          <div className="card cardPad">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>Audiencia seleccionada</strong>
              <span className="pill pill-ok">{audienceCount} contactos</span>
            </div>
            {audienceCount <= 0 ? (
              <div className="field-hint" style={{ marginTop: 6, color: "var(--danger)" }}>
                Esta audiencia no tiene contactos. Selecciona otro filtro.
              </div>
            ) : (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <input type="checkbox" checked={audienceApproved} onChange={(e) => setAudienceApproved(e.target.checked)} />
                <span>Confirmo que esta es la audiencia correcta para la campaña</span>
              </label>
            )}
          </div>
        ) : null}
      </PageSection>

      <PageSection title="Mensaje de WhatsApp">
        <CampaignTemplateFields
          templates={waTemplates}
          variables={MESSAGE_VARIABLES}
          buttonVariables={CAMPAIGN_BUTTON_VARIABLES}
          onSync={loadWaTemplates}
          syncing={waLoading}
          syncError={waError}
          onChange={setWaState}
        />
        {!waState.name ? (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            Debes seleccionar una plantilla de WhatsApp.
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="campaign-content" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>Texto de apoyo (opcional)</span>
            <HelpTip text="Mensaje adicional que se muestra junto a la plantilla de WhatsApp. Puede usarse para contexto extra o enlaces." />
          </label>
          <textarea
            id="campaign-content"
            className="input"
            name="content"
            rows={3}
            value={supportContent}
            onChange={(e) => setSupportContent(e.target.value)}
            placeholder="Mensaje visible junto a la plantilla (opcional)."
          />
        </div>
      </PageSection>

      <FormActions cancelHref={returnTo}>
        <PendingButton className="primary btn-compact" type="submit" pendingText="Guardando..." disabled={!isFormValid}>
          Guardar campaña
        </PendingButton>
      </FormActions>
      {!isFormValid ? (
        <p className="field-hint" style={{ margin: 0 }}>
          Para guardar: elige un filtro, confirma la audiencia y selecciona una plantilla de WhatsApp.
        </p>
      ) : null}
    </form>
  );
}
