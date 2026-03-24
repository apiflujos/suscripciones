import { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { listPaymentLogs } from "../../../admin/_services/logs";

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

    const payments = await listPaymentLogs({ take: Math.max(10, limit * 2) });
    const items = Array.isArray(payments?.items) ? payments.items : [];

    const notifications = items
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
      })
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
