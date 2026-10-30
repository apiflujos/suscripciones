import { notFound } from "next/navigation";
import { getNotificationsConfig } from "@suscripciones/core/services/notificationsConfig";
import { getCustomerById } from "../admin/_services/customers";
import { listSubscriptions } from "../admin/_services/subscriptions";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { listCatalogProducts } from "../admin/_services/products";
import { getAdminSettings } from "../admin/_services/settings";
import type { SendContext } from "./sendRules";

export type CustomerSendData = {
  customer: NonNullable<Awaited<ReturnType<typeof getCustomerById>>>;
  ctx: SendContext;
  productName: string;
  collectionMode: string;
  tenantId: string;
};

/**
 * Datos de UN contacto para las páginas de envío (link de pago, catálogo, débito
 * automático): el contacto, su suscripción vigente, las plantillas de checkout y la
 * configuración de notificaciones. La lista ya no carga nada de esto.
 */
export async function loadCustomerSend(customerId: string): Promise<CustomerSendData> {
  const customer = await getCustomerById(customerId);
  if (!customer) notFound();
  const tenantId = String(customer.tenantId || customer.tenantIds?.[0] || "").trim();

  const [subs, products, templates, settings, notifications] = await Promise.all([
    listSubscriptions({ customerId: customer.id, tenantId: tenantId || null, take: 40 }),
    listCatalogProducts({ tenantId: tenantId || null, take: 300 }),
    listCheckoutTemplates({ tenantId: tenantId || null }).catch(() => []),
    getAdminSettings(),
    getNotificationsConfig().catch(() => null)
  ]);

  const current = ((subs.items ?? []) as any[]).find((s) => String(s?.status || "") && String(s.status) !== "CANCELED") || null;
  const productId = current
    ? String(current?.productId || current?.plan?.catalogProductId || current?.plan?.metadata?.catalog?.itemId || "").trim()
    : "";
  const productItems = ((products as any)?.items ?? []) as any[];
  const productName = String(productItems.find((p) => String(p?.id || "") === productId)?.name || current?.productName || "").trim();

  return {
    customer,
    tenantId,
    productName,
    collectionMode: String(current?.plan?.metadata?.collectionMode || ""),
    ctx: {
      customer: { id: customer.id, tenantId: customer.tenantId, tenantIds: customer.tenantIds },
      productId,
      checkoutTemplates: templates as any[],
      checkoutConfig: (settings as any)?.checkoutConfig || {},
      notificationsConfig: notifications
    }
  };
}
