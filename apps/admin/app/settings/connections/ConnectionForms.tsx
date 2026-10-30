import Link from "next/link";
import { PendingButton } from "../../ui/PendingButton";
import { FormActions, PageSection } from "../../ui/PageShell";
import {
  deleteCentralConnection,
  deleteShopifyConnection,
  deleteWompiConnection,
  testCentralConnection,
  testShopifyForward,
  testWompiConnection,
  updateChatwoot,
  updateShopify,
  updateWompi
} from "../actions";
import { connectionHref, type ConnectionSlug } from "./connectionMeta";

type CommonProps = {
  slug: ConnectionSlug;
  csrfToken: string;
  /** Lista de conexiones: adónde vuelve "Cancelar" y la eliminación. */
  listHref: string;
  /** Esta misma página (con su returnTo): las acciones de guardar y probar vuelven aquí. */
  selfHref: string;
};

function Hidden({ csrfToken, returnTo }: { csrfToken: string; returnTo: string }) {
  return (
    <>
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
}

function DeleteLink({ slug, listHref, label }: { slug: ConnectionSlug; listHref: string; label: string }) {
  return (
    <Link
      className="ghost btn-compact btn-red btn-noicon"
      href={connectionHref(slug, { returnTo: listHref, confirmDelete: true })}
      data-loader="off"
    >
      {label}
    </Link>
  );
}

export function WompiConnectionForm({ slug, csrfToken, listHref, selfHref, config }: CommonProps & { config: any }) {
  const environment = slug === "wompi-prod" ? "PRODUCTION" : "SANDBOX";
  const id = `wompi-${slug}`;
  return (
    <form action={updateWompi} className="page-shell-body">
      <Hidden csrfToken={csrfToken} returnTo={selfHref} />
      <input type="hidden" name="environment" value={environment} />
      <input type="hidden" name="redirectOnFinish" value="1" />
      <PageSection
        title={`Conexión (${environment === "PRODUCTION" ? "Producción" : "Sandbox"})`}
        description="Las llaves privadas nunca se muestran. Déjalas vacías para conservar las actuales."
      >
        <div className="field">
          <label htmlFor={`${id}-public`}>Llave pública</label>
          <input id={`${id}-public`} className="input" name="publicKey" placeholder="pub_..." defaultValue={config?.publicKey || ""} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-private`}>Llave privada</label>
          <input id={`${id}-private`} className="input" name="privateKey" type="password" autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-events`}>Eventos</label>
          <input id={`${id}-events`} className="input" name="eventsSecret" type="password" autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-integrity`}>Integridad</label>
          <input id={`${id}-integrity`} className="input" name="integritySecret" type="password" autoComplete="new-password" />
        </div>
      </PageSection>
      <FormActions cancelHref={listHref}>
        <DeleteLink slug={slug} listHref={listHref} label="Eliminar conexión" />
        <PendingButton className="ghost btn-compact btn-noicon" type="submit" formAction={testWompiConnection} pendingText="Conectando...">
          Probar conexión
        </PendingButton>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </FormActions>
    </form>
  );
}

export function ChatwootConnectionForm({ slug, csrfToken, listHref, selfHref, config }: CommonProps & { config: any }) {
  return (
    <form action={updateChatwoot} className="page-shell-body">
      <Hidden csrfToken={csrfToken} returnTo={selfHref} />
      <input type="hidden" name="environment" value="PRODUCTION" />
      <input type="hidden" name="redirectOnFinish" value="1" />
      <PageSection title="Chatwoot · WhatsApp" description="Mensajería y plantillas de WhatsApp.">
        <div className="field">
          <label htmlFor="cw-base">URL base</label>
          <input id="cw-base" className="input" name="baseUrl" placeholder="https://chatwoot.tu-dominio.com" defaultValue={config?.baseUrl || ""} />
        </div>
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="cw-account">ID de cuenta</label>
            <input id="cw-account" className="input" name="accountId" defaultValue={config?.accountId || ""} />
          </div>
          <div className="field">
            <label htmlFor="cw-inbox">ID de bandeja</label>
            <input id="cw-inbox" className="input" name="inboxId" defaultValue={config?.inboxId || ""} />
          </div>
          <div className="field field-full">
            <label htmlFor="cw-token">Token API</label>
            <input id="cw-token" className="input" name="apiAccessToken" type="password" placeholder="••••••••" autoComplete="new-password" />
            <div className="field-hint">Requerido la primera vez. Luego puedes dejarlo vacío para conservar el token actual.</div>
          </div>
        </div>
      </PageSection>
      <FormActions cancelHref={listHref}>
        <DeleteLink slug={slug} listHref={listHref} label="Eliminar conexión" />
        <PendingButton className="ghost btn-compact btn-noicon" type="submit" formAction={testCentralConnection} pendingText="Conectando...">
          Probar conexión
        </PendingButton>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </FormActions>
    </form>
  );
}

export function ShopifyConnectionForm({ slug, csrfToken, listHref, selfHref, config }: CommonProps & { config: any }) {
  return (
    <form action={updateShopify} className="page-shell-body">
      <Hidden csrfToken={csrfToken} returnTo={selfHref} />
      <PageSection title="Reenvío de eventos" description="Reenvía a Shopify los pagos que le corresponden.">
        <div className="field">
          <label htmlFor="sh-url">URL de reenvío</label>
          <input id="sh-url" className="input" name="forwardUrl" defaultValue={config?.forwardUrl || ""} />
        </div>
        <div className="field">
          <label htmlFor="sh-origin">Origin</label>
          <select id="sh-origin" className="select" name="forwardOrigin" defaultValue={config?.forwardOrigin || "shopify"}>
            <option value="shopify">shopify</option>
            <option value="shopify-native">shopify-native</option>
          </select>
          <div className="field-hint">El servicio de Shopify acepta solo estos valores.</div>
        </div>
        <div className="field">
          <label htmlFor="sh-secret">Secreto de reenvío (opcional)</label>
          <input id="sh-secret" className="input" name="forwardSecret" type="password" placeholder="••••••••" autoComplete="new-password" />
          <div className="field-hint">Déjalo vacío para conservar el secreto actual.</div>
        </div>
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="sh-retry">Reintento automático</label>
            <select id="sh-retry" className="select" name="forwardRetryEnabled" defaultValue={String(config?.forwardRetryEnabled ?? true)}>
              <option value="true">Activo</option>
              <option value="false">Desactivado</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sh-minutes">Intervalo (min)</label>
            <input id="sh-minutes" className="input" name="forwardRetryMinutes" placeholder="15" defaultValue={String(config?.forwardRetryMinutes ?? 15)} />
          </div>
        </div>
      </PageSection>
      <FormActions cancelHref={listHref}>
        <DeleteLink slug={slug} listHref={listHref} label="Eliminar conexión" />
        <PendingButton className="ghost btn-compact btn-noicon" type="submit" formAction={testShopifyForward} pendingText="Probando...">
          Probar forward
        </PendingButton>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </FormActions>
    </form>
  );
}

/** Segundo paso de "Eliminar conexión": confirmación dentro de la página, sin capa encima. */
export function ConfirmDeleteConnection({
  slug,
  csrfToken,
  listHref,
  selfHref,
  title
}: CommonProps & { title: string }) {
  const action =
    slug === "chatwoot" ? deleteCentralConnection : slug === "shopify" ? deleteShopifyConnection : deleteWompiConnection;
  const environment = slug === "wompi-prod" ? "PRODUCTION" : slug === "wompi-sandbox" ? "SANDBOX" : slug === "chatwoot" ? "PRODUCTION" : "";
  return (
    <form action={action} className="page-shell-body">
      <Hidden csrfToken={csrfToken} returnTo={listHref} />
      {environment ? <input type="hidden" name="environment" value={environment} /> : null}
      <PageSection
        title={`¿Eliminar la conexión ${title}?`}
        description="Se borran las credenciales guardadas. Para volver a usarla tendrás que configurarla de nuevo."
      >
        <p className="field-hint ui-alert-warn">Esta acción no se puede deshacer.</p>
      </PageSection>
      <FormActions cancelHref={selfHref} cancelLabel="No, volver">
        <PendingButton className="ghost btn-compact btn-red btn-noicon" type="submit" pendingText="Eliminando...">
          Sí, eliminar conexión
        </PendingButton>
      </FormActions>
    </form>
  );
}
