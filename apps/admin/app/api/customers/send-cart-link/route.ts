import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { findCheckoutTemplateForProduct } from "../../../admin/_services/checkoutTemplates";
import { getCustomerById, updateCustomerMetadata } from "../../../admin/_services/customers";
import { scheduleCatalogLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { signPublicToken } from "../../../../lib/publicTokens";
import { getNotificationsConfig } from "@suscripciones/core/services/notificationsConfig";

function ensureHttps(value: string) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function buildPublicUrl(base: string, path: string, utm: string) {
  const normalized = ensureHttps(base).replace(/\/$/, "");
  const url = `${normalized}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!utm) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}`;
}

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const tenantId = String(body?.tenantId || "").trim();
  const productId = String(body?.productId || "").trim();
  const catalogTypeRaw = String(body?.catalogType || "").trim().toUpperCase();
  const catalogType = catalogTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN";
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });
  if (!productId) return NextResponse.json({ ok: false, error: "missing_product_for_customer" }, { status: 400 });

  const notificationsConfig = await getNotificationsConfig().catch(() => null);
  if (notificationsConfig) {
    const rules = Array.isArray((notificationsConfig as any)?.rules) ? (notificationsConfig as any).rules : [];
    const templates = Array.isArray((notificationsConfig as any)?.templates) ? (notificationsConfig as any).templates : [];
    const candidates = rules.filter((r: any) => r?.enabled && String(r?.trigger || "") === "CATALOG_LINK_CREATED");
    const filtered = candidates.filter((r: any) => {
      const types = r?.conditions?.requirePaymentTypeIn;
      if (!Array.isArray(types) || !types.length) return true;
      return types.includes(catalogType === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN");
    });
    const rule = filtered[0] || null;
    const tpl = rule ? templates.find((t: any) => String(t?.id || "") === String(rule?.templateId || "")) : null;
    if (!tpl || !String(tpl?.chatwootTemplate?.name || "").trim()) {
      return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
  }

  const checkoutConfig = await getCheckoutConfig();
  const baseFromSettings =
    String(checkoutConfig?.planBaseUrl || "").trim() ||
    String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const base = baseFromSettings.replace(/\/$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "missing_public_base_url" }, { status: 400 });

  const selectedTemplate = await findCheckoutTemplateForProduct({ tenantId: tenantId || null, kind: "CART" as any, productId });
  if (!selectedTemplate) {
    return NextResponse.json({ ok: false, error: "missing_checkout_for_product" }, { status: 400 });
  }

  const expiryHours = Number((selectedTemplate as any)?.expiryHours || 0);
  const hours = Number.isFinite(expiryHours) && expiryHours > 0 ? Math.min(Math.max(Math.trunc(expiryHours), 1), 168) : 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const linkToken = await signPublicToken({ sub: customerId, scope: "cart", ttlSeconds: hours * 60 * 60 });
  const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
  const publicUrl = buildPublicUrl(base, `/public/cart/${linkToken}`, utm);

  const customer = await getCustomerById(customerId);
  if (!customer) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
  const prevMeta =
    customer?.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};

  const nextMeta = {
    ...prevMeta,
    cartLink: {
      url: publicUrl,
      token: linkToken,
      templateId: (selectedTemplate as any).id,
      catalogType,
      createdAt: new Date().toISOString(),
      expiresAt,
      usedAt: null
    }
  };
  await updateCustomerMetadata({ customerId, metadata: nextMeta });

  const schedule = await scheduleCatalogLinkNotifications({
    customerId,
    catalogUrl: publicUrl,
    forceNow: true,
    paymentType: catalogType,
    actor: auth.session.sub
  });
  const rulesActive = Boolean(schedule?.rulesActive);
  if (!rulesActive) {
    return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    link: publicUrl,
    notificationsScheduled: schedule?.scheduled ?? 0,
    notificationsSent: schedule?.sentNow ?? 0,
    notificationsRulesActive: rulesActive
  });
}
