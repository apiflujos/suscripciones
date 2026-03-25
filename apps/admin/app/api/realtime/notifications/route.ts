import { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";
import { listChatwootMessages, listPaymentLogs } from "../../../admin/_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const cookieToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
    const session = cookieToken ? await verifyAdminSessionToken(cookieToken) : null;
    if (!session) {
      const auth = await requireApiSession(req);
      if (!auth.ok) return auth.response;
    }

    const searchParams = req.nextUrl.searchParams;
    const limitRaw = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 5), 50) : 20;

    const [payments, chatwoot] = await Promise.all([
      listPaymentLogs({ take: Math.max(10, limit * 2) }),
      listChatwootMessages({ take: Math.max(10, limit * 2) })
    ]);

    const paymentItems = Array.isArray(payments?.items) ? payments.items : [];
    const messageItems = Array.isArray(chatwoot?.items) ? chatwoot.items : [];

    const paymentNotifications = paymentItems
      .filter((p: any) => ["APPROVED", "DECLINED", "ERROR", "VOIDED"].includes(String(p?.status || "").toUpperCase()))
      .map((p: any) => {
        const status = String(p?.status || "").toUpperCase();
        const approved = status === "APPROVED";
        const failed = status === "DECLINED" || status === "ERROR" || status === "VOIDED";
        const ts = p?.paidAt || p?.failedAt || p?.createdAt || new Date().toISOString();
        const amountPesos = Number.isFinite(Number(p?.amountInCents)) ? Math.round(Number(p.amountInCents) / 100) : null;
        const amountLabel = amountPesos != null ? new Intl.NumberFormat("es-CO").format(amountPesos) : "—";
        const currency = String(p?.currency || "COP");
        const customerName = String(p?.customer?.name || p?.subscription?.customer?.name || "").trim();
        const customerEmail = String(p?.customer?.email || p?.subscription?.customer?.email || "").trim();
        const customerPhone = String(p?.customer?.phone || p?.subscription?.customer?.phone || "").trim();
        const title = approved ? "Pago aprobado" : failed ? "Pago fallido" : "Pago";
        const message =
          customerName
            ? `${customerName} · ${amountLabel} ${currency}`
            : `Pago ${amountLabel} ${currency}`;
        return {
          id: p?.id || `${p?.reference || ""}:${ts}`,
          ts,
          title,
          message,
          level: approved ? "success" : failed ? "error" : "info",
          category: "pagos",
          href: "/payments",
          read: false,
          meta: {
            customerName,
            customerEmail,
            customerPhone,
            tenantId: p?.tenantId || null
          }
        };
      });

    const messageNotifications = messageItems
      .filter((m: any) => ["SENT", "FAILED"].includes(String(m?.status || "").toUpperCase()))
      .map((m: any) => {
        const status = String(m?.status || "").toUpperCase();
        const ok = status === "SENT";
        const ts = m?.sentAt || m?.createdAt || new Date().toISOString();
        const customerName = String(m?.customer?.name || "").trim();
        const customerEmail = String(m?.customer?.email || "").trim();
        const customerPhone = String(m?.customer?.phone || "").trim();
        const type = String(m?.type || "").toUpperCase();
        const offsetSeconds = Number(m?.providerResp?.meta?.offsetSeconds ?? 0);
        const label =
          type === "PAYMENT_LINK"
            ? "Notificación: link de pago"
            : type === "EXPIRY_WARNING"
              ? offsetSeconds > 0
                ? "Notificación: mora"
                : "Notificación: recordatorio de pago"
              : type === "PAYMENT_FAILED"
                ? "Notificación: pago fallido"
                : type === "PAYMENT_CONFIRMED"
                  ? "Notificación: pago exitoso"
                  : "Mensaje";
        const title = ok ? label : `${label} (fallida)`;
        const snippet = String(m?.content || "").trim().replace(/\s+/g, " ");
        const message = customerName ? `${customerName} · ${snippet.slice(0, 80)}` : snippet.slice(0, 80) || title;
        return {
          id: m?.id || `${customerEmail}:${ts}`,
          ts,
          title,
          message,
          level: ok ? "success" : "error",
          category: type === "PAYMENT_LINK" || type === "EXPIRY_WARNING" ? "pagos" : "clientes",
          href: "/notifications",
          read: false,
          meta: {
            customerName,
            customerEmail,
            customerPhone,
            tenantId: m?.tenantId || null
          }
        };
      });

    const notifications = [...paymentNotifications, ...messageNotifications]
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, limit);

    return new Response(JSON.stringify({ notifications }), {
      status: 200,
      headers: { 
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });
  } catch (error) {
    console.error("Error in realtime notifications:", error);
    return new Response(JSON.stringify({ notifications: [], error: "Internal error" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;
  if (!auth.session.permissions.includes("notifications:write")) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const payload = body?.payload ?? {};
  const { publishToChannel } = await import("../../../../lib/wsHub");
  const delivered = publishToChannel("notifications", payload);

  return new Response(JSON.stringify({ ok: true, delivered }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
