import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { getActiveCheckoutTemplates } from "../../../admin/_services/checkoutTemplates";
import { getCustomerById, updateCustomerMetadata } from "../../../admin/_services/customers";
import { scheduleCatalogLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { sendChatwootMessageForCustomer } from "../../../admin/_services/chatwoot";

function buildChatwootLinkMessage(args: { name?: string; lead: string; url: string }) {
  const safeName = String(args.name || "Cliente").trim() || "Cliente";
  const safeLead = String(args.lead || "").trim();
  const safeUrl = String(args.url || "").trim();
  const leadLine = safeLead ? `**${safeLead}**` : "";
  return [`Hola ${safeName},`, "", leadLine, safeUrl].filter((line) => line !== "").join("\n");
}

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
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const customerName = String(body?.customerName || "").trim() || "Cliente";
  const tenantId = String(body?.tenantId || "").trim();
  const templateIdInput = String(body?.templateId || "").trim();
  const catalogTypeRaw = String(body?.catalogType || "").trim().toUpperCase();
  const catalogType = catalogTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN";
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const checkoutConfig = await getCheckoutConfig();
  const baseFromSettings =
    String((catalogType === "SUBSCRIPTION" ? checkoutConfig?.subscriptionBaseUrl : checkoutConfig?.planBaseUrl) || "").trim() ||
    String(checkoutConfig?.planBaseUrl || checkoutConfig?.subscriptionBaseUrl || "").trim();
  const base = baseFromSettings.replace(/\/$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "missing_public_base_url" }, { status: 400 });

  const templates = await getActiveCheckoutTemplates({ tenantId: tenantId || null, kind: "CART" as any });
  const cartTemplates = templates.filter((t: any) => String(t?.kind || "") === "CART" && Boolean(t?.active));
  const selectedTemplate =
    (templateIdInput ? cartTemplates.find((t: any) => String(t?.id || "") === templateIdInput) : null) ||
    cartTemplates[0] ||
    null;
  if (!selectedTemplate) {
    return NextResponse.json({ ok: false, error: "missing_cart_template" }, { status: 400 });
  }

  const linkToken = crypto.randomBytes(18).toString("hex");
  const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
  const publicUrl = buildPublicUrl(base, `/public/cart/${linkToken}`, utm);

  const customer = await getCustomerById(customerId);
  if (!customer) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
  const prevMeta =
    customer?.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
  const expiryHours = Number((selectedTemplate as any)?.expiryHours || 0);
  const hours = Number.isFinite(expiryHours) && expiryHours > 0 ? Math.min(Math.max(Math.trunc(expiryHours), 1), 168) : 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

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
    actor: auth.session.email
  });
  const rulesActive = Boolean(schedule?.rulesActive);

  let chatwootError: string | null = null;
  let fallbackSent = false;
  if (!rulesActive && publicUrl) {
    const msg = buildChatwootLinkMessage({
      name: customerName || "Cliente",
      lead: "Aquí está tu link de catálogo:",
      url: publicUrl
    });
    const chatRes = await sendChatwootMessageForCustomer({ customerId, content: msg, actor: auth.session.email });
    if (!chatRes.ok) {
      chatwootError = String((chatRes as any)?.error || "chatwoot_error");
    } else {
      fallbackSent = true;
    }
  }

  return NextResponse.json({
    ok: true,
    link: publicUrl,
    notificationsScheduled: schedule?.scheduled ?? 0,
    notificationsSent: schedule?.sentNow ?? 0,
    notificationsRulesActive: rulesActive,
    chatwootError,
    fallbackSent
  });
}
