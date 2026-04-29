"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { deleteCustomer, updateCustomer } from "./actions";
import { LocalDateTime } from "../ui/LocalDateTime";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";
import { AppModal } from "../ui/AppModal";
import { CustomerEditModal } from "./CustomerEditModal";
import { isNotificationTemplateConfigured, renderNotificationTemplatePreview } from "../lib/notificationTemplate";
import { extractCustomerPaymentSourceId, readCustomerMetadata } from "../../../../packages/core/src/lib/customerMetadata";

function formatCopFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function formatPlanLabel(rawName: unknown, skuRaw?: unknown) {
  const name = String(rawName || "").replace(/^\s*\[\d+\]\s*/, "").trim();
  if (!name) return "—";
  const sku = normalizeSku(skuRaw);
  return sku ? `SKU ${sku} · ${name}` : name;
}

type LatestLink = {
  checkoutUrl: string;
  createdAt: string;
  chatwootStatus: string;
  chatwootError?: string;
};

type CustomerRow = {
  id: string;
  tenantId?: string | null;
  tenantIds?: string[];
  tenantName?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt?: string;
  metadata?: any;
};

export function CustomersTable({
  items,
  view = "cards",
  currentTenantId,
  latestLinks,
  subscriptionsByCustomer,
  products,
  empresas,
  checkoutTemplates,
  checkoutConfig,
  notificationsConfig,
  tenants,
  createCustomer,
  createPlanAndSubscription,
  csrfToken,
  returnTo,
  initialTxCustomerId
}: {
  items: CustomerRow[];
  view?: "cards" | "list";
  currentTenantId?: string;
  latestLinks: Record<string, LatestLink>;
  subscriptionsByCustomer: Record<string, { hasPlan: boolean; productName?: string; status?: string; collectionMode?: string; subscriptionId?: string; productId?: string; planId?: string }>;
  products: any[];
  empresas: any[];
  checkoutTemplates: any[];
  checkoutConfig?: any;
  notificationsConfig?: any;
  tenants: Array<{ id: string; name: string }>;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  returnTo?: string;
  initialTxCustomerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [txOpen, setTxOpen] = useState(false);
  const [txCustomer, setTxCustomer] = useState<CustomerRow | null>(null);
  const [sendingPaymentId, setSendingPaymentId] = useState<string | null>(null);
  const [sendingTokenId, setSendingTokenId] = useState<string | null>(null);
  const [sendingCartId, setSendingCartId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<Record<string, string>>({});
  const [sendOk, setSendOk] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState<{ open: boolean; title: string; message: string; status: "ok" | "fail" }>({
    open: false,
    title: "",
    message: "",
    status: "ok"
  });
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planModalCustomer, setPlanModalCustomer] = useState<CustomerRow | null>(null);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartModalCustomer, setCartModalCustomer] = useState<CustomerRow | null>(null);
  const [cartModalMode, setCartModalMode] = useState<"PLAN" | "SUBSCRIPTION">("PLAN");
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payModalCustomer, setPayModalCustomer] = useState<CustomerRow | null>(null);
  const [viewFichaOpen, setViewFichaOpen] = useState(false);
  const [viewFichaCustomer, setViewFichaCustomer] = useState<CustomerRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenModalCustomer, setTokenModalCustomer] = useState<CustomerRow | null>(null);
  const [clearingTokenId, setClearingTokenId] = useState<string | null>(null);
  const [tokenStateByCustomer, setTokenStateByCustomer] = useState<Record<string, boolean>>({});
  const planBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const cartBaseUrl = String(checkoutConfig?.cartBaseUrl || "").trim();
  const subscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const publicBaseUrl = String(checkoutConfig?.planBaseUrl || checkoutConfig?.cartBaseUrl || checkoutConfig?.subscriptionBaseUrl || "").trim();
  const missingPlanBase = !planBaseUrl;
  const missingSubBase = !subscriptionBaseUrl;
  const missingPublicBase = !publicBaseUrl;

  const lastActiveRef = useRef<HTMLElement | null>(null);

  function hasToken(customer: CustomerRow) {
    const localState = tokenStateByCustomer[String(customer.id)];
    if (typeof localState === "boolean") return localState;
    const meta = readCustomerMetadata(customer.metadata);
    if (Number.isFinite(extractCustomerPaymentSourceId(meta))) return true;
    const sources = meta.wompi?.paymentSources;
    return Array.isArray(sources) && sources.length > 0;
  }

  function initialsFor(customer: CustomerRow) {
    const base = (customer.name || customer.email || "CN").trim();
    if (!base) return "CN";
    const parts = base.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || "C";
    const b = parts.length > 1 ? parts[1][0] : (parts[0]?.[1] || "N");
    return `${a}${b}`.toUpperCase();
  }

  function resolveEffectiveTenantId(customer: CustomerRow) {
    return String(currentTenantId || customer.tenantId || customer.tenantIds?.[0] || "").trim();
  }

  const productById = useMemo(() => {
    const map = new Map<string, any>();
    (products || []).forEach((p: any) => {
      const id = String(p?.id || "").trim();
      if (id) map.set(id, p);
    });
    return map;
  }, [products]);

  function resolveCustomerProductId(customerId: string) {
    return String(subscriptionsByCustomer[String(customerId)]?.productId || "").trim();
  }

  function extractTemplateProductId(entry: any) {
    if (!entry) return "";
    if (typeof entry === "string") return String(entry).trim();
    if (typeof entry === "object") return String(entry?.id || "").trim();
    return "";
  }

  function templateMatchesProduct(template: any, productId: string) {
    const list = Array.isArray(template?.productIds) ? template.productIds : [];
    return list.some((entry: any) => String(extractTemplateProductId(entry)) === String(productId));
  }

  function templateMatchesTenant(template: any, tenantId?: string | null) {
    const resolvedTenantId = String(tenantId || "").trim();
    if (!resolvedTenantId) return true;
    const templateTenantId = String(template?.tenantId || "").trim();
    return !templateTenantId || templateTenantId === resolvedTenantId;
  }

  function getDefaultTemplateIdForKind(kind: "PLAN" | "SUBSCRIPTION" | "CART") {
    if (kind === "PLAN") return String(checkoutConfig?.defaultPlanTemplateId || "").trim();
    if (kind === "SUBSCRIPTION") return String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim();
    return String(checkoutConfig?.defaultCartTemplateId || "").trim();
  }

  function findTemplateForCustomer(kind: "PLAN" | "SUBSCRIPTION" | "CART", customer: CustomerRow, productId: string) {
    const effectiveTenantId = resolveEffectiveTenantId(customer);
    const candidates = checkoutTemplates.filter((t: any) => {
      return Boolean(t?.active) && String(t?.kind || "") === kind && templateMatchesTenant(t, effectiveTenantId);
    });

    if (productId) {
      const exactTenantMatch =
        candidates.find((t: any) => String(t?.tenantId || "").trim() === effectiveTenantId && templateMatchesProduct(t, productId)) || null;
      if (exactTenantMatch) return exactTenantMatch;
      const productMatch = candidates.find((t: any) => templateMatchesProduct(t, productId)) || null;
      if (productMatch) return productMatch;
    }

    const defaultTemplateId = getDefaultTemplateIdForKind(kind);
    if (!defaultTemplateId) return null;
    const exactDefault =
      candidates.find((t: any) => String(t?.tenantId || "").trim() === effectiveTenantId && String(t?.id || "").trim() === defaultTemplateId) || null;
    if (exactDefault) return exactDefault;
    return candidates.find((t: any) => String(t?.id || "").trim() === defaultTemplateId) || null;
  }


  function resolveNotificationTemplate(trigger: string, paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK") {
    const cfg = notificationsConfig || {};
    const rules = Array.isArray(cfg?.rules) ? cfg.rules : [];
    const templates = Array.isArray(cfg?.templates) ? cfg.templates : [];
    const candidates = rules.filter((r: any) => r?.enabled && String(r?.trigger || "") === trigger);
    const filtered = paymentType
      ? candidates.filter((r: any) => {
          const types = r?.conditions?.requirePaymentTypeIn;
          if (!Array.isArray(types) || !types.length) return true;
          return types.includes(paymentType);
        })
      : candidates;
    const rule = filtered[0] || candidates[0] || null;
    if (!rule) return null;
    const template = templates.find((t: any) => String(t?.id || "") === String(rule?.templateId || ""));
    return template || null;
  }

  function resolveActionBlockReason(customer: CustomerRow, action: "PAYMENT" | "TOKEN" | "CATALOG_PLAN" | "CATALOG_SUBSCRIPTION") {
    const customerId = String(customer.id || "").trim();
    const productId = resolveCustomerProductId(customerId);

    if (action === "PAYMENT") {
      if (!productId) return "missing_product_for_customer";
      if (!findTemplateForCustomer("PLAN", customer, productId)) return "missing_checkout_for_product";
      if (missingPlanBase) return "missing_plan_base_url";
      return isNotificationTemplateConfigured(resolveNotificationTemplate("PAYMENT_LINK_CREATED", "LINK")) ? "" : "missing_template";
    }

    if (action === "TOKEN") {
      if (!productId) return "missing_product_for_customer";
      if (!findTemplateForCustomer("SUBSCRIPTION", customer, productId)) return "missing_checkout_for_product";
      if (missingSubBase) return "missing_subscription_base_url";
      return isNotificationTemplateConfigured(resolveNotificationTemplate("TOKENIZATION_LINK_CREATED")) ? "" : "missing_template";
    }

    if (!findTemplateForCustomer("CART", customer, productId)) return productId ? "missing_checkout_for_product" : "missing_cart_template";
    if (action === "CATALOG_SUBSCRIPTION" && missingSubBase) return "missing_subscription_base_url";
    if (action === "CATALOG_PLAN" && missingPublicBase) return "missing_public_base_url";
    return isNotificationTemplateConfigured(
      resolveNotificationTemplate("CATALOG_LINK_CREATED", action === "CATALOG_SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN")
    )
      ? ""
      : "missing_template";
  }

  function getCustomerActionState(customer: CustomerRow) {
    const subInfo = subscriptionsByCustomer[String(customer.id)] || {};
    const defaultCartMode: "PLAN" | "SUBSCRIPTION" = String(subInfo?.collectionMode || "") === "AUTO_DEBIT" ? "SUBSCRIPTION" : "PLAN";
    const paymentError = resolveActionBlockReason(customer, "PAYMENT");
    const tokenError = resolveActionBlockReason(customer, "TOKEN");
    const catalogPlanError = resolveActionBlockReason(customer, "CATALOG_PLAN");
    const catalogSubscriptionError = resolveActionBlockReason(customer, "CATALOG_SUBSCRIPTION");
    const canSendCatalogPlan = !catalogPlanError;
    const canSendCatalogSubscription = !catalogSubscriptionError;
    const preferredCartMode: "PLAN" | "SUBSCRIPTION" =
      defaultCartMode === "SUBSCRIPTION"
        ? canSendCatalogSubscription
          ? "SUBSCRIPTION"
          : "PLAN"
        : canSendCatalogPlan
          ? "PLAN"
          : "SUBSCRIPTION";

    return {
      canSendPayment: !paymentError,
      paymentError,
      canSendToken: !tokenError,
      tokenError,
      canSendCatalogPlan,
      catalogPlanError,
      canSendCatalogSubscription,
      catalogSubscriptionError,
      canSendCatalog: canSendCatalogPlan || canSendCatalogSubscription,
      defaultCartMode,
      preferredCartMode
    };
  }


  function maskUrl(raw: string) {
    if (!raw) return "";
    try {
      const url = new URL(raw);
      const path = url.pathname;
      const head = path.slice(0, 12);
      const tail = path.slice(-8);
      return `${url.origin}${head}${path.length > 20 ? "…" : ""}${tail}`;
    } catch {
      return raw.length > 28 ? `${raw.slice(0, 16)}…${raw.slice(-8)}` : raw;
    }
  }

  function openEditor(item: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setEditing(item);
    setOpen(true);
  }

  function openTransactions(customer: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setTxCustomer(customer);
    setTxOpen(true);
  }

  function closeTransactions() {
    setTxOpen(false);
    setTxCustomer(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function closeEditor() {
    setOpen(false);
    setEditing(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function openPlanModal(customer: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setPlanModalCustomer(customer);
    setPlanModalOpen(true);
  }

  function closePlanModal() {
    setPlanModalOpen(false);
    setPlanModalCustomer(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function openCartModal(customer: CustomerRow) {
    const actionState = getCustomerActionState(customer);
    if (!actionState.canSendCatalog) {
      openNotify("fail", mapSendError(actionState.catalogPlanError || actionState.catalogSubscriptionError || "send_failed"));
      return;
    }
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setCartModalCustomer(customer);
    setCartModalMode(actionState.preferredCartMode);
    setCartModalOpen(true);
    setSendError((prev) => ({ ...prev, [customer.id]: "" }));
    setSendOk((prev) => ({ ...prev, [customer.id]: "" }));
  }

  function closeCartModal() {
    setCartModalOpen(false);
    setCartModalCustomer(null);
    setCartModalMode("PLAN");
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function inferTemplateMode(t: any): "PLAN" | "SUBSCRIPTION" | "MIXED" {
    const ids = Array.isArray(t?.productIds) ? t.productIds : [];
    let hasPlan = false;
    let hasSub = false;
    for (const id of ids) {
      if (typeof id === "string") {
        hasPlan = true;
        continue;
      }
      const mode = String(id?.mode || "").toUpperCase();
      if (!mode || mode === "AUTO_LINK") hasPlan = true;
      if (mode === "AUTO_DEBIT") hasSub = true;
      if (hasPlan && hasSub) return "MIXED";
    }
    return hasSub ? "SUBSCRIPTION" : "PLAN";
  }

  function openTokenModal(customer: CustomerRow) {
    const actionState = getCustomerActionState(customer);
    if (!actionState.canSendToken) {
      openNotify("fail", mapSendError(actionState.tokenError || "send_failed"));
      return;
    }
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setTokenModalCustomer(customer);
    setTokenModalOpen(true);
    setSendError((prev) => ({ ...prev, [customer.id]: "" }));
    setSendOk((prev) => ({ ...prev, [customer.id]: "" }));
  }

  function closeTokenModal() {
    setTokenModalOpen(false);
    setTokenModalCustomer(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function openPayModal(customer: CustomerRow) {
    const actionState = getCustomerActionState(customer);
    if (!actionState.canSendPayment) {
      openNotify("fail", mapSendError(actionState.paymentError || "send_failed"));
      return;
    }
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setPayModalCustomer(customer);
    setPayAmount("");
    setPayModalOpen(true);
    setSendError((prev) => ({ ...prev, [customer.id]: "" }));
    setSendOk((prev) => ({ ...prev, [customer.id]: "" }));
  }

  function closePayModal() {
    setPayModalOpen(false);
    setPayModalCustomer(null);
    setPayAmount("");
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function openNotify(status: "ok" | "fail", message: string) {
    setNotify({
      open: true,
      title: status === "ok" ? "Mensaje enviado" : "Mensaje fallido",
      message,
      status
    });
    
    // Disparar evento de notificación en tiempo real
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("notification", {
        detail: {
          id: `msg:${Date.now()}`,
          type: status === "ok" ? "success" : "error",
          title: status === "ok" ? "Mensaje enviado" : "Mensaje fallido",
          message,
          timestamp: new Date().toISOString(),
          href: "/notifications"
        }
      }));
    }
  }

  async function clearCustomerPaymentSource(customerId: string) {
    if (!window.confirm("¿Quitar el método de pago guardado?")) return;
    setClearingTokenId(customerId);
    try {
      const res = await fetch("/api/customers/clear-payment-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        openNotify("fail", mapSendError(json?.error || "request_failed"));
        return;
      }
      setTokenStateByCustomer((prev) => ({ ...prev, [String(customerId)]: false }));
      openNotify("ok", "Método de pago removido.");
    } finally {
      setClearingTokenId(null);
    }
  }

  function mapSendError(code: string) {
    const normalized = String(code || "").trim();
    switch (normalized) {
      case "missing_public_base_url":
        return "Falta configurar la URL pública base en Checkout público.";
      case "missing_subscription_base_url":
        return "Falta configurar la URL base de suscripción en Checkout público.";
      case "missing_plan_base_url":
        return "Falta configurar la URL base de plan en Checkout público.";
      case "missing_cart_template":
        return "No hay plantillas de catálogo activas. Crea una en Checkout público.";
      case "missing_plan_template":
        return "No hay plantillas de link de pago activas. Crea una en Checkout público.";
      case "missing_subscription_template":
        return "No hay plantillas de suscripción activas. Crea una en Checkout público.";
      case "missing_checkout_for_product":
        return "No hay un checkout público asociado al producto de este contacto.";
      case "missing_product_for_customer":
        return "Este contacto no tiene un producto o suscripción asociada. Solo puedes enviar catálogo hasta que el cliente elija qué producto contratar.";
      case "missing_template":
        return "Falta una plantilla WhatsApp activa en Notificaciones para este envío.";
      case "customer_phone_required":
        return "El contacto no tiene teléfono. Agrégalo antes de enviar el mensaje.";
      case "missing_customer_fields":
        return "El contacto debe tener nombre, email y teléfono para enviarlo por Chatwoot.";
      case "monto_invalido":
      case "invalid_amount":
        return "Debes ingresar un monto válido para el link de pago.";
      case "whatsapp_inbox_required":
        return "No hay un inbox de WhatsApp disponible para enviar esta plantilla.";
      case "whatsapp_channel_required":
        return "El canal seleccionado no es de WhatsApp y la plantilla no se puede enviar.";
      case "whatsapp_channel_lookup_failed":
        return "No se pudo validar el canal de WhatsApp en Chatwoot.";
      case "chatwoot not configured":
      case "chatwoot_not_configured":
        return "Chatwoot no está configurado para este entorno.";
      case "contact not found/created":
      case "contact_not_found":
        return "No se pudo crear o encontrar el contacto en Chatwoot.";
      case "chatwoot_conversation_missing":
        return "No se pudo abrir la conversación en Chatwoot.";
      case "no_rules":
        return "Falta una plantilla WhatsApp activa en Notificaciones para este envío.";
      case "invalid_body":
        return "Faltan datos obligatorios. Revisa la configuración.";
      case "invalid_payload":
        return "No se pudo preparar el link. Revisa la configuración del checkout.";
      case "invalid_json":
        return "No se pudo procesar la solicitud. Intenta nuevamente.";
      case "auth_required":
        return "Sesión vencida. Vuelve a iniciar sesión.";
      case "customer_not_found":
        return "No se encontró el contacto para este envío.";
      case "public_checkout_create_failed":
        return "No se pudo generar el checkout público para este envío.";
      case "store_failed":
        return "No se pudo guardar el link en el contacto.";
      case "centralcom_failed":
        return "No se pudo enviar el mensaje de WhatsApp. Revisa la configuración de Chatwoot.";
      case "request_failed":
      case "send_failed":
        return "No se pudo enviar el mensaje. Intenta nuevamente.";
      default:
        return normalized || "No se pudo enviar el mensaje.";
    }
  }

  function openViewFicha(customer: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setViewFichaCustomer(customer);
    setViewFichaOpen(true);
  }

  function closeViewFicha() {
    setViewFichaOpen(false);
    setViewFichaCustomer(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  return (
    <>
      {view === "list" ? (
        <div className="contact-list" aria-label="Lista compacta de contactos">
          <div className="contact-list-header">
            <span>Contacto</span>
            <span>Suscripción</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {items.map((c) => {
            const subInfo = subscriptionsByCustomer[String(c.id)];
            const actionState = getCustomerActionState(c);
            const ident =
              c?.metadata?.identificacion ||
              c?.metadata?.identificationNumber ||
              c?.metadata?.documentNumber ||
              c?.metadata?.document ||
              "";
            const productName = formatPlanLabel(subInfo?.productName || "");
            const status = String(subInfo?.status || "");
            const collectionMode = String(subInfo?.collectionMode || "");
            const statusLabel =
              status === "ACTIVE" ? "Activa" : status === "PAST_DUE" ? "En mora" : status ? "Inactiva" : "—";
            const statusPillClass = status === "ACTIVE" ? "pill-ok" : status === "PAST_DUE" ? "pill-bad" : status ? "pill-muted" : "pill-muted";
            const kindLabel =
              collectionMode === "AUTO_DEBIT"
                ? "Débito automático"
                : collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK"
                  ? "Link de pago"
                  : "—";
            return (
              <div className="contact-list-row" key={`contact-list-${c.id}`}>
                <div className="contact-list-cell">
                  <Link className="contact-list-name" href={`/customers/${c.id}`}>
                    {c.name || "—"}
                  </Link>
                  <div className="contact-list-sub">{c.email || "—"} · {c.phone || "—"}</div>
                </div>
                <div className="contact-list-cell">
                  <div className="contact-list-sub">{productName || "—"}</div>
                  <div className="contact-list-sub">{kindLabel}</div>
                </div>
                <div className="contact-list-cell">
                  <span className={`pill pill-sm ${statusPillClass}`}>{statusLabel}</span>
                </div>
                <div className="contact-list-cell contact-list-actions">
                  <button
                    className="ghost btn-compact btn-history btn-icon-only"
                    type="button"
                    onClick={() => openTransactions(c)}
                    aria-label="Historial de pagos"
                    title="Historial de pagos"
                  />
                  <button
                    className="ghost btn-compact btn-edit btn-icon-only"
                    type="button"
                    onClick={() => openEditor(c)}
                    aria-label="Editar"
                    title="Editar"
                  />
                  <form
                    action={deleteCustomer}
                    className="delete-row"
                    onSubmit={(e) => {
                      if (!confirm("¿Eliminar contacto?")) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="tenantId" value={resolveEffectiveTenantId(c)} />
                    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                    <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar contacto" title="Eliminar contacto" />
                  </form>
                  <Link className="ghost btn-compact btn-noicon btn-blue contact-action-btn action-card" href={`/customers/${c.id}/payment-method`}>
                    {hasToken(c) ? "Actualizar tarjeta" : "Guardar tarjeta"}
                  </Link>
                  {hasToken(c) ? (
                    <button
                      className="ghost btn-compact btn-noicon btn-red contact-action-btn action-danger"
                      type="button"
                      onClick={() => {
                        void clearCustomerPaymentSource(c.id);
                      }}
                      disabled={clearingTokenId === c.id}
                      title={clearingTokenId === c.id ? "Quitando token" : "Quitar token"}
                    >
                      {clearingTokenId === c.id ? "Quitando..." : "Quitar token"}
                    </button>
                  ) : null}
                  <button
                    className="ghost btn-compact btn-pay contact-action-btn action-payment"
                    type="button"
                    data-modal="true"
                    data-loader="off"
                    onClick={() => openPayModal(c)}
                    disabled={!actionState.canSendPayment}
                    title={actionState.canSendPayment ? "Enviar link de pago" : mapSendError(actionState.paymentError)}
                  >
                    Enviar link de pago
                  </button>
                  <button
                    className="ghost btn-compact btn-token contact-action-btn action-token"
                    type="button"
                    data-modal="true"
                    data-loader="off"
                    onClick={() => openTokenModal(c)}
                    disabled={!actionState.canSendToken}
                    title={actionState.canSendToken ? "Enviar débito automático" : mapSendError(actionState.tokenError)}
                  >
                    Enviar débito automático
                  </button>
                  <button
                    className="ghost btn-compact btn-open contact-action-btn action-catalog"
                    type="button"
                    data-modal="true"
                    data-loader="off"
                    onClick={() => openCartModal(c)}
                    disabled={!actionState.canSendCatalog}
                    title={
                      actionState.canSendCatalog
                        ? "Enviar catálogo"
                        : mapSendError(actionState.catalogPlanError || actionState.catalogSubscriptionError)
                    }
                  >
                    Enviar catálogo
                  </button>
                  <button className="ghost btn-compact btn-noicon btn-blue btn-create contact-action-btn action-create" type="button" data-modal="true" data-loader="off" onClick={() => openPlanModal(c)}>
                    Crear suscripción
                  </button>
                  <details className="inline-detail">
                    <summary className="ghost btn-compact btn-icon-only btn-view" aria-label="Ver más" title="Ver más" />
                    <div className="inline-detail-body">
                      <div><strong>Email:</strong> {c.email || "—"}</div>
                      <div><strong>Teléfono:</strong> {c.phone || "—"}</div>
                      <div><strong>Canal:</strong> {c.tenantName || "—"}</div>
                      <div><strong>Identificación:</strong> {ident || "—"}</div>
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
          {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
        </div>
      ) : (
      <div className="contacts-grid" aria-label="Lista de contactos">
        {items.map((c) => {
          const link = latestLinks[String(c.id)];
          const formId = `send-link-${c.id}`;
          const subInfo = subscriptionsByCustomer[String(c.id)];
          const actionState = getCustomerActionState(c);
          const ident =
            c?.metadata?.identificacion ||
            c?.metadata?.identificationNumber ||
            c?.metadata?.documentNumber ||
            c?.metadata?.document ||
            "";
          const hasPlan = subInfo?.hasPlan ?? false;
          const productName = formatPlanLabel(subInfo?.productName || "");
          const status = String(subInfo?.status || "");
          const collectionMode = String(subInfo?.collectionMode || "");
          const kindLabel = !hasPlan
            ? ""
            : collectionMode === "AUTO_DEBIT"
              ? "Débito automático"
              : collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK"
                ? "Link de pago"
                : "";
          const kindPillClass = !hasPlan
            ? ""
            : collectionMode === "AUTO_DEBIT"
              ? "pill-mode-debit"
              : collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK"
                ? "pill-mode-link"
                : "pill-muted";
          const statusLabel =
            status === "ACTIVE" ? "Activa" : status === "PAST_DUE" ? "En mora" : status ? "Inactiva" : "";
          const statusPillClass = status === "ACTIVE" ? "pill-ok" : status === "PAST_DUE" ? "pill-bad" : status ? "pill-muted" : "";
          return (
            <div className="billing-card" key={c.id}>
              <div className="billing-header">
                <div className="contact-head">
                  <div className="contact-title">{c.name || "—"}</div>
                  <div className="contact-tags">
                    {hasToken(c) ? <span className="pill pill-ok pill-sm">Tokenizada</span> : <span className="pill pill-bad pill-sm">Sin token</span>}
                    {hasPlan && kindLabel ? <span className={`pill pill-sm ${kindPillClass}`}>{kindLabel}</span> : <span className="pill pill-muted pill-sm">Sin suscripción</span>}
                    {statusLabel && statusPillClass ? <span className={`pill ${statusPillClass} pill-sm`}>{statusLabel}</span> : null}
                  </div>
                </div>
                <div className="billing-header-actions">
                  <button
                    className="ghost btn-compact btn-edit btn-icon-only"
                    type="button"
                    onClick={() => openEditor(c)}
                    aria-label="Editar contacto"
                    title="Editar contacto"
                  />
                  <button
                    className="ghost btn-compact btn-view btn-icon-only"
                    type="button"
                    onClick={() => openViewFicha(c)}
                    aria-label="Ver ficha completa"
                    title="Ver ficha completa"
                  />
                  <form
                    action={deleteCustomer}
                    onSubmit={(e) => {
                      if (!confirm("¿Eliminar contacto?")) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="tenantId" value={resolveEffectiveTenantId(c)} />
                    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                    <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar contacto" title="Eliminar contacto" />
                  </form>
                </div>
              </div>
              <div className="contact-body">
                <div className="contact-left contact-block">
                  <div className="contact-block-title">Información personal</div>
                  <div className="contact-person-grid">
                    <div>
                      <span>Email</span>
                      <div className="contact-value">{c.email || "—"}</div>
                    </div>
                    <div>
                      <span>Teléfono</span>
                      <div className="contact-value">{c.phone || "—"}</div>
                    </div>
                    <div>
                      <span>Canal</span>
                      <div className="contact-value">{c.tenantName || "—"}</div>
                    </div>
                    <div>
                      <span>Identificación</span>
                      <div className="contact-value">{ident || "—"}</div>
                    </div>
                  </div>
                </div>

                <div className="contact-right contact-block">
                  <div className="contact-block-title">Suscripción</div>
                  <div className="contact-plan-grid">
                    <div>
                      <span>Plan</span>
                      <div className="contact-plan-row">
                        {hasPlan ? (
                          <>
                            {subInfo?.subscriptionId ? (
                              <Link
                                href={`/billing?subscriptionId=${subInfo.subscriptionId}`}
                                className="contact-value contact-value-strong"
                                style={{ color: 'var(--primary)', textDecoration: 'underline' }}
                                title="Ir a la suscripción"
                              >
                                {productName}
                              </Link>
                            ) : (
                              <span className="contact-value contact-value-strong">
                                {productName}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="contact-value contact-value-strong">—</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span>Estado</span>
                      <div className="contact-plan-row">
                        {statusLabel && statusPillClass ? (
                          <span className={`pill ${statusPillClass} pill-sm`}>{statusLabel}</span>
                        ) : (
                          <span className="pill pill-muted pill-sm">—</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span>Tipo</span>
                      <div className="contact-plan-row">
                        {hasPlan && kindLabel ? (
                          <span className={`pill pill-sm ${kindPillClass}`}>{kindLabel}</span>
                        ) : (
                          <span className="pill pill-muted pill-sm">—</span>
                        )}
                      </div>
                    </div>
                    {!hasToken(c) ? (
                      <div className="contact-plan-hint">
                        <span className="field-hint">Envía link de débito automático para guardar tarjeta.</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="contact-paylink contact-footer">
                  <div className="paylink-header">
                    <span className="paylink-title">Pagos y débito automático</span>
                  </div>
                  <div className="paylink-actions paylink-actions-subscription">
                    <Link className="ghost btn-compact btn-noicon btn-blue btn-token contact-action-btn action-card" href={`/customers/${c.id}/payment-method`}>
                      {hasToken(c) ? "Actualizar tarjeta" : "Guardar tarjeta"}
                    </Link>
                    {hasToken(c) ? (
                      <button
                        className="ghost btn-compact btn-noicon btn-red contact-action-btn action-danger"
                        type="button"
                        onClick={() => {
                          void clearCustomerPaymentSource(c.id);
                        }}
                        disabled={clearingTokenId === c.id}
                      >
                        {clearingTokenId === c.id ? "Quitando..." : "Quitar token"}
                      </button>
                    ) : null}
                    <button
                      className="ghost btn-compact btn-pay contact-action-btn action-payment"
                      type="button"
                      data-modal="true"
                      data-loader="off"
                      onClick={() => openPayModal(c)}
                      disabled={!actionState.canSendPayment}
                      title={actionState.canSendPayment ? "Enviar link de pago" : mapSendError(actionState.paymentError)}
                    >
                      Enviar link de pago
                    </button>
                    <button
                      className="ghost btn-compact btn-token contact-action-btn action-token"
                      type="button"
                      data-modal="true"
                      data-loader="off"
                      onClick={() => openTokenModal(c)}
                      disabled={!actionState.canSendToken}
                      title={actionState.canSendToken ? "Enviar débito automático" : mapSendError(actionState.tokenError)}
                    >
                      Enviar débito automático
                    </button>
                    <button
                      className="ghost btn-compact btn-open contact-action-btn action-catalog"
                      type="button"
                      data-modal="true"
                      data-loader="off"
                      onClick={() => openCartModal(c)}
                      disabled={!actionState.canSendCatalog}
                      title={
                        actionState.canSendCatalog
                          ? "Enviar catálogo"
                          : mapSendError(actionState.catalogPlanError || actionState.catalogSubscriptionError)
                      }
                    >
                      Enviar catálogo
                    </button>
                    <button className="ghost btn-compact btn-noicon btn-blue btn-create contact-action-btn action-create" type="button" data-modal="true" data-loader="off" onClick={() => openPlanModal(c)}>
                      Crear suscripción
                    </button>
                  </div>
                  {sendError[c.id] === "auth_required" ? (
                    <div className="paylink-error">Sesión vencida. Vuelve a iniciar sesión.</div>
                  ) : null}
                  {sendError[c.id] === "no_rules" ? (
                    <div className="paylink-error">No hay notificaciones activas para enviar el link.</div>
                  ) : null}
                  {sendError[c.id] && sendError[c.id] !== "auth_required" && sendError[c.id] !== "no_rules" ? (
                    <div className="paylink-error">{sendError[c.id]}</div>
                  ) : null}
                  {sendOk[c.id] ? <div className="paylink-success">Link enviado.</div> : null}
                  {!hasPlan ? (
                    <div className="field-hint">
                      Sin suscripción activa, desde contactos solo se puede enviar catálogo. El link de pago o débito automático se habilitan cuando exista un producto asociado.
                    </div>
                  ) : null}
              </div>
            </div>
          );
        })}
        {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
      </div>
      )}

      <AppModal open={Boolean(planModalOpen && planModalCustomer)} onClose={closePlanModal} title="Crear suscripción o cobro" maxWidth={980}>
        {planModalCustomer ? (
          <NewBillingAssignmentForm
            customers={items}
            empresas={empresas}
            catalogItems={products}
            csrfToken={csrfToken}
            tenantId={resolveEffectiveTenantId(planModalCustomer)}
            tenants={tenants}
            defaultOpen
            forceOpen
            hideHeader
            returnTo={returnTo || "/customers"}
            defaultSelectedCustomerId={String(planModalCustomer.id)}
            createCustomer={createCustomer}
            createPlanAndSubscription={createPlanAndSubscription}
          />
        ) : null}
      </AppModal>

      <AppModal open={Boolean(payModalOpen && payModalCustomer)} onClose={closePayModal} title="Enviar link de pago" maxWidth={520}>
        {payModalCustomer ? (
          <form
              className="panel module"
              onSubmit={async (e) => {
                e.preventDefault();
                const customer = payModalCustomer;
                if (!customer) return;
                const productId = resolveCustomerProductId(customer.id);
                if (!productId) {
                  openNotify("fail", mapSendError("missing_product_for_customer"));
                  return;
                }
                const payTemplate = resolveNotificationTemplate("PAYMENT_LINK_CREATED", "LINK");
                const canSendPay = isNotificationTemplateConfigured(payTemplate);
                if (!canSendPay) {
                  setSendError((prev) => ({ ...prev, [customer.id]: "missing_template" }));
                  openNotify("fail", mapSendError("missing_template"));
                  return;
                }
                setSendingPaymentId(customer.id);
                setSendError((prev) => ({ ...prev, [customer.id]: "" }));
                setSendOk((prev) => ({ ...prev, [customer.id]: "" }));
                try {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch("/api/customers/send-payment-link", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      customerId: customer.id,
                      customerName: customer.name || "",
                      amount: payAmount,
                      tenantId: resolveEffectiveTenantId(customer),
                      productId
                    }),
                    signal: controller.signal
                  });
                  clearTimeout(timeout);
                  const contentType = res.headers.get("content-type") || "";
                  if (!contentType.includes("application/json")) {
                    setSendError((prev) => ({ ...prev, [customer.id]: "auth_required" }));
                    openNotify("fail", "Sesión vencida. Vuelve a iniciar sesión.");
                    return;
                  }
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok || !json?.ok) {
                    const msg = json?.error || "send_failed";
                    setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                    openNotify("fail", mapSendError(msg));
                    return;
                  }
                  const chatErr = String(json?.chatwootError || "").trim();
                  if (chatErr) {
                    setSendError((prev) => ({ ...prev, [customer.id]: chatErr }));
                    openNotify("fail", mapSendError(chatErr));
                    return;
                  }
                  setSendOk((prev) => ({ ...prev, [customer.id]: "sent" }));
                  openNotify("ok", "El link de pago fue enviado correctamente.");
                  closePayModal();
                } catch (err: any) {
                  const msg = String(err?.message || "send_failed");
                  setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                  openNotify("fail", mapSendError(msg));
                } finally {
                  setSendingPaymentId(null);
                }
              }}
            >
              {(() => {
                const payTemplate = resolveNotificationTemplate("PAYMENT_LINK_CREATED", "LINK");
                const canSendPay = isNotificationTemplateConfigured(payTemplate);
                const productId = resolveCustomerProductId(payModalCustomer.id);
                const checkoutTemplate = productId ? findTemplateForCustomer("PLAN", payModalCustomer, productId) : null;
                const productName = productById.get(productId)?.name || "";
                const missingProduct = !productId;
                const missingCheckout = !checkoutTemplate;
                const missingPaymentBase = missingPlanBase;
                const isSending = sendingPaymentId === payModalCustomer.id;
                return (
                  <>
              <div className="field">
                <label>Monto</label>
                <input
                  className="input"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="$ 10000"
                  inputMode="numeric"
                  required
                />
              </div>
              <div className="field">
                <label>Checkout asociado</label>
                <div className="field-hint">Producto: {productName || "—"}</div>
                {missingProduct ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    El contacto no tiene un producto asociado.
                  </div>
                ) : null}
                {missingCheckout ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay checkout público de link de pago asociado al producto de este contacto.
                  </div>
                ) : null}
                {missingPaymentBase ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Falta configurar la URL base de link de pago en Checkout público.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Plantilla de mensaje</label>
                <textarea
                  className="input"
                  rows={4}
                  readOnly
                  value={renderNotificationTemplatePreview(payTemplate)}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">Se usa la plantilla WhatsApp activa de Notificaciones para link de pago.</div>
              </div>
              {!canSendPay ? (
                <div className="paylink-error">
                  {mapSendError("missing_template")}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                      Configurar plantilla
                    </a>
                  </div>
                </div>
              ) : null}
              {sendError[payModalCustomer.id] ? (
                <div className="paylink-error">
                  {mapSendError(sendError[payModalCustomer.id])}
                  {sendError[payModalCustomer.id] === "missing_template" || sendError[payModalCustomer.id] === "no_rules" ? (
                    <div style={{ marginTop: 6 }}>
                      <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                        Configurar plantilla
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sendOk[payModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closePayModal} data-modal-close="true" data-loader="off" disabled={isSending}>
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  disabled={
                    isSending ||
                    !payAmount ||
                    !canSendPay ||
                    missingProduct ||
                    missingCheckout ||
                    missingPaymentBase
                  }
                >
                  {isSending ? "Enviando..." : "Enviar"}
                </button>
              </div>
                  </>
                );
              })()}
          </form>
        ) : null}
      </AppModal>

      <AppModal open={Boolean(cartModalOpen && cartModalCustomer)} onClose={closeCartModal} title="Enviar catálogo" maxWidth={520}>
        {cartModalCustomer ? (
          <form
              className="panel module"
              onSubmit={async (e) => {
                e.preventDefault();
                const customer = cartModalCustomer;
                if (!customer) return;
                const productId = resolveCustomerProductId(customer.id);
                const checkoutTemplate = findTemplateForCustomer("CART", customer, productId);
                if (!checkoutTemplate) {
                  openNotify("fail", mapSendError(productId ? "missing_checkout_for_product" : "missing_cart_template"));
                  return;
                }
                const notifTemplate = resolveNotificationTemplate(
                  "CATALOG_LINK_CREATED",
                  cartModalMode === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN"
                );
                const canSendNotif = isNotificationTemplateConfigured(notifTemplate);
                if (!canSendNotif) {
                  setSendError((prev) => ({ ...prev, [customer.id]: "missing_template" }));
                  openNotify("fail", mapSendError("missing_template"));
                  return;
                }
                setSendingCartId(customer.id);
                setSendError((prev) => ({ ...prev, [customer.id]: "" }));
                setSendOk((prev) => ({ ...prev, [customer.id]: "" }));
                try {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch("/api/customers/send-cart-link", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      customerId: customer.id,
                      customerName: customer.name || "",
                      tenantId: resolveEffectiveTenantId(customer),
                      ...(productId ? { productId } : {}),
                      catalogType: cartModalMode
                    }),
                    signal: controller.signal
                  });
                  clearTimeout(timeout);
                  const contentType = res.headers.get("content-type") || "";
                  if (!contentType.includes("application/json")) {
                    setSendError((prev) => ({ ...prev, [customer.id]: "auth_required" }));
                    openNotify("fail", "Sesión vencida. Vuelve a iniciar sesión.");
                    return;
                  }
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok || !json?.ok) {
                    const msg = json?.error || "send_failed";
                    setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                    openNotify("fail", mapSendError(msg));
                    return;
                  }
                  const chatErr = String(json?.chatwootError || "").trim();
                  if (chatErr) {
                    setSendError((prev) => ({ ...prev, [customer.id]: chatErr }));
                    openNotify("fail", mapSendError(chatErr));
                    return;
                  }
                  setSendOk((prev) => ({ ...prev, [customer.id]: "sent" }));
                  openNotify("ok", "El catálogo fue enviado correctamente.");
                  closeCartModal();
                } catch (err: any) {
                  const msg = String(err?.message || "send_failed");
                  setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                  openNotify("fail", mapSendError(msg));
                } finally {
                  setSendingCartId(null);
                }
              }}
            >
              {(() => {
                const notifTemplate = resolveNotificationTemplate(
                  "CATALOG_LINK_CREATED",
                  cartModalMode === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN"
                );
                const canSendNotif = isNotificationTemplateConfigured(notifTemplate);
                const productId = resolveCustomerProductId(cartModalCustomer.id);
                const checkoutTemplate = productId ? findTemplateForCustomer("CART", cartModalCustomer, productId) : null;
                const fallbackCartTemplate = !productId ? findTemplateForCustomer("CART", cartModalCustomer, "") : checkoutTemplate;
                const effectiveCheckoutTemplate = checkoutTemplate || fallbackCartTemplate;
                const productName = productById.get(productId)?.name || "";
                const missingProduct = !productId;
                const missingCheckout = !effectiveCheckoutTemplate;
                const currentModeMissingBase = cartModalMode === "SUBSCRIPTION" ? missingSubBase : missingPublicBase;
                const canSendCurrentMode = !missingCheckout && !currentModeMissingBase && canSendNotif;
                const isSending = sendingCartId === cartModalCustomer.id;
                return (
                  <>
              <div className="field">
                <label>Tipo de catálogo</label>
                <select className="select" value={cartModalMode} onChange={(e) => setCartModalMode(e.target.value as any)}>
                  <option value="PLAN">Link de pago</option>
                  <option value="SUBSCRIPTION">Débito automático</option>
                </select>
                <div className="field-hint">
                  Link de pago: el cliente paga con un link. Débito automático: guarda tarjeta para cobros automáticos.
                </div>
              </div>
              <div className="field">
                <label>Checkout asociado</label>
                <div className="field-hint">Producto actual: {productName || "Sin producto asociado"}</div>
                {missingProduct ? (
                  <div className="field-hint">
                    El contacto no tiene producto asociado todavía. El cliente lo elegirá dentro del catálogo público.
                  </div>
                ) : null}
                {missingCheckout ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    {missingProduct ? "No hay una plantilla de catálogo por defecto para este canal." : "No hay checkout público para ese producto."}
                  </div>
                ) : null}
                {currentModeMissingBase ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    {cartModalMode === "SUBSCRIPTION"
                      ? "Falta configurar la URL base de suscripción en Checkout público."
                      : "Falta configurar la URL pública base en Checkout público."}
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Plantilla de mensaje</label>
                <textarea
                  className="input"
                  rows={4}
                  readOnly
                  value={renderNotificationTemplatePreview(
                    resolveNotificationTemplate("CATALOG_LINK_CREATED", cartModalMode === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN")
                  )}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">
                  Se usa la plantilla WhatsApp activa de Notificaciones para {cartModalMode === "SUBSCRIPTION" ? "débito automático" : "link de pago"}.
                </div>
              </div>
              {!canSendNotif ? (
                <div className="paylink-error">
                  {mapSendError("missing_template")}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                      Configurar plantilla
                    </a>
                  </div>
                </div>
              ) : null}
              {sendError[cartModalCustomer.id] ? <div className="paylink-error">{mapSendError(sendError[cartModalCustomer.id])}</div> : null}
              {sendOk[cartModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeCartModal} data-modal-close="true" data-loader="off" disabled={isSending}>
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  disabled={isSending || !canSendCurrentMode}
                >
                  {isSending ? "Enviando..." : "Enviar"}
                </button>
              </div>
                  </>
                );
              })()}
          </form>
        ) : null}
      </AppModal>

      <AppModal open={Boolean(tokenModalOpen && tokenModalCustomer)} onClose={closeTokenModal} title="Enviar débito automático" maxWidth={520}>
        {tokenModalCustomer ? (
          <form
              className="panel module"
              onSubmit={async (e) => {
                e.preventDefault();
                const customer = tokenModalCustomer;
                if (!customer) return;
                const productId = resolveCustomerProductId(customer.id);
                if (!productId) {
                  openNotify("fail", mapSendError("missing_product_for_customer"));
                  return;
                }
                const checkoutTemplate = findTemplateForCustomer("SUBSCRIPTION", customer, productId);
                if (!checkoutTemplate) {
                  openNotify("fail", mapSendError("missing_checkout_for_product"));
                  return;
                }
                const notifTemplate = resolveNotificationTemplate("TOKENIZATION_LINK_CREATED");
                const canSendNotif = isNotificationTemplateConfigured(notifTemplate);
                if (!canSendNotif) {
                  setSendError((prev) => ({ ...prev, [customer.id]: "missing_template" }));
                  openNotify("fail", mapSendError("missing_template"));
                  return;
                }
                setSendingTokenId(customer.id);
                setSendError((prev) => ({ ...prev, [customer.id]: "" }));
                setSendOk((prev) => ({ ...prev, [customer.id]: "" }));
                try {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch("/api/customers/send-tokenization-link", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      customerId: customer.id,
                      customerName: customer.name || "",
                      tenantId: resolveEffectiveTenantId(customer),
                      productId
                    }),
                    signal: controller.signal
                  });
                  clearTimeout(timeout);
                  const contentType = res.headers.get("content-type") || "";
                  if (!contentType.includes("application/json")) {
                    setSendError((prev) => ({ ...prev, [customer.id]: "auth_required" }));
                    openNotify("fail", mapSendError("auth_required"));
                    return;
                  }
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok || !json?.ok) {
                    const msg = json?.error || "send_failed";
                    setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                    openNotify("fail", mapSendError(msg));
                    return;
                  }
                  const chatErr = String(json?.chatwootError || "").trim();
                  if (chatErr) {
                    setSendError((prev) => ({ ...prev, [customer.id]: chatErr }));
                    openNotify("fail", mapSendError(chatErr));
                    return;
                  }
                  setSendOk((prev) => ({ ...prev, [customer.id]: "sent" }));
                  openNotify("ok", "El link de débito automático fue enviado correctamente.");
                  closeTokenModal();
                } catch (err: any) {
                  const msg = String(err?.message || "send_failed");
                  setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                  openNotify("fail", mapSendError(msg));
                } finally {
                  setSendingTokenId(null);
                }
              }}
            >
              {(() => {
                const notifTemplate = resolveNotificationTemplate("TOKENIZATION_LINK_CREATED");
                const canSendNotif = isNotificationTemplateConfigured(notifTemplate);
                const productId = resolveCustomerProductId(tokenModalCustomer.id);
                const checkoutTemplate = productId ? findTemplateForCustomer("SUBSCRIPTION", tokenModalCustomer, productId) : null;
                const productName = productById.get(productId)?.name || "";
                const missingProduct = !productId;
                const missingCheckout = !checkoutTemplate;
                const isSending = sendingTokenId === tokenModalCustomer.id;
                return (
                  <>
              <div className="field">
                <label>Checkout asociado</label>
                <div className="field-hint">Producto: {productName || "—"}</div>
                {missingProduct ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    El contacto no tiene un producto asociado.
                  </div>
                ) : null}
                {missingCheckout ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay checkout público para ese producto.
                  </div>
                ) : null}
                {missingSubBase ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Falta configurar la URL base de suscripción en Checkout público.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Plantilla de mensaje</label>
                <textarea
                  className="input"
                  rows={4}
                  readOnly
                  value={renderNotificationTemplatePreview(resolveNotificationTemplate("TOKENIZATION_LINK_CREATED"))}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">Se usa la plantilla WhatsApp activa de Notificaciones para débito automático.</div>
              </div>
              {!canSendNotif ? (
                <div className="paylink-error">
                  {mapSendError("missing_template")}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                      Configurar plantilla
                    </a>
                  </div>
                </div>
              ) : null}
              {sendError[tokenModalCustomer.id] ? (
                <div className="paylink-error">
                  {mapSendError(sendError[tokenModalCustomer.id])}
                  {sendError[tokenModalCustomer.id] === "missing_template" ? (
                    <div style={{ marginTop: 6 }}>
                      <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                        Configurar plantilla
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sendOk[tokenModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeTokenModal} data-modal-close="true" data-loader="off" disabled={isSending}>
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  disabled={isSending || missingProduct || missingCheckout || missingSubBase || !canSendNotif}
                >
                  {isSending ? "Enviando..." : "Enviar"}
                </button>
              </div>
                  </>
                );
              })()}
          </form>
        ) : null}
      </AppModal>


      <AppModal
        open={Boolean(viewFichaOpen && viewFichaCustomer)}
        onClose={closeViewFicha}
        title={`Ficha: ${viewFichaCustomer?.name || viewFichaCustomer?.email || "Contacto"}`}
        width="min(700px, 96vw)"
        panelClassName="customer-view-ficha-modal"
      >
        {viewFichaCustomer ? (
          <div style={{ display: "grid", gap: 16 }}>
              {/* Información personal */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>Información personal</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Email</div>
                    <div style={{ fontSize: 12 }}>{viewFichaCustomer.email || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Teléfono</div>
                    <div style={{ fontSize: 12 }}>{viewFichaCustomer.phone || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Canal</div>
                    <div style={{ fontSize: 12 }}>{viewFichaCustomer.tenantName || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Identificación</div>
                    <div style={{ fontSize: 12 }}>
                      {viewFichaCustomer.metadata?.identificacionNumero || viewFichaCustomer.metadata?.identificacion || "—"}
                    </div>
                  </div>
                </div>
              </section>

              {/* Suscripción */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>Suscripción</h4>
                {(() => {
                  const subInfo = subscriptionsByCustomer[String(viewFichaCustomer.id)];
                  const hasPlan = subInfo?.hasPlan ?? false;
                  const productName = formatPlanLabel(subInfo?.productName || "");
                  const status = String(subInfo?.status || "");
                  const statusLabel = status === "ACTIVE" ? "Activa" : status === "PAST_DUE" ? "En mora" : status ? "Inactiva" : "";
                  return (
                    <div style={{ fontSize: 12 }}>
                      {hasPlan ? (
                        <>
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Plan: </span>
                            <strong>{productName}</strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Estado: </span>
                            <span className={`pill pill-sm ${status === "ACTIVE" ? "pill-ok" : status === "PAST_DUE" ? "pill-bad" : "pill-muted"}`}>
                              {statusLabel || "—"}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div style={{ color: "var(--muted)" }}>Sin suscripción activa</div>
                      )}
                    </div>
                  );
                })()}
              </section>

              {/* Tokens y links */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>Métodos y links</h4>
                <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  {hasToken(viewFichaCustomer) ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="pill pill-ok pill-sm">Tarjeta tokenizada</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="pill pill-bad pill-sm">Sin tarjeta guardada</span>
                    </div>
                  )}
                </div>
              </section>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px" }}>
                <button className="ghost btn-compact" type="button" onClick={closeViewFicha}>Cerrar</button>
                <button className="primary btn-compact" type="button" onClick={() => { closeViewFicha(); openEditor(viewFichaCustomer); }}>Editar</button>
              </div>
        </div>
        ) : null}
      </AppModal>

      <CustomerEditModal
        customer={editing}
        tenants={tenants}
        csrfToken={csrfToken}
        returnTo={returnTo || "/customers"}
        updateCustomer={updateCustomer}
        open={open}
        onClose={closeEditor}
      />
    </>
  );
}
