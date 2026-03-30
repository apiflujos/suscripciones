"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ChartItem = { label: string; value: number; tone?: "success" | "warning" | "danger" | "info" };
type AiChart = { type: "bars"; title: string; items: ChartItem[] };

type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestId?: string;
  pending?: boolean;
  chart?: AiChart | null;
};

function toneColor(tone?: ChartItem["tone"]) {
  if (tone === "success") return "var(--status-success)";
  if (tone === "warning") return "var(--status-warning)";
  if (tone === "danger") return "var(--status-danger)";
  if (tone === "info") return "var(--status-info)";
  return "var(--primary)";
}

function BarsChart({ chart }: { chart: AiChart }) {
  const max = Math.max(1, ...chart.items.map((i) => i.value));
  return (
    <div className="ai-chart">
      <div className="ai-chart-title">{chart.title}</div>
      <div className="ai-chart-bars">
        {chart.items.map((item) => (
          <div className="ai-chart-row" key={item.label}>
            <span className="ai-chart-label">{item.label}</span>
            <div className="ai-chart-track">
              <div
                className="ai-chart-bar"
                style={{ width: `${Math.max(4, (item.value / max) * 100)}%`, background: toneColor(item.tone) }}
              />
            </div>
            <span className="ai-chart-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiAssistant({
  from,
  to,
  tenantId,
  customerId,
  productId,
  scope,
  title,
  subtitle,
  emptyText,
  placeholder
}: {
  from?: string;
  to?: string;
  tenantId?: string;
  customerId?: string;
  productId?: string;
  scope?: "logs" | "metrics" | "customer" | "product";
  title?: string;
  subtitle?: string;
  emptyText?: string;
  placeholder?: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rangeLabel = useMemo(() => {
    if (!from && !to) return "Últimos 30 días";
    const parts = [from ? `Desde ${from}` : null, to ? `Hasta ${to}` : null].filter(Boolean);
    return parts.join(" · ");
  }, [from, to]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const qs = new URLSearchParams({ take: "12" });
        if (scope) qs.set("scope", scope);
        if (tenantId) qs.set("tenantId", tenantId);
        if (customerId) qs.set("customerId", customerId);
        if (productId) qs.set("productId", productId);
        const res = await fetch(`/api/ai/history?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        const items = Array.isArray(json.items) ? json.items : [];
        const sorted = items
          .slice()
          .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const restored: AiMessage[] = [];
        for (const item of sorted) {
          const ctx = item.context || {};
          const ctxScope = String(ctx.scope || "").trim();
          const ctxTenantId = String(ctx.tenantId || "").trim();
          const ctxCustomerId = String(ctx.customerId || "").trim();
          const ctxProductId = String(ctx.productId || "").trim();
          if (scope) {
            if (!ctxScope || ctxScope !== scope) continue;
          }
          if (tenantId && ctxTenantId && tenantId !== ctxTenantId) continue;
          if (customerId && ctxCustomerId && customerId !== ctxCustomerId) continue;
          if (productId && ctxProductId && productId !== ctxProductId) continue;
          const question = String(ctx.question || "").trim();
          const answer = String(ctx.answer || ctx.error || "").trim();
          if (question) {
            restored.push({ id: `h_q_${item.id}`, role: "user", content: question });
          }
          if (answer) {
            restored.push({
              id: `h_a_${item.id}`,
              role: "assistant",
              content: answer,
              requestId: ctx.requestId,
              chart: ctx.chart || null
            });
          }
        }
        if (restored.length) setMessages(restored);
      } catch {}
    };
    loadHistory();
  }, []);

  useEffect(() => {
    const onAiResponse = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail || {};
      const ctx = detail?.context || detail?.meta || detail || {};
      const requestId = String(ctx.requestId || detail.requestId || "").trim();
      const ctxScope = String(ctx.scope || "").trim();
      const ctxTenantId = String(ctx.tenantId || "").trim();
      const ctxCustomerId = String(ctx.customerId || "").trim();
      const ctxProductId = String(ctx.productId || "").trim();
      if (scope && ctxScope && ctxScope !== scope) return;
      if (customerId && ctxCustomerId && customerId !== ctxCustomerId) return;
      if (tenantId && ctxTenantId && tenantId !== ctxTenantId) return;
      if (productId && ctxProductId && productId !== ctxProductId) return;
      const answer = String(ctx.answer || ctx.error || detail.message || "").trim();
      if (!answer) return;

      setMessages((prev) => {
        let updated = false;
        let pendingIndex = -1;
        const next = prev.map((m, idx) => {
          if (!requestId || m.requestId !== requestId) {
            if (pendingIndex < 0 && m.pending) pendingIndex = idx;
            return m;
          }
          updated = true;
          return { ...m, content: answer, pending: false, chart: ctx.chart || null };
        });
        if (!updated && pendingIndex >= 0) {
          const pending = next[pendingIndex];
          next[pendingIndex] = {
            ...pending,
            content: answer,
            pending: false,
            chart: ctx.chart || null,
            requestId: requestId || pending.requestId
          };
          updated = true;
        }
        if (!updated) {
          next.push({
            id: `ai_${Date.now()}`,
            role: "assistant",
            content: answer,
            requestId,
            pending: false,
            chart: ctx.chart || null
          });
        }
        return next;
      });
    };
    window.addEventListener("apiflujos:ai-response", onAiResponse as EventListener);
    return () => window.removeEventListener("apiflujos:ai-response", onAiResponse as EventListener);
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const sendPrompt = async () => {
    const q = prompt.trim();
    if (!q || sending) return;
    setError(null);
    setPrompt("");

    const localId = `pending_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `q_${Date.now()}`, role: "user", content: q },
      { id: localId, role: "assistant", content: "Procesando...", pending: true, requestId: localId }
    ]);

    setSending(true);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, from, to, tenantId, customerId, productId, scope })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String(json.error || "No se pudo enviar la consulta.");
        setError(msg);
        setMessages((prev) =>
          prev.map((m) => (m.requestId === localId ? { ...m, content: `Error: ${msg}`, pending: false } : m))
        );
        return;
      }
      const requestId = String(json.requestId || localId);
      setMessages((prev) =>
        prev.map((m) => (m.requestId === localId ? { ...m, requestId, content: "Analizando logs..." } : m))
      );
    } catch (err: any) {
      const msg = String(err?.message || "No se pudo enviar la consulta.");
      setError(msg);
      setMessages((prev) =>
        prev.map((m) => (m.requestId === localId ? { ...m, content: `Error: ${msg}`, pending: false } : m))
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ai-assistant">
      <div className="ai-header">
        <div>
          <div className="ai-title">{title || "Asistente de Logs"}</div>
          <div className="ai-subtitle">{subtitle || rangeLabel}</div>
        </div>
        <div className="ai-badge">IA</div>
      </div>
      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="ai-empty">
            {emptyText || "Pregunta por pagos, webhooks, jobs o eventos recientes. Ej: “¿Hubo pagos fallidos hoy?”."}
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`ai-message ${m.role === "user" ? "is-user" : "is-assistant"}`}>
            <div className="ai-message-role">{m.role === "user" ? "Tú" : "IA"}</div>
            <div className="ai-message-content">{m.content}</div>
            {m.chart ? <BarsChart chart={m.chart} /> : null}
            {m.pending ? <div className="ai-message-pending">Procesando…</div> : null}
          </div>
        ))}
      </div>
      {error ? <div className="ai-error">{error}</div> : null}
      <div className="ai-input-row">
        <textarea
          className="input ai-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholder || "Escribe tu pregunta sobre logs o pagos..."}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendPrompt();
            }
          }}
        />
        <button
          className="primary btn-compact ai-send"
          type="button"
          data-loader="off"
          onClick={sendPrompt}
          disabled={!prompt.trim() || sending}
        >
          {sending ? "Enviando..." : "Preguntar"}
        </button>
      </div>
    </div>
  );
}
