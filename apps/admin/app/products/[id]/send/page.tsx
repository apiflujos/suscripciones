import { PageSection, PageShell } from "../../../ui/PageShell";
import { resolveReturnTo, withReturnTo } from "../../../lib/returnTo";
import {
  isNotificationTemplateConfigured,
  renderNotificationTemplatePreview,
  resolveNotificationTemplateForTrigger
} from "../../../lib/notificationTemplate";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { listCustomers } from "../../../admin/_services/customers";
import { listCheckoutTemplates } from "../../../admin/_services/checkoutTemplates";
import { getAdminSettings } from "../../../admin/_services/settings";
import { sendProductToCustomer } from "../../actions";
import { SendProductForm } from "../../SendProductForm";
import { findPlanTemplateForProduct } from "../../sendProductChecks";
import { formatMoneyFromCents, productErrorMessage } from "../../format";
import { loadProduct } from "../../loadProduct";
import "../../products.css";

export const dynamic = "force-dynamic";

function isPublicImage(url?: string | null) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

/** Enviar producto: elegir contacto y mandarle el link de pago por WhatsApp. */
export default async function SendProductPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/products");
  const error = productErrorMessage(sp.error);
  const { item, csrfToken, scopeTenantId } = await loadProduct(id);
  const effectiveTenantId = scopeTenantId;

  const [customersRes, notificationsConfig, checkoutTemplates, settings] = await Promise.all([
    listCustomers({ take: 200, tenantId: effectiveTenantId }),
    getNotificationsConfigForEnv("PRODUCTION").catch(() => ({ templates: [], rules: [] })),
    listCheckoutTemplates({ tenantId: effectiveTenantId || null }).catch(() => []),
    getAdminSettings().catch(() => null)
  ]);
  const customers = ((customersRes.items ?? []) as any[]).map((c) => ({
    id: String(c.id),
    name: c.name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null
  }));
  const checkoutConfig = (settings as any)?.checkoutConfig || {};
  const template = resolveNotificationTemplateForTrigger({
    rules: Array.isArray((notificationsConfig as any)?.rules) ? (notificationsConfig as any).rules : [],
    templates: Array.isArray((notificationsConfig as any)?.templates) ? (notificationsConfig as any).templates : [],
    trigger: "PAYMENT_LINK_CREATED",
    paymentType: "LINK"
  });
  const hasTemplate = isNotificationTemplateConfigured(template);

  const blockers: string[] = [];
  if (!findPlanTemplateForProduct({ product: item, checkoutTemplates: Array.isArray(checkoutTemplates) ? checkoutTemplates : [], checkoutConfig })) {
    blockers.push("No hay checkout público de link de pago asociado a este producto.");
  }
  if (!String(checkoutConfig?.planBaseUrl || "").trim()) {
    blockers.push("Falta configurar la URL base de link de pago en Checkout público.");
  }

  const self = withReturnTo(`/products/${encodeURIComponent(item.id)}/send`, returnTo);
  const publicImage = isPublicImage(item.imageUrl);

  return (
    <PageShell
      title="Enviar producto"
      subtitle={`${item.name} · ${item.kind === "SERVICE" ? "Servicio" : "Producto"} · ${formatMoneyFromCents(item.basePriceInCents, item.currency)}`}
      crumbs={[{ label: "Productos", href: returnTo }, { label: item.name }, { label: "Enviar" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      <PageSection title="Producto">
        <div className="send-product-summary-row">
          <div className="send-product-thumb">
            {publicImage ? <img src={item.imageUrl || ""} alt={item.name} /> : <span aria-hidden="true">📦</span>}
          </div>
          <div className="send-product-summary-text">
            <div className="send-selected-name">{item.name}</div>
            <div className="field-hint">
              {publicImage ? (
                <>
                  <span className="pill pill-ok">Imagen lista para WhatsApp</span>{" "}
                  <a className="btnLink btn-open" href={item.imageUrl || ""} target="_blank" rel="noreferrer">
                    Ver imagen
                  </a>
                </>
              ) : (
                <>
                  <span className="pill pill-warn">Imagen no disponible</span> Configura una URL https en el producto.
                </>
              )}
            </div>
          </div>
        </div>
      </PageSection>

      <SendProductForm
        action={sendProductToCustomer}
        csrfToken={csrfToken}
        productId={item.id}
        customers={customers}
        returnTo={returnTo}
        failTo={self}
        messagePreview={renderNotificationTemplatePreview(template)}
        blockers={blockers}
        hasTemplate={hasTemplate}
      />
    </PageShell>
  );
}
