import Link from "next/link";
import { PendingButton } from "../../ui/PendingButton";
import { FormActions, PageSection } from "../../ui/PageShell";
import { createWebhookEndpointAction, updateWebhookEndpointAction } from "../actions";

export const WEBHOOKS_LIST_HREF = "/settings?tab=integraciones";

type Endpoint = { id: string; name: string; provider: string; active: boolean };

/** Formulario de "Nuevo webhook" / "Editar webhook". El secreto guardado nunca se muestra. */
export function WebhookEndpointForm({
  csrfToken,
  endpoint,
  suggestedSecret,
  deleteHref
}: {
  csrfToken: string;
  endpoint?: Endpoint | null;
  suggestedSecret?: string;
  deleteHref?: string;
}) {
  const editing = Boolean(endpoint);
  return (
    <form action={editing ? updateWebhookEndpointAction : createWebhookEndpointAction} className="page-shell-body">
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="returnTo" value={WEBHOOKS_LIST_HREF} />
      {endpoint ? <input type="hidden" name="id" value={endpoint.id} /> : null}
      <PageSection title="Datos del webhook">
        <div className="field">
          <label htmlFor="wh-name">Nombre</label>
          <input id="wh-name" className="input" name="name" placeholder="Ej: MercadoPago" defaultValue={endpoint?.name || ""} />
        </div>
        <div className="field">
          <label htmlFor="wh-provider">Proveedor</label>
          <select id="wh-provider" className="select" name="provider" defaultValue={endpoint?.provider || "MERCADOPAGO"}>
            <option value="WOMPI">Wompi</option>
            <option value="CUSTOM">Custom</option>
            <option value="MERCADOPAGO">MercadoPago</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="wh-secret">{editing ? "Nuevo secreto (opcional)" : "Secreto"}</label>
          <input
            id="wh-secret"
            className="input"
            name="secret"
            autoComplete="off"
            {...(editing
              ? { placeholder: "Deja vacío para mantener el actual" }
              : { defaultValue: suggestedSecret || "" })}
          />
          {editing ? null : <div className="field-hint">Guarda este secreto en la pasarela para firmar el webhook.</div>}
        </div>
        <div className="field">
          <label htmlFor="wh-active" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="hidden" name="active" value="false" />
            <input id="wh-active" type="checkbox" name="active" value="true" defaultChecked={editing ? endpoint!.active : true} />
            Activo
          </label>
        </div>
      </PageSection>
      <FormActions cancelHref={WEBHOOKS_LIST_HREF}>
        {editing && deleteHref ? (
          <Link className="ghost btn-compact btn-red btn-noicon" href={deleteHref} data-loader="off">
            Eliminar
          </Link>
        ) : null}
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText={editing ? "Guardando..." : "Creando..."}>
          {editing ? "Guardar" : "Crear"}
        </PendingButton>
      </FormActions>
    </form>
  );
}
