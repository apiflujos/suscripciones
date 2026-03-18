import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { getCustomerById, updateCustomerMetadata } from "../../../admin/_services/customers";
import { scheduleTokenizationLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { sendChatwootMessageForCustomer } from "../../../admin/_services/chatwoot";
import { signPublicToken } from "../../../../lib/publicTokens";

function buildChatwootLinkMessage(args: { name?: string; lead: string; url: string }) {
  const safeName = String(args.name || "Cliente").trim() || "Cliente";
  const safeLead = String(args.lead || "").trim();
  const safeUrl = String(args.url || "").trim();
  const leadLine = safeLead ? `**${safeLead}**` : "";
  return [`Hola ${safeName},`, "", leadLine, safeUrl].filter((line) => line !== "").join("\n");
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
  const templateId = String(body?.templateId || "").trim();
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const checkoutConfig = await getCheckoutConfig();
  const baseFromSettings = String(checkoutConfig.subscriptionBaseUrl || "").trim();
  const base = baseFromSettings.replace(/\/$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "missing_subscription_base_url" }, { status: 400 });

  const ensureHttps = (value: string) => {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value.replace(/^\/+/, "")}`;
  };

  const expiryHours = Number(checkoutConfig?.tokenExpiryHours || 24);
  const hours = Number.isFinite(expiryHours) && expiryHours > 0 ? Math.min(Math.max(Math.trunc(expiryHours), 1), 168) : 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const linkToken = await signPublicToken({ sub: customerId, scope: "tokenization", ttlSeconds: hours * 60 * 60 });
  const normalized = ensureHttps(base).replace(/\/$/, "");
  const hasSubPath = /\/public\/suscripcion$/i.test(normalized);
  const link = `${normalized}${hasSubPath ? "" : "/public/suscripcion"}/${linkToken}`;

  const existing = await getCustomerById(customerId);
  if (!existing) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
  const prevMeta = (existing?.metadata ?? {}) as any;

  const nextMeta = {
    ...prevMeta,
    tokenizationLink: {
      url: link,
      token: linkToken,
      ...(templateId ? { templateId } : {}),
      createdAt: new Date().toISOString(),
      expiresAt,
      usedAt: null
    }
  };
  const stored = await updateCustomerMetadata({ customerId, metadata: nextMeta });
  if (!stored) {
    return NextResponse.json({ ok: false, error: "store_failed" }, { status: 500 });
  }

  const schedule = await scheduleTokenizationLinkNotifications({
    customerId,
    tokenUrl: link,
    forceNow: true,
    actor: auth.session.sub
  });
  const rulesActive = Boolean(schedule?.rulesActive);

  let chatwootError: string | null = null;
  let fallbackSent = false;
  if (!rulesActive) {
    const msg = buildChatwootLinkMessage({
      name: customerName || "Cliente",
      lead: "Activa tu suscripción guardando tu método de pago aquí:",
      url: link
    });
    try {
        const chatRes = await sendChatwootMessageForCustomer({ customerId, content: msg, actor: auth.session.sub });
        if (!chatRes.ok) {
          chatwootError = String((chatRes as any)?.error || "chatwoot_error");
        } else {
          fallbackSent = true;
        }
      } catch (err: any) {
        chatwootError = String(err?.message || "chatwoot_request_failed");
      }
  }

  return NextResponse.json({
    ok: true,
    link,
    notificationsScheduled: schedule?.scheduled ?? 0,
    notificationsSent: schedule?.sentNow ?? 0,
    notificationsRulesActive: rulesActive,
    chatwootError,
    fallbackSent
  });
}
