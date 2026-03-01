import { getRequiredApiBase } from "../../lib/adminApi";
import { normalizeToken } from "../../lib/normalizeToken";

const encoder = new TextEncoder();

function ssePayload(data: any) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function toIso(input?: string | null) {
  if (!input) return "";
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

export async function GET(req: Request) {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return new Response("missing_admin_token", { status: 401 });

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = toIso(sinceParam) || new Date(Date.now() - 2 * 60 * 1000).toISOString();

  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const poll = async () => {
        if (closed) return;
        try {
          const [webhooksRes, jobsRes, systemRes] = await Promise.all([
            fetch(`${API_BASE}/admin/webhook-events?from=${encodeURIComponent(since)}&take=20`, {
              headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
              cache: "no-store"
            }),
            fetch(`${API_BASE}/admin/logs/jobs?take=40`, {
              headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
              cache: "no-store"
            }),
            fetch(`${API_BASE}/admin/logs/system?from=${encodeURIComponent(since)}&take=30`, {
              headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
              cache: "no-store"
            })
          ]);
          const webhooksJson = await webhooksRes.json().catch(() => ({ items: [] }));
          const jobsJson = await jobsRes.json().catch(() => ({ items: [] }));
          const systemJson = await systemRes.json().catch(() => ({ items: [] }));
          const webhooks = Array.isArray(webhooksJson.items) ? webhooksJson.items : [];
          const jobs = Array.isArray(jobsJson.items) ? jobsJson.items : [];
          const system = Array.isArray(systemJson.items) ? systemJson.items : [];

          const events: any[] = [];
          for (const w of webhooks) {
            const status = String(w.processStatus || "");
            const level = status === "FAILED" ? "error" : "info";
            const paymentStatus = String(w.paymentStatus || "").toUpperCase();
            const isApproved = paymentStatus === "APPROVED" && status === "PROCESSED";
            const isFailed = status === "FAILED" || paymentStatus === "DECLINED";
            const customer = w.customerName || w.customerEmail || w.customerPhone || "Cliente";
            const ref = w.reference || w.wompiPaymentLinkId || w.wompiTransactionId || "";
            const typeLabel = w.paymentType || "Pago";
            const planLabel = w.planName ? ` · ${w.planName}` : "";
            events.push({
              id: `wh_${w.id}`,
              type: "webhook",
              level,
              ts: w.receivedAt,
              title: isApproved ? "Pago aprobado" : isFailed ? "Pago fallido" : status === "FAILED" ? "Webhook fallido" : "Webhook recibido",
              message: isApproved
                ? `${customer} · ${typeLabel}${planLabel}`
                : isFailed
                  ? `${customer} · ${typeLabel}${planLabel}`
                  : `${customer} · ${w.paymentStatus || "estado"}${ref ? ` · ${ref}` : ""}`,
              paymentStatus,
              paymentType: w.paymentType || null,
              sound: isApproved ? "cash" : isFailed ? "fail" : null
            });
          }

          const sinceMs = new Date(since).getTime();
          for (const j of jobs) {
            const updatedAt = new Date(j.updatedAt || j.runAt || "").getTime();
            if (!Number.isFinite(updatedAt) || updatedAt <= sinceMs) continue;
            const status = String(j.status || "");
            if (status !== "FAILED") continue;
            const title = "Job fallido";
            const detail = j.lastError || "Sin detalle";
            events.push({
              id: `job_${j.id}`,
              type: "job",
              level: "error",
              ts: j.updatedAt,
              title,
              message: `${j.type || "JOB"} · ${detail}`,
              sound: "fail"
            });
          }

          for (const s of system) {
            const createdAt = s.createdAt || s.updatedAt || s.ts;
            const createdMs = new Date(createdAt || "").getTime();
            if (!Number.isFinite(createdMs) || createdMs <= sinceMs) continue;
            const level = String(s.level || "").toUpperCase();
            if (level !== "WARN" && level !== "ERROR") continue;
            const message = String(s.message || s.source || "Evento del sistema");
            const compact = message.length > 160 ? `${message.slice(0, 157)}…` : message;
            events.push({
              id: `sys_${s.id}`,
              type: "system",
              level: level === "ERROR" ? "error" : "info",
              ts: createdAt,
              title: level === "ERROR" ? "Alerta del sistema" : "Aviso del sistema",
              message: compact,
              sound: level === "ERROR" ? "fail" : null
            });
          }

          if (events.length) {
            controller.enqueue(ssePayload({ serverTime: new Date().toISOString(), events }));
          } else {
            controller.enqueue(ssePayload({ serverTime: new Date().toISOString(), events: [] }));
          }
        } catch {
          controller.enqueue(ssePayload({ serverTime: new Date().toISOString(), events: [] }));
        }
      };

      const interval = setInterval(poll, 15000);
      poll();

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
