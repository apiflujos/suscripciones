"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { deleteCustomer, updateCustomer } from "./actions";
import { LocalDateTime } from "../ui/LocalDateTime";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";
import { ViewLinksModal } from "../ui/ViewLinksModal";
import { CustomerEditModal } from "./CustomerEditModal";

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
  latestLinks,
  subscriptionsByCustomer,
  cartTemplates,
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
  latestLinks: Record<string, LatestLink>;
  subscriptionsByCustomer: Record<string, { hasPlan: boolean; planName?: string; status?: string; collectionMode?: string; subscriptionId?: string; productId?: string; planId?: string }>;
  cartTemplates: Array<{ id: string; name: string }>;
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
  const [linkOverrides, setLinkOverrides] = useState<Record<string, { payment?: string; token?: string; cart?: string }>>({});
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planModalCustomer, setPlanModalCustomer] = useState<CustomerRow | null>(null);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartModalCustomer, setCartModalCustomer] = useState<CustomerRow | null>(null);
  const [cartModalMode, setCartModalMode] = useState<"PLAN" | "SUBSCRIPTION">("PLAN");
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payModalCustomer, setPayModalCustomer] = useState<CustomerRow | null>(null);
  const [viewLinksOpen, setViewLinksOpen] = useState(false);
  const [viewLinksItems, setViewLinksItems] = useState<any[]>([]);
  const [viewFichaOpen, setViewFichaOpen] = useState(false);
  const [viewFichaCustomer, setViewFichaCustomer] = useState<CustomerRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenModalCustomer, setTokenModalCustomer] = useState<CustomerRow | null>(null);
  const [clearingTokenId, setClearingTokenId] = useState<string | null>(null);
  const [tokenStateByCustomer, setTokenStateByCustomer] = useState<Record<string, boolean>>({});
  const planBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const subscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const publicBaseUrl = String(checkoutConfig?.planBaseUrl || checkoutConfig?.subscriptionBaseUrl || "").trim();
  const missingSubBase = !subscriptionBaseUrl;
  const missingPublicBase = !publicBaseUrl;

  function ensureHttps(value: string) {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value.replace(/^\/+/, "")}`;
  }

  function normalizePublicUrl(rawUrl: string, base: string, path: string, token?: string) {
    const cleaned = String(rawUrl || "").trim();
    if (cleaned) {
      if (/^https?:\/\//i.test(cleaned)) return cleaned;
      if (cleaned.startsWith("/")) {
        const normalizedBase = ensureHttps(base).replace(/\/$/, "");
        return normalizedBase ? `${normalizedBase}${cleaned}` : cleaned;
      }
      return ensureHttps(cleaned);
    }
    const cleanToken = String(token || "").trim();
    const normalizedBase = ensureHttps(base).replace(/\/$/, "");
    if (!cleanToken || !normalizedBase) return "";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (normalizedBase.endsWith(normalizedPath)) {
      return `${normalizedBase}/${cleanToken}`;
    }
    return `${normalizedBase}${normalizedPath}/${cleanToken}`;
  }

  const lastActiveRef = useRef<HTMLElement | null>(null);

  function hasToken(customer: CustomerRow) {
    const localState = tokenStateByCustomer[String(customer.id)];
    if (typeof localState === "boolean") return localState;
    const meta = customer.metadata ?? {};
    const candidates = [
      meta?.wompi?.paymentSourceId,
      meta?.wompi?.payment_source_id,
      meta?.paymentSourceId,
      meta?.payment_source_id
    ];
    const hasPrimary = candidates.some(
      (v: any) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^\d+$/.test(v))
    );
    if (hasPrimary) return true;
    const sources = meta?.wompi?.paymentSources;
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

  function getTokenLink(customer: CustomerRow) {
    const meta = customer.metadata ?? {};
    const raw =
      meta?.tokenizationLink?.url ||
      meta?.wompi?.tokenizationLink?.url ||
      "";
    const token =
      meta?.tokenizationLink?.token ||
      meta?.wompi?.tokenizationLink?.token ||
      "";
    return normalizePublicUrl(raw, subscriptionBaseUrl, "/public/suscripcion", token);
  }

  function getCartLink(customer: CustomerRow) {
    const meta = customer.metadata ?? {};
    const raw = meta?.cartLink?.url || "";
    const token = meta?.cartLink?.token || "";
    const catalogType = String(meta?.cartLink?.catalogType || "").toUpperCase();
    const base =
      catalogType === "SUBSCRIPTION"
        ? subscriptionBaseUrl
        : planBaseUrl || publicBaseUrl;
    return normalizePublicUrl(raw, base, "/public/cart", token);
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

  function findTemplateForProduct(kind: "PLAN" | "SUBSCRIPTION" | "CART", productId: string) {
    if (!productId) return null;
    return checkoutTemplates.find((t: any) => String(t?.kind || "") === kind && templateMatchesProduct(t, productId)) || null;
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

  function renderNotificationPreview(template: any) {
    if (!template) return "No hay plantilla configurada en Notificaciones.";
    if (template?.content && String(template.content || "").trim() && String(template.content || "") !== "(template)") {
      return String(template.content || "").trim();
    }
    const name = String(template?.chatwootTemplate?.name || "").trim();
    const lang = String(template?.chatwootTemplate?.language || "").trim();
    const params = template?.chatwootTemplate?.processed_params?.body || [];
    if (!name) return "Plantilla configurada en CentralCom.";
    const paramText = Array.isArray(params) && params.length ? params.map((p: any) => String(p?.value || "")).join(" | ") : "—";
    return `Plantilla WhatsApp: ${name}${lang ? ` (${lang})` : ""}\nParámetros: ${paramText}`;
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
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setCartModalCustomer(customer);
    setCartModalMode("PLAN");
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

  const productById = useMemo(() => {
    const map = new Map<string, any>();
    (products || []).forEach((p: any) => map.set(String(p.id), p));
    return map;
  }, [products]);

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
        return "Este contacto no tiene un producto asociado para enviar el checkout.";
      case "missing_template":
        return "No hay plantilla activa para este envío.";
      case "no_rules":
        return "No hay plantillas activas en Notificaciones para este envío.";
      case "invalid_body":
        return "Faltan datos obligatorios. Revisa la configuración.";
      case "invalid_payload":
        return "No se pudo preparar el link. Revisa la configuración del checkout.";
      case "auth_required":
        return "Sesión vencida. Vuelve a iniciar sesión.";
      case "store_failed":
        return "No se pudo guardar el link en el contacto.";
      case "centralcom_failed":
        return "CentralCom no pudo enviar el mensaje. Revisa la configuración de conexiones.";
      case "request_failed":
      case "send_failed":
        return "No se pudo enviar el mensaje. Intenta nuevamente.";
      default:
        return normalized || "No se pudo enviar el mensaje.";
    }
  }

  function openViewLinks(customer: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    const links: Array<{
      label: string;
      url: string;
      sentAt?: string;
      expiresAt?: string;
      usedAt?: string;
      isValid: boolean;
    }> = [];

    // Payment link from latestLinks
    const latestLink = latestLinks[String(customer.id)];
    if (latestLink?.checkoutUrl) {
      links.push({
        label: "Link de pago",
        url: latestLink.checkoutUrl,
        sentAt: latestLink.createdAt,
        isValid: latestLink.chatwootStatus !== "failed"
      });
    }

    // Tokenization link from metadata
    const tokenMeta = (customer.metadata?.tokenizationLink as any) || {};
    if (tokenMeta?.url) {
      const usedAt = tokenMeta.usedAt ? Date.parse(String(tokenMeta.usedAt)) : NaN;
      const expiresAt = tokenMeta.expiresAt ? Date.parse(String(tokenMeta.expiresAt)) : NaN;
      const now = Date.now();
      const isValid = !Number.isFinite(usedAt) && (!Number.isFinite(expiresAt) || expiresAt > now);
      links.push({
        label: "Link de tokenización",
        url: tokenMeta.url,
        sentAt: tokenMeta.createdAt,
        expiresAt: tokenMeta.expiresAt,
        usedAt: tokenMeta.usedAt,
        isValid
      });
    }

    setViewLinksItems(links);
    setViewLinksOpen(true);
  }

  function closeViewLinks() {
    setViewLinksOpen(false);
    setViewLinksItems([]);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
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
            const ident =
              c?.metadata?.identificacion ||
              c?.metadata?.identificationNumber ||
              c?.metadata?.documentNumber ||
              c?.metadata?.document ||
              "";
            const planName = formatPlanLabel(subInfo?.planName || "");
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
                  <div className="contact-list-sub">{planName || "—"}</div>
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
                    <input type="hidden" name="tenantId" value={c.tenantId || ""} />
                    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                    <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar contacto" title="Eliminar contacto" />
                  </form>
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
          const ident =
            c?.metadata?.identificacion ||
            c?.metadata?.identificationNumber ||
            c?.metadata?.documentNumber ||
            c?.metadata?.document ||
            "";
          const hasPlan = subInfo?.hasPlan ?? false;
          const planName = formatPlanLabel(subInfo?.planName || "");
          const status = String(subInfo?.status || "");
          const collectionMode = String(subInfo?.collectionMode || "");
          const kindLabel =
            collectionMode === "AUTO_DEBIT"
              ? "Débito automático"
              : collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK"
                ? "Link de pago"
                : "Débito automático";
          const kindPillClass =
            collectionMode === "AUTO_DEBIT"
              ? "pill-mode-debit"
              : collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK"
                ? "pill-mode-link"
                : "pill-mode-debit";
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
                    {hasPlan ? <span className={`pill pill-sm ${kindPillClass}`}>{kindLabel}</span> : <span className="pill pill-muted pill-sm">Sin suscripción</span>}
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
                    <input type="hidden" name="tenantId" value={c.tenantId || ""} />
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
                                {planName}
                              </Link>
                            ) : (
                              <span className="contact-value contact-value-strong">
                                {planName}
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
                        <span className={`pill pill-sm ${kindPillClass}`}>{kindLabel}</span>
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
                  <div className="paylink-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
                    <Link className="ghost btn-compact btn-noicon btn-blue btn-token contact-action-btn" href={`/customers/${c.id}/payment-method`}>
                      {hasToken(c) ? "Actualizar tarjeta" : "Guardar tarjeta"}
                    </Link>
                    {hasToken(c) ? (
                      <button
                        className="ghost btn-compact btn-noicon btn-red contact-action-btn"
                        type="button"
                        onClick={async () => {
                          if (!window.confirm("¿Quitar el método de pago guardado?")) return;
                          setClearingTokenId(c.id);
                          try {
                            const res = await fetch("/api/customers/clear-payment-source", {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ customerId: c.id })
                            });
                            const json = await res.json().catch(() => ({}));
                            if (!res.ok || !json?.ok) {
                              openNotify("fail", mapSendError(json?.error || "request_failed"));
                              return;
                            }
                            setTokenStateByCustomer((prev) => ({ ...prev, [String(c.id)]: false }));
                            openNotify("ok", "Método de pago removido.");
                          } finally {
                            setClearingTokenId(null);
                          }
                        }}
                        disabled={clearingTokenId === c.id}
                      >
                        {clearingTokenId === c.id ? "Quitando..." : "Quitar token"}
                      </button>
                    ) : null}
                    <button className="ghost btn-compact btn-send btn-pay contact-action-btn" type="button" data-modal="true" data-loader="off" onClick={() => openPayModal(c)}>
                      Enviar link de pago
                    </button>
                    <button className="ghost btn-compact btn-send btn-token contact-action-btn" type="button" data-modal="true" data-loader="off" onClick={() => openTokenModal(c)}>
                      Enviar débito automático
                    </button>
                    <button className="ghost btn-compact btn-send btn-open contact-action-btn" type="button" data-modal="true" data-loader="off" onClick={() => openCartModal(c)}>
                      Enviar catálogo
                    </button>
                    <button className="ghost btn-compact btn-noicon btn-blue btn-create contact-action-btn" type="button" data-modal="true" data-loader="off" onClick={() => openPlanModal(c)}>
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
              </div>
            </div>
          );
        })}
        {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
      </div>
      )}

      {planModalOpen && planModalCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 980 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear plan o suscripción</strong>
              <button className="ghost modal-close" type="button" onClick={closePlanModal} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <NewBillingAssignmentForm
              customers={items}
              empresas={empresas}
              catalogItems={products}
              csrfToken={csrfToken}
              tenantId={planModalCustomer?.tenantId || ""}
              tenants={tenants}
              defaultOpen
              forceOpen
              hideHeader
              returnTo={returnTo || "/customers"}
              defaultSelectedCustomerId={String(planModalCustomer.id)}
              createCustomer={createCustomer}
              createPlanAndSubscription={createPlanAndSubscription}
            />
          </div>
        </div>
      ) : null}

      {payModalOpen && payModalCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Enviar link de pago</strong>
              <button className="ghost modal-close" type="button" onClick={closePayModal} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
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
                const checkoutTemplate = findTemplateForProduct("PLAN", productId);
                if (!checkoutTemplate) {
                  openNotify("fail", mapSendError("missing_checkout_for_product"));
                  return;
                }
                const payTemplate = resolveNotificationTemplate("PAYMENT_LINK_CREATED", "LINK");
                const canSendPay = Boolean(payTemplate?.chatwootTemplate?.name);
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
                      tenantId: customer.tenantId || "",
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
                  if (json?.publicUrl || json?.checkoutUrl) {
                    const nextUrl = String(json?.publicUrl || json?.checkoutUrl || "");
                    setLinkOverrides((prev) => ({ ...prev, [customer.id]: { ...(prev[customer.id] || {}), payment: nextUrl } }));
                  }
                  const chatErr = String(json?.chatwootError || "").trim();
                  if (chatErr) {
                    setSendError((prev) => ({ ...prev, [customer.id]: "centralcom_failed" }));
                    openNotify("fail", `CentralCom no pudo enviar el mensaje: ${chatErr}`);
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
                const canSendPay = Boolean(payTemplate?.chatwootTemplate?.name);
                const productId = resolveCustomerProductId(payModalCustomer.id);
                const checkoutTemplate = productId ? findTemplateForProduct("PLAN", productId) : null;
                const productName = productById.get(productId)?.name || "";
                const missingProduct = !productId;
                const missingCheckout = !checkoutTemplate;
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
                    No hay checkout público para ese producto.
                  </div>
                ) : null}
                {missingPublicBase ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Falta configurar la URL base de checkout público.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Plantilla de mensaje</label>
                <textarea
                  className="input"
                  rows={4}
                  readOnly
                  value={renderNotificationPreview(payTemplate)}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">Se usa la plantilla configurada en Notificaciones.</div>
              </div>
              {!canSendPay ? (
                <div className="paylink-error">
                  {mapSendError("missing_template")}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/notifications?env=PRODUCTION&open=payment_link_created">
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
                      <a className="ghost btn-compact" href="/notifications?env=PRODUCTION&open=payment_link_created">
                        Configurar plantilla
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sendOk[payModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closePayModal} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  disabled={
                    !payAmount ||
                    !canSendPay ||
                    missingProduct ||
                    missingCheckout ||
                    missingPublicBase
                  }
                >
                  Enviar
                </button>
              </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      ) : null}

      {cartModalOpen && cartModalCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Enviar catálogo</strong>
              <button className="ghost modal-close" type="button" onClick={closeCartModal} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form
              className="panel module"
              onSubmit={async (e) => {
                e.preventDefault();
                const customer = cartModalCustomer;
                if (!customer) return;
                const productId = resolveCustomerProductId(customer.id);
                if (!productId) {
                  openNotify("fail", mapSendError("missing_product_for_customer"));
                  return;
                }
                const checkoutTemplate = findTemplateForProduct("CART", productId);
                if (!checkoutTemplate) {
                  openNotify("fail", mapSendError("missing_checkout_for_product"));
                  return;
                }
                const notifTemplate = resolveNotificationTemplate(
                  "CATALOG_LINK_CREATED",
                  cartModalMode === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN"
                );
                const canSendNotif = Boolean(notifTemplate?.chatwootTemplate?.name);
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
                      tenantId: customer.tenantId || "",
                      productId,
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
                  if (json?.link) {
                    setLinkOverrides((prev) => ({ ...prev, [customer.id]: { ...(prev[customer.id] || {}), cart: json.link } }));
                  }
                  setSendOk((prev) => ({ ...prev, [customer.id]: "sent" }));
                  openNotify("ok", "El catálogo fue enviado correctamente.");
                  closeCartModal();
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
                const canSendNotif = Boolean(notifTemplate?.chatwootTemplate?.name);
                const productId = resolveCustomerProductId(cartModalCustomer.id);
                const checkoutTemplate = productId ? findTemplateForProduct("CART", productId) : null;
                const productName = productById.get(productId)?.name || "";
                const missingProduct = !productId;
                const missingCheckout = !checkoutTemplate;
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
                {missingPublicBase ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Falta configurar la URL pública base en Checkout público.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Plantilla de mensaje</label>
                <textarea
                  className="input"
                  rows={4}
                  readOnly
                  value={renderNotificationPreview(
                    resolveNotificationTemplate("CATALOG_LINK_CREATED", cartModalMode === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN")
                  )}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">Se usa la plantilla configurada en Notificaciones.</div>
              </div>
              {!canSendNotif ? (
                <div className="paylink-error">
                  {mapSendError("missing_template")}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/notifications?env=PRODUCTION&open=catalog_link_created">
                      Configurar plantilla
                    </a>
                  </div>
                </div>
              ) : null}
              {sendError[cartModalCustomer.id] ? <div className="paylink-error">{mapSendError(sendError[cartModalCustomer.id])}</div> : null}
              {sendOk[cartModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeCartModal} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  disabled={
                    missingPublicBase ||
                    !canSendNotif ||
                    missingProduct ||
                    missingCheckout
                  }
                >
                  Enviar
                </button>
              </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      ) : null}

      {tokenModalOpen && tokenModalCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Enviar débito automático</strong>
              <button className="ghost modal-close" type="button" onClick={closeTokenModal} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
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
                const checkoutTemplate = findTemplateForProduct("SUBSCRIPTION", productId);
                if (!checkoutTemplate) {
                  openNotify("fail", mapSendError("missing_checkout_for_product"));
                  return;
                }
                const notifTemplate = resolveNotificationTemplate("TOKENIZATION_LINK_CREATED");
                const canSendNotif = Boolean(notifTemplate?.chatwootTemplate?.name);
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
                      tenantId: customer.tenantId || "",
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
                  if (json?.link) {
                    setLinkOverrides((prev) => ({ ...prev, [customer.id]: { ...(prev[customer.id] || {}), token: json.link } }));
                  }
                  setSendOk((prev) => ({ ...prev, [customer.id]: "sent" }));
                  openNotify("ok", "El link de débito automático fue enviado correctamente.");
                  closeTokenModal();
                } finally {
                  setSendingTokenId(null);
                }
              }}
            >
              {(() => {
                const notifTemplate = resolveNotificationTemplate("TOKENIZATION_LINK_CREATED");
                const canSendNotif = Boolean(notifTemplate?.chatwootTemplate?.name);
                const productId = resolveCustomerProductId(tokenModalCustomer.id);
                const checkoutTemplate = productId ? findTemplateForProduct("SUBSCRIPTION", productId) : null;
                const productName = productById.get(productId)?.name || "";
                const missingProduct = !productId;
                const missingCheckout = !checkoutTemplate;
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
                  value={renderNotificationPreview(resolveNotificationTemplate("TOKENIZATION_LINK_CREATED"))}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">Se usa la plantilla configurada en Notificaciones.</div>
              </div>
              {!canSendNotif ? (
                <div className="paylink-error">
                  {mapSendError("missing_template")}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/notifications?env=PRODUCTION&open=tokenization_link_created">
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
                      <a className="ghost btn-compact" href="/notifications?env=PRODUCTION&open=tokenization_link_created">
                        Configurar plantilla
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sendOk[tokenModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeTokenModal} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  disabled={
                    missingSubBase ||
                    !canSendNotif ||
                    missingProduct ||
                    missingCheckout
                  }
                >
                  Enviar
                </button>
              </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      ) : null}


      {viewLinksOpen ? (
        <ViewLinksModal links={viewLinksItems} onClose={closeViewLinks} />
      ) : null}

      {viewFichaOpen && viewFichaCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel customer-view-ficha-modal" style={{ width: "min(700px, 96vw)" }}>
            <div className="panel-header" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Ficha: {viewFichaCustomer.name || viewFichaCustomer.email || "Contacto"}</h3>
              <button type="button" className="ghost modal-close" onClick={closeViewFicha} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <div className="modal-body" style={{ display: "grid", gap: 16 }}>
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
                  const planName = formatPlanLabel(subInfo?.planName || "");
                  const status = String(subInfo?.status || "");
                  const statusLabel = status === "ACTIVE" ? "Activa" : status === "PAST_DUE" ? "En mora" : status ? "Inactiva" : "";
                  return (
                    <div style={{ fontSize: 12 }}>
                      {hasPlan ? (
                        <>
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Plan: </span>
                            <strong>{planName}</strong>
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
            </div>

            {/* Footer con botones */}
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px" }}>
              <button className="ghost btn-compact" type="button" onClick={closeViewFicha}>Cerrar</button>
              <button className="primary btn-compact" type="button" onClick={() => { closeViewFicha(); openEditor(viewFichaCustomer); }}>Editar</button>
            </div>
          </div>
        </div>
      ) : null}

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
