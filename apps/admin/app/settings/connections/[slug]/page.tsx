import { notFound } from "next/navigation";
import { getAdminSettings } from "../../../admin/_services/settings";
import { PageShell } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { resolveReturnTo } from "../../../lib/returnTo";
import { settingsNotice } from "../../flash";
import {
  CONNECTIONS_LIST_HREF,
  CONNECTION_TITLES,
  connectionHref,
  isConnectionSlug
} from "../connectionMeta";
import {
  ChatwootConnectionForm,
  ConfirmDeleteConnection,
  ShopifyConnectionForm,
  WompiConnectionForm
} from "../ConnectionForms";

export const dynamic = "force-dynamic";

const LABELS = {
  wompi_creds: { ok: "Guardado.", fail: "Error guardando" },
  wompi_test: { ok: "Conexión exitosa.", fail: "Error conectando" },
  central_save: { ok: "Guardado.", fail: "Error guardando" },
  central_test: { ok: "Conexión exitosa.", fail: "Error conectando" },
  shopify_save: { ok: "Guardado.", fail: "Error guardando" },
  shopify_test: { ok: "Forward OK.", fail: "Error probando" },
  wompi_delete: { ok: "Eliminado.", fail: "Error eliminando" },
  central_delete: { ok: "Eliminado.", fail: "Error eliminando" },
  shopify_delete: { ok: "Eliminado.", fail: "Error eliminando" }
};

/**
 * Configurar una conexión (Wompi producción/sandbox, Chatwoot, Shopify). Antes eran
 * modales dentro de la pestaña "Conexiones" de Ajustes.
 */
export default async function ConnectionPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  if (!isConnectionSlug(slug)) notFound();
  const sp = (await searchParams) ?? {};
  let listHref = resolveReturnTo(sp.returnTo, CONNECTIONS_LIST_HREF);
  if (!listHref.startsWith("/settings")) listHref = CONNECTIONS_LIST_HREF;
  const selfHref = connectionHref(slug, { returnTo: listHref });
  const confirmDelete = String(sp.confirmDelete || "") === "1";
  const title = CONNECTION_TITLES[slug];

  const [csrfToken, settings] = await Promise.all([getCsrfToken(), getAdminSettings()]);
  const s = settings as any;
  const wompiProduction = (s?.wompi?.production || s?.wompi || {}) as any;
  const wompiSandbox = (s?.wompi?.sandbox || {}) as any;
  const comms = (s?.communications || null) as any;
  const commsProduction = (comms?.production || s?.chatwoot || {}) as any;
  const common = { slug, csrfToken, listHref, selfHref };

  return (
    <PageShell
      title={confirmDelete ? `Eliminar conexión · ${title}` : title}
      subtitle="Ajustes · Conexiones"
      crumbs={[
        { label: "Ajustes", href: "/settings" },
        { label: "Conexiones", href: listHref },
        { label: title }
      ]}
      backHref={listHref}
      notice={settingsNotice(sp, LABELS)}
    >
      {confirmDelete ? (
        <ConfirmDeleteConnection {...common} title={title} />
      ) : slug === "wompi-prod" ? (
        <WompiConnectionForm {...common} config={wompiProduction} />
      ) : slug === "wompi-sandbox" ? (
        <WompiConnectionForm {...common} config={wompiSandbox} />
      ) : slug === "chatwoot" ? (
        <ChatwootConnectionForm {...common} config={commsProduction} />
      ) : (
        <ShopifyConnectionForm {...common} config={s?.shopify || {}} />
      )}
    </PageShell>
  );
}
