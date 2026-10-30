"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormActions, PageSection } from "../ui/PageShell";
import { mapSendError, type CatalogMode, type SendKind } from "./sendRules";
import "./customers.css";

export type SendVariant = {
  /** Texto de la plantilla WhatsApp que recibirá el cliente. */
  preview: string;
  /** "" si se puede enviar; si no, el código del motivo (ver mapSendError). */
  blockReason: string;
};

const ENDPOINTS: Record<SendKind, string> = {
  link: "/api/customers/send-payment-link",
  catalog: "/api/customers/send-cart-link",
  token: "/api/customers/send-tokenization-link"
};

const OK_MESSAGES: Record<SendKind, string> = {
  link: "El link de pago fue enviado correctamente.",
  catalog: "El catálogo fue enviado correctamente.",
  token: "El link de débito automático fue enviado correctamente."
};

const PENDING_LABEL: Record<SendKind, string> = {
  link: "link de pago",
  catalog: "catálogo",
  token: "débito automático"
};

function notifyRealtime(status: "ok" | "fail", message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("notification", {
      detail: {
        id: `msg:${Date.now()}`,
        type: status === "ok" ? "success" : "error",
        title: status === "ok" ? "Mensaje enviado" : "Mensaje fallido",
        message,
        timestamp: new Date().toISOString(),
        href: "/notifications"
      }
    })
  );
}

function withSent(returnTo: string, kind: SendKind) {
  const url = new URL(returnTo, "http://localhost");
  url.searchParams.set("sent", kind);
  return `${url.pathname}${url.search}`;
}

/**
 * Formulario de las páginas "Enviar link de pago / catálogo / débito automático".
 * Sustituye a los tres modales de la lista de contactos: mismo endpoint, mismos
 * datos, pero el resultado se ve en la propia página y, al enviar, se vuelve a la
 * lista con sus filtros.
 */
export function SendMessageForm({
  kind,
  customerId,
  customerName,
  tenantId,
  productId,
  productName,
  returnTo,
  variants,
  initialMode = "PLAN"
}: {
  kind: SendKind;
  customerId: string;
  customerName: string;
  tenantId: string;
  productId: string;
  productName: string;
  returnTo: string;
  /** link y token usan "PLAN"; el catálogo trae una variante por tipo. */
  variants: Record<CatalogMode, SendVariant>;
  initialMode?: CatalogMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<CatalogMode>(kind === "catalog" ? initialMode : "PLAN");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const variant = variants[mode];
  const blocked = variant.blockReason;
  const needsAmount = kind === "link";
  const canSubmit = !sending && !blocked && (!needsAmount || amount.trim() !== "");
  const showTemplateLink = blocked === "missing_template" || error === "missing_template" || error === "no_rules";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(ENDPOINTS[kind], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId,
          customerName,
          tenantId,
          ...(kind === "link" ? { amount } : {}),
          ...(kind === "catalog" ? { catalogType: mode, ...(productId ? { productId } : {}) } : {}),
          ...(kind !== "catalog" ? { productId } : {})
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!(res.headers.get("content-type") || "").includes("application/json")) {
        setError("auth_required");
        notifyRealtime("fail", mapSendError("auth_required"));
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const code = String(json?.error || "send_failed");
        setError(code);
        notifyRealtime("fail", mapSendError(code));
        return;
      }
      const chatErr = String(json?.chatwootError || "").trim();
      if (chatErr) {
        setError(chatErr);
        notifyRealtime("fail", mapSendError(chatErr));
        return;
      }
      notifyRealtime("ok", OK_MESSAGES[kind]);
      router.push(withSent(returnTo, kind));
    } catch (err: any) {
      const code = String(err?.message || "send_failed");
      setError(code);
      notifyRealtime("fail", mapSendError(code));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="page-shell-body" onSubmit={onSubmit} noValidate={false}>
      {kind === "catalog" ? (
        <PageSection title="Tipo de catálogo">
          <div className="field">
            <label htmlFor="catalog-mode">Tipo de catálogo</label>
            <select id="catalog-mode" className="select" value={mode} onChange={(e) => setMode(e.target.value as CatalogMode)}>
              <option value="PLAN">Link de pago</option>
              <option value="SUBSCRIPTION">Débito automático</option>
            </select>
            <div className="field-hint">
              Link de pago: el cliente paga con un link. Débito automático: guarda tarjeta para cobros automáticos.
            </div>
          </div>
        </PageSection>
      ) : null}

      {kind === "link" ? (
        <PageSection title="Monto" description="Valor en pesos colombianos que pagará el cliente.">
          <div className="field">
            <label htmlFor="send-amount">Monto (COP)</label>
            <input
              id="send-amount"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ej: 390000"
              inputMode="numeric"
              required
            />
          </div>
        </PageSection>
      ) : null}

      <PageSection
        title="Checkout asociado"
        description={
          productName
            ? `Producto: ${productName}`
            : kind === "catalog"
              ? "El contacto no tiene producto asociado todavía. El cliente lo elegirá dentro del catálogo público."
              : "El contacto no tiene un producto asociado."
        }
      >
        {blocked ? (
          <div className="customers-alert is-error" role="alert">
            {mapSendError(blocked)}
          </div>
        ) : (
          <div className="field-hint">Todo listo para enviar el {PENDING_LABEL[kind]}.</div>
        )}
      </PageSection>

      <PageSection
        title="Mensaje que recibirá el cliente"
        description={`Se usa la plantilla WhatsApp activa de Notificaciones para ${
          kind === "token" || (kind === "catalog" && mode === "SUBSCRIPTION") ? "débito automático" : "link de pago"
        }.`}
      >
        <label className="customers-sr-only" htmlFor="send-preview">
          Vista previa del mensaje
        </label>
        <textarea id="send-preview" className="input" rows={6} readOnly value={variant.preview} />
        {showTemplateLink ? (
          <div>
            <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
              Configurar plantilla
            </a>
          </div>
        ) : null}
      </PageSection>

      {error ? (
        <div className="customers-alert is-error" role="alert">
          {mapSendError(error)}
        </div>
      ) : null}

      <FormActions cancelHref={returnTo}>
        <button className="primary btn-compact btn-send" type="submit" disabled={!canSubmit}>
          {sending ? "Enviando..." : "Enviar"}
        </button>
      </FormActions>
    </form>
  );
}
