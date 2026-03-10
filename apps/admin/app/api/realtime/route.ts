import { getRequiredApiBase } from "../../lib/adminApi";
import { normalizeToken } from "../../lib/normalizeToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function ssePayload(data: any) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function toIso(input?: string | null) {
  if (!input) return "";
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

function asText(input: unknown) {
  if (input == null) return "";
  const txt = String(input).trim();
  return txt;
}

function compactText(input: string, max = 160) {
  const clean = asText(input);
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

function firstText(...values: unknown[]) {
  for (const v of values) {
    const txt = asText(v);
    if (txt) return txt;
  }
  return "";
}

function formatSystemMessage(raw: string) {
  const clean = asText(raw);
  if (!clean) return "Evento del sistema";
  if (clean.includes("_") && !clean.includes(" ")) return clean.replace(/_/g, " ");
  return clean;
}

function isNoisySystemLog(source: string, message: string) {
  const s = String(source || "").toLowerCase().trim();
  const m = String(message || "").toLowerCase();

  // Ignorar ruido técnico y logs de auditoría interna
  if (s === "sql.console" || s === "data_trainer" || s === "audit.billing") return true;
  
  // Ignorar flujo normal de notificaciones y webhooks (solo ruido en la campanita)
  if (s === "notifications.dispatch" || s === "notifications.schedule") return true;
  if (s === "chatwoot.send" && m.includes("enviado")) return true;
  if (s === "webhooks.wompi" && m.includes("recibido")) return true;
  if (s === "processwompievent" && (m.includes("recibido") || m.includes("concluido") || m.includes("conciliado"))) return true;
  
  // Ignorar ruidos de inferencia (ya se manejan en el flujo de pagos)
  if (m.includes("proceeding by inference") || m.includes("asociar automáticamente")) return true;
  if (m.includes("webhook sin suscripción asociada; pago creado en fallback")) return true;
  if (m.includes("link de pago no encontrado: asociación automática")) return true;
  if (m.includes("forward returned 5xx but treated as accepted")) return true;

  return false;
}

function formatSystemTitle(source: string, message: string, kind: string, level: string): string {
  const m = message.toLowerCase();
  const s = source.toLowerCase();

  if (kind === "payment_approved") return "Pago Aprobado";
  if (kind === "payment_failed") return "Pago Fallido";
  if (kind === "subscription_failed") return "Error en Suscripción";
  if (s.includes("jobs.payment_retry")) return "Reintento de Cobro";
  if (s.includes("subscriptions.lifecycle")) {
    if (m.includes("past_due")) return "Suscripción en Mora";
    if (m.includes("expired")) return "Suscripción Expirada";
  }
  if (m.includes("link generado") || kind === "link_sent") return "Link de Pago Creado";
  if (m.includes("mensaje enviado") || kind === "message_sent") return "Mensaje Enviado";
  
  if (level === "ERROR") return "Alerta Crítica";
  if (level === "WARN") return "Advertencia";
  return "Aviso del Sistema";
}

function moduleHrefFromEvent(args: { source?: string; kind?: string; message?: string; fallback?: string }) {
  const source = String(args.source || "").toLowerCase().trim();
  const kind = String(args.kind || "").toLowerCase().trim();
  const message = String(args.message || "").toLowerCase();

  if (kind.startsWith("payment_") || source.startsWith("webhooks.wompi") || source.startsWith("payments.")) return "/payments";
  if (kind.startsWith("subscription_") || source.startsWith("subscriptions.") || source.startsWith("jobs.payment_retry")) return "/billing";
  if (kind.startsWith("message_") || source.startsWith("notifications.") || source.startsWith("chatwoot.")) return "/notifications";
  if (source.startsWith("customers.") || source.startsWith("contacts.")) return "/customers";
  if (source.startsWith("products.") || source.startsWith("plans.")) return "/products";
  if (source.startsWith("settings.")) return "/settings";
  if (/pago|payment|wompi|concili/.test(message)) return "/payments";
  if (/suscrip|cobro|reintento/.test(message)) return "/billing";
  if (/notific|mensaje|chatwoot|whatsapp/.test(message)) return "/notifications";
  return args.fallback || "/";
}

function buildContextSummary(context: any) {
  if (!context || typeof context !== "object") return "";
  const customer = firstText(
    context.customerName,
    context.customer,
    context.contactName,
    context.customerEmail,
    context.customerPhone
  );
  const subscription = firstText(
    context.subscriptionRef,
    context.subscriptionReference
  );
  const plan = firstText(context.planName, context.planCode);
  const reference = firstText(
    context.reference,
    context.txRef,
    context.transactionId,
    context.wompiTransactionId
  );
  const actionHint = firstText(context.actionHint, context.reasonCode);
  
  const parts = [
    customer ? `Cliente: ${customer}` : "",
    subscription ? `Sub: ${subscription}` : "",
    plan ? `Plan: ${plan}` : "",
    reference ? `Ref: ${reference}` : "",
    actionHint ? `Acción: ${actionHint}` : ""
  ].filter(Boolean);
  
  return compactText(parts.join(" · "), 320);
}

async function collectEvents(apiBase: string, token: string, since: string) {
  const [webhooksRes, jobsRes, systemRes] = await Promise.all([
    fetch(`${apiBase}/admin/webhook-events?from=${encodeURIComponent(since)}&take=20`, {
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
      cache: "no-store"
    }),
    fetch(`${apiBase}/admin/logs/jobs?take=40`, {
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
      cache: "no-store"
    }),
    fetch(`${apiBase}/admin/logs/system?from=${encodeURIComponent(since)}&take=30`, {
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
  const buildAppLink = (basePath: string, params?: Record<string, string | undefined | null>) => {
    const qp = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v == null || v === "") continue;
        qp.set(k, v);
      }
    }
    const query = qp.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  for (const w of webhooks) {
    const status = String(w.processStatus || "");
    const level = status === "FAILED" ? "error" : "info";
    const paymentStatus = String(w.paymentStatus || "").toUpperCase();
    const isApproved = paymentStatus === "APPROVED" && status === "PROCESSED";
    const isFailed = status === "FAILED" || paymentStatus === "DECLINED";
    const ref = w.reference || w.wompiPaymentLinkId || w.wompiTransactionId || "";
    const customer =
      w.customerName ||
      w.customerEmail ||
      w.customerPhone ||
      (ref ? `Ref ${String(ref).slice(0, 20)}${String(ref).length > 20 ? "…" : ""}` : "Cliente");
    const typeLabel = w.paymentType || "Pago";
    const planLabel = w.planName ? ` · ${w.planName}` : "";
    const paymentHref = buildAppLink("/payments", {
      status: isApproved ? "APPROVED" : isFailed ? "FAILED" : "",
      q: ref || w.customerEmail || w.customerPhone || ""
    });
    const webhookHref = paymentHref;
    const customerMeta = {
      customerName: w.customerName || null,
      customerEmail: w.customerEmail || null,
      customerPhone: w.customerPhone || null,
      tenantId: w.tenantId || w.tenant?.id || null,
      reference: ref || null,
      paymentStatus: w.paymentStatus || null,
      paymentType: w.paymentType || null
    };
    events.push({
      id: `wh_${w.id}`,
      type: "webhook",
      level,
      ts: w.receivedAt,
      source: "webhooks.wompi",
      title: isApproved ? "Pago aprobado" : isFailed ? "Pago fallido" : status === "FAILED" ? "Webhook fallido" : "Webhook recibido",
      message: isApproved
        ? `${customer} · ${typeLabel}${planLabel}`
        : isFailed
          ? `${customer} · ${typeLabel}${planLabel}`
          : `${customer} · ${w.paymentStatus || "estado"}${ref ? ` · ${ref}` : ""}`,
      paymentStatus,
      paymentType: w.paymentType || null,
      sound: isApproved ? "cash" : isFailed ? "fail" : null,
      kind: isApproved ? "payment_approved" : isFailed ? "payment_failed" : status === "FAILED" ? "webhook_failed" : "webhook_received",
      href: isApproved || isFailed ? paymentHref : webhookHref,
      badge: isApproved ? "Pago" : isFailed ? "Fallido" : status || "Webhook",
      meta: customerMeta
    });
  }

  const sinceMs = new Date(since).getTime();
  for (const j of jobs) {
    const updatedAt = new Date(j.updatedAt || j.runAt || "").getTime();
    if (!Number.isFinite(updatedAt) || updatedAt <= sinceMs) continue;
    const status = String(j.status || "");
    if (status !== "FAILED") continue;
    const type = String(j.type || "");
    const detail = String(j.lastError || "Sin detalle");
    if (
      type === "PAYMENT_RETRY" &&
      /subscription_canceled|subscription_not_found|charge_not_due_yet|not_due_yet|invalid_mode_not_auto_debit|blocked_non_auto_debit_subscription|disabled_manual_hotfix_mass_fake_success/.test(detail)
    ) {
      continue;
    }
    const title = "Job fallido";
    events.push({
      id: `job_${j.id}`,
      type: "job",
      level: "error",
      ts: j.updatedAt,
      source: "jobs.runner",
      title,
      message: `${type || "JOB"} · ${detail}`,
      sound: null,
      kind: "job_failed",
      href: moduleHrefFromEvent({
        source: "jobs.runner",
        kind: "job_failed",
        message: `${type || "JOB"} ${detail}`
      }),
      badge: "Job"
    });
  }

  for (const s of system) {
    const createdAt = s.createdAt || s.updatedAt || s.ts;
    const createdMs = new Date(createdAt || "").getTime();
    if (!Number.isFinite(createdMs) || createdMs <= sinceMs) continue;
    const level = String(s.level || "").toUpperCase();
    const source = String(s.source || "");
    const ctx = s.context || null;
    const message = formatSystemMessage(String(s.message || s.source || "Evento del sistema"));
    if (isNoisySystemLog(source, message)) continue;
    const contextSummary = buildContextSummary(ctx);
    const compact = compactText(message, 170);
    const finalMessage = compactText(contextSummary ? `${compact} · ${contextSummary}` : compact, 320);
    const isAi = source.startsWith("ai.");
    const isRealtimeTest = source === "realtime.test";
    if (isAi) {
      const answer = String(ctx?.answer || "").trim();
      const error = String(ctx?.error || "").trim();
      if (!answer && !error) continue;
      const question = String(ctx?.question || "").trim();
      const questionHint = question ? (question.length > 80 ? `${question.slice(0, 77)}…` : question) : "";
      events.push({
        id: `ai_${s.id}`,
        type: "system",
        level: error ? "error" : "info",
        ts: createdAt,
        source,
        title: error ? "Asistente falló" : "Asistente listo",
        message: questionHint || (error ? "Error al generar respuesta." : "Respuesta lista para revisar."),
        sound: null,
        kind: error ? "ai_failed" : "ai_response",
        href: "/logs?tab=system&q=ai.",
        badge: "IA",
        meta: ctx
      });
      continue;
    }
    if (isRealtimeTest) {
      events.push({
        id: `rt_${s.id}`,
        type: "system",
        level: "info",
        ts: createdAt,
        source,
        title: "Prueba de sonido",
        message: "Se emitió un evento de prueba desde el servidor.",
        sound: "cash",
        kind: "payment_approved",
        href: "/payments",
        badge: "Prueba",
        meta: ctx
      });
      continue;
    }
    const isMessage = source.startsWith("chatwoot.") || source.startsWith("notifications.");
    const isLink = source.startsWith("subscriptions.payment_link");
    const isSubscription = source.startsWith("subscriptions.");
    const isPublic = source.startsWith("public.");
    const isInformative =
      level === "INFO" && (isMessage || isLink || message.toLowerCase().includes("link") || message.toLowerCase().includes("mensaje"));
    if (level !== "WARN" && level !== "ERROR" && !isInformative) continue;
    const isFailure = level === "ERROR" || message.toLowerCase().includes("fallido") || message.toLowerCase().includes("failed");
    const kind = isMessage
      ? isFailure
        ? "message_failed"
        : "message_sent"
      : isLink
        ? isFailure
          ? "link_failed"
          : "link_sent"
        : isSubscription
          ? "subscription_failed"
          : isPublic
            ? "public_event"
            : isFailure
              ? "system_failed"
              : "system_info";
    const badge =
      kind === "message_sent" || kind === "message_failed"
        ? "Mensaje"
        : kind === "link_sent" || kind === "link_failed"
          ? "Link"
          : kind === "subscription_failed"
            ? "Suscripción"
            : level === "ERROR"
              ? "Error"
              : level === "WARN"
                ? "Aviso"
                : "Sistema";
    events.push({
      id: `sys_${s.id}`,
      type: "system",
      level: level === "ERROR" ? "error" : "info",
      ts: createdAt,
      source,
      title: formatSystemTitle(source, message, kind, level),
      message: finalMessage,
      sound: null,
      kind,
      href: moduleHrefFromEvent({ source, kind, message: finalMessage }),
      badge,
      meta: ctx
    });
  }

  return { events, serverTime: new Date().toISOString() };
}

export async function GET(req: Request) {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return new Response("missing_admin_token", { status: 401 });

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = toIso(sinceParam) || new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const mode = url.searchParams.get("mode") || "";

  if (mode === "poll") {
    try {
      const payload = await collectEvents(API_BASE, token, since);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
      });
    } catch {
      return new Response(JSON.stringify({ events: [], serverTime: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
  }

  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      let lastSince = since;
      controller.enqueue(encoder.encode("retry: 4000\n\n"));
      const poll = async () => {
        if (closed) return;
        try {
          const payload = await collectEvents(API_BASE, token, lastSince);
          if (payload.serverTime) lastSince = payload.serverTime;
          controller.enqueue(ssePayload(payload));
        } catch {
          controller.enqueue(ssePayload({ serverTime: new Date().toISOString(), events: [] }));
        }
        controller.enqueue(encoder.encode(": ping\n\n"));
      };

      const interval = setInterval(poll, 5000);
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
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
