import { notFound } from "next/navigation";
import { getCivilDateAnchorUtc } from "@suscripciones/core/lib/dates";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { listSubscriptions } from "../admin/_services/subscriptions";
import { listCatalogProducts } from "../admin/_services/products";
import { listTenants } from "../admin/_services/tenants";
import { getAdminSettings } from "../admin/_services/settings";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { getCsrfToken } from "../lib/csrf";
import { buildBillingRows, createBillingCardHelpers } from "./billingPageModel";
import type { PlanOption } from "./ChangePlanForm";
import type { BillingCardHelpers, BillingRow, TenantOption } from "./billingTypes";

export type BillingRowPageData = {
  row: BillingRow;
  csrfToken: string;
  tenants: TenantOption[];
  planOptions: PlanOption[];
  /** Cuántas suscripciones tiene el contacto con este mismo producto (1 = sin duplicadas). */
  duplicateCount: number;
  /** ¿Es la que se conserva si se fusionan las duplicadas? */
  isDuplicateKeep: boolean;
  notificationsTemplates: any[];
  notificationsRules: any[];
  helpers: BillingCardHelpers;
};

/**
 * Todo lo que una página dedicada de UNA suscripción necesita: la fila ya
 * calculada (la misma que pinta la lista), el token CSRF, los canales, los
 * productos para cambiar de plan y la configuración de notificaciones.
 *
 * Reemplaza lo que `BillingPageContent` le pasaba a cada modal por props.
 * Si la suscripción no existe responde 404.
 */
export async function loadBillingRow(subscriptionId: string): Promise<BillingRowPageData> {
  const renderNowDate = getCivilDateAnchorUtc(new Date());
  const csrfToken = await getCsrfToken();

  const target = await listSubscriptions({ take: 1, ids: [subscriptionId] });
  const customerId = String((target.items?.[0] as any)?.customerId || "");
  if (!customerId) notFound();

  const [subs, products, tenantsRes, settings, notificationsConfig, checkoutTemplatesRaw] = await Promise.all([
    // Las demás suscripciones del mismo contacto: sirven para detectar duplicadas.
    listSubscriptions({ take: 100, customerId }),
    listCatalogProducts({ take: 200 }),
    listTenants(),
    getAdminSettings(),
    getNotificationsConfigForEnv("PRODUCTION").catch(() => ({ templates: [], rules: [] })),
    listCheckoutTemplates({ tenantId: null }).catch(() => [])
  ]);

  const productItems = (products.items ?? []) as any[];
  const productById = new Map(productItems.map((p: any) => [String(p.id), p]));
  const tenants = (tenantsRes ?? []) as TenantOption[];
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));

  const rows = buildBillingRows({
    subItems: (subs.items ?? []) as any[],
    productById,
    tenantById,
    renderNowDate,
    q: "",
    tipo: "todos",
    estado: "todos",
    cycleState: "",
    ordenar: "vencimiento"
  });
  const row = rows.find((r) => r.id === subscriptionId);
  if (!row) notFound();

  const checkoutConfig = (settings as any)?.checkoutConfig || {};
  const helpers = createBillingCardHelpers({
    rows,
    checkoutTemplates: Array.isArray(checkoutTemplatesRaw) ? checkoutTemplatesRaw : [],
    checkoutConfig,
    planBaseUrl: String(checkoutConfig?.planBaseUrl || "").trim(),
    subscriptionBaseUrl: String(checkoutConfig?.subscriptionBaseUrl || "").trim(),
    renderNowDate,
    actionSubscriptionId: "",
    checkoutCustomerId: "",
    checkoutUrl: ""
  });

  const planOptions: PlanOption[] = productItems.map((p: any): PlanOption => {
    const kind = String(p?.kind || "").toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT";
    const requiresShipping = kind === "PRODUCT" && (p?.requiresShipping === true || p?.requiresShipping == null);
    const displayName = String(p?.name || "Producto");
    const sku = String(p?.sku || "");
    return {
      id: String(p.id),
      name: displayName,
      sku,
      searchText: [displayName, sku, p?.id].filter(Boolean).join(" ").toLowerCase(),
      collectionMode: String(p?.collectionMode || ""),
      priceInCents: Number(p?.basePriceInCents || p?.priceInCents || 0),
      currency: String(p?.currency || "COP"),
      kind,
      requiresShipping,
      shippingInCents: Number(p?.shippingInCents || 0)
    };
  });

  const duplicateKey = helpers.resolveDuplicateKey(row);
  const duplicateCount = duplicateKey ? helpers.duplicateCountByKey.get(duplicateKey) || 1 : 1;
  const isDuplicateKeep = duplicateKey ? helpers.duplicateKeepByKey.get(duplicateKey)?.id === row.id : false;

  return {
    row,
    duplicateCount,
    isDuplicateKeep,
    csrfToken,
    tenants,
    planOptions,
    notificationsTemplates: Array.isArray((notificationsConfig as any)?.templates) ? (notificationsConfig as any).templates : [],
    notificationsRules: Array.isArray((notificationsConfig as any)?.rules) ? (notificationsConfig as any).rules : [],
    helpers
  };
}
