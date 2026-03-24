import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { createManualOrder } from "../../../admin/_services/orders";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { getActiveCheckoutTemplates } from "../../../admin/_services/checkoutTemplates";
import { getCustomerById, updateCustomerMetadata } from "../../../admin/_services/customers";
import { sendChatwootMessageForCustomer } from "../../../admin/_services/chatwoot";
import { signPublicToken } from "../../../../lib/publicTokens";
import { getNotificationsConfig } from "@suscripciones/core/services/notificationsConfig";

function buildChatwootLinkMessage(args: { name?: string; lead: string; url: string }) {
  const safeName = String(args.name || "Cliente").trim() || "Cliente";
  const safeLead = String(args.lead || "").trim();
  const safeUrl = String(args.url || "").trim();
  const leadLine = safeLead ? `**${safeLead}**` : "";
  return [`Hola ${safeName},`, "", leadLine, safeUrl].filter((line) => line !== "").join("\n");
}

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
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
  const customerName = String(body?.customerName || "").trim() || "Cliente";
  const tenantId = String(body?.tenantId || "").trim();
  const templateIdInput = String(body?.templateId || "").trim();
  const amountInCents = pesosToCents(String(body?.amount || ""));
  if (!customerId || amountInCents <= 0) {
    return NextResponse.json({ ok: false, error: "monto_invalido" }, { status: 400 });
  }

  const notificationsConfig = await getNotificationsConfig().catch(() => null);
  if (notificationsConfig) {
    const rules = Array.isArray((notificationsConfig as any)?.rules) ? (notificationsConfig as any).rules : [];
    const templates = Array.isArray((notificationsConfig as any)?.templates) ? (notificationsConfig as any).templates : [];
    const candidates = rules.filter((r: any) => r?.enabled && String(r?.trigger || "") === "PAYMENT_LINK_CREATED");
    const filtered = candidates.filter((r: any) => {
      const types = r?.conditions?.requirePaymentTypeIn;
      return Array.isArray(types) ? types.includes("LINK") : false;
    });
    const rule = filtered[0] || null;
    const tpl = rule ? templates.find((t: any) => String(t?.id || "") === String(rule?.templateId || "")) : null;
    if (!tpl || !String(tpl?.chatwootTemplate?.name || "").trim()) {
      return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
    }
  }

  const reference = `CONTACT_${customerId.slice(0, 6)}_${Date.now()}`;
  const orderResult = await createManualOrder({
    req,
    body: {
      customerId,
      reference,
      currency: "COP",
      lineItems: [{ name: `Pago de ${customerName}`, quantity: 1, unitPriceInCents: amountInCents }],
      ...(tenantId ? { tenantId } : {}),
      sendChatwoot: false,
      source: "MANUAL"
    }
  });
  if (!orderResult.ok) {
    return NextResponse.json({ ok: false, error: orderResult.error || "request_failed" }, { status: orderResult.status });
  }

  const checkoutUrl = String(orderResult.checkoutUrl || "").trim();
  const rulesActive = Boolean(orderResult.notificationsRulesActive);
  let publicUrl: string | null = null;
  let resolvedTemplateId = templateIdInput || "";
  let chatwootError: string | null = null;
  let fallbackSent = false;
  try {
    const checkoutConfig = await getCheckoutConfig();
    const expiryHours = Number(checkoutConfig?.tokenExpiryHours || 24);
    const hours = Number.isFinite(expiryHours) && expiryHours > 0 ? Math.min(Math.max(Math.trunc(expiryHours), 1), 168) : 24;
    const baseFromSettings = String(checkoutConfig?.planBaseUrl || "").trim();
    if (baseFromSettings) {
      if (!resolvedTemplateId) {
        const items = await getActiveCheckoutTemplates({ tenantId: tenantId || null, kind: "PLAN" as any });
        const selected = items?.[0] || null;
        resolvedTemplateId = selected ? String((selected as any).id || "") : "";
      }

      const tokenValue = await signPublicToken({ sub: customerId, scope: "payment", ttlSeconds: hours * 60 * 60 });
      const normalized = baseFromSettings.replace(/\/$/, "");
      const hasPlanPath = /\/public\/plan$/i.test(normalized);
      const baseUrl = `${normalized}${hasPlanPath ? "" : "/public/plan"}/${tokenValue}`;
      const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
      publicUrl = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;

      const customer = await getCustomerById(customerId);
      if (!customer) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
      const prevMeta =
        customer?.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
      const nextMeta = {
        ...prevMeta,
        paymentLink: {
          url: publicUrl,
          token: tokenValue,
          checkoutUrl,
          kind: "PLAN",
          templateId: resolvedTemplateId || null,
          utmParams: checkoutConfig?.defaultUtmParams || null,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
          usedAt: null
        }
      };
      await updateCustomerMetadata({ customerId, metadata: nextMeta });
    }
  } catch {
    // ignore best-effort public link
  }

  if (!rulesActive) {
    const url = publicUrl || checkoutUrl;
    if (url) {
      const msg = buildChatwootLinkMessage({
        name: customerName || "Cliente",
        lead: "Aquí está tu link de pago:",
        url
      });
      const chatRes = await sendChatwootMessageForCustomer({ customerId, content: msg, actor: auth.session.sub });
      if (!chatRes.ok) {
        chatwootError = String((chatRes as any)?.error || "chatwoot_error");
      } else {
        fallbackSent = true;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checkoutUrl: checkoutUrl || null,
    publicUrl,
    notificationsScheduled: typeof orderResult.notificationsScheduled === "number" ? orderResult.notificationsScheduled : null,
    notificationsSent: typeof orderResult.notificationsSent === "number" ? orderResult.notificationsSent : null,
    notificationsRulesActive: rulesActive,
    chatwootError,
    fallbackSent
  });
}
