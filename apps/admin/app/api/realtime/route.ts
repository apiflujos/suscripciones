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

function buildContextSummary(context: any) {
  if (!context || typeof context !== "object") return "";
  const customer = firstText(
    context.customerName,
    context.customer,
    context.contactName,
    context.customerEmail,
    context.customerPhone,
    context.phone
  );
  const subscription = firstText(
    context.subscriptionRef,
    context.subscriptionReference,
    context.subscriptionId,
    context.subscription_id
  );
  const plan = firstText(context.planName, context.planCode, context.planId);
  const product = firstText(context.productName, context.productId);
  const reference = firstText(
    context.reference,
    context.txRef,
    context.transactionId,
    context.paymentId,
    context.wompiTransactionId,
    context.paymentLinkId
  );
  const actionHint = firstText(context.actionHint, context.hint, context.reasonCode);
  const parts = [
    customer ? `Cliente: ${customer}` : "",
    subscription ? `Suscripción: ${subscription}` : "",
    plan ? `Plan: ${plan}` : "",
    product ? `Producto: ${product}` : "",
    reference ? `Ref: ${reference}` : "",
    actionHint ? `Acción: ${actionHint}` : ""
  ].filter(Boolean);
  return compactText(parts.join(" · "), 260);
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
  const buildLogLink = (tab: string, params?: Record<string, string | undefined | null>) => {
    const qp = new URLSearchParams({ tab });
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v == null || v === "") continue;
        qp.set(k, v);
      }
    }
    return `/logs?${qp.toString()}`;
  };
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
    const paymentHref = buildLogLink("payments", {
      status: isApproved ? "APPROVED" : isFailed ? "FAILED" : "",
      q: ref || w.customerEmail || w.customerPhone || ""
    });
    const webhookHref = buildLogLink("webhooks", {
      processStatus: status || ""
    });
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
      sound: isApproved ? "cash" : isFailed ? "fail" : null,
      kind: isApproved ? "payment_approved" : isFailed ? "payment_failed" : status === "FAILED" ? "webhook_failed" : "webhook_received",
      href: isApproved || isFailed ? paymentHref : webhookHref,
      badge: isApproved ? "Pago" : isFailed ? "Fallido" : status || "Webhook"
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
      sound: null,
      kind: "job_failed",
      href: buildLogLink("jobs"),
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
        title: error ? "Asistente falló" : "Asistente listo",
        message: questionHint || (error ? "Error al generar respuesta." : "Respuesta lista para revisar."),
        sound: null,
        kind: error ? "ai_failed" : "ai_response",
        href: buildLogLink("system", { q: "ai." }),
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
        title: "Prueba de sonido",
        message: "Se emitió un evento de prueba desde el servidor.",
        sound: "cash",
        kind: "payment_approved",
        href: buildLogLink("system", { q: source }),
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
      title:
        kind === "message_sent"
          ? "Mensaje enviado"
          : kind === "message_failed"
            ? "Mensaje fallido"
            : kind === "link_sent"
              ? "Link generado"
              : kind === "link_failed"
                ? "Link fallido"
                : kind === "subscription_failed"
                  ? "Suscripción fallida"
                  : level === "ERROR"
                    ? "Alerta del sistema"
                    : "Aviso del sistema",
      message: finalMessage,
      sound: null,
      kind,
      href: buildLogLink("system", { q: source, level: level === "ERROR" ? "ERROR" : level === "WARN" ? "WARN" : "" }),
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
