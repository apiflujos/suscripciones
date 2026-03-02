"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { deleteCustomer, updateCustomer } from "./actions";
import { LocalDateTime } from "../ui/LocalDateTime";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";

function formatCopFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

type CustomerRow = {
  id: string;
  tenantId?: string | null;
  tenantName?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt?: string;
  metadata?: any;
};

type LatestLink = {
  checkoutUrl: string;
  createdAt: string;
  chatwootStatus: string;
  chatwootError?: string;
};

type TransactionRow = {
  id: string;
  amountInCents: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt?: string | null;
  reference?: string | null;
  planName?: string | null;
  lastAttempt?: {
    status?: string | null;
    errorMessage?: string | null;
    provider?: string | null;
    createdAt?: string | null;
  } | null;
};

export function CustomersTable({
  items,
  latestLinks,
  subscriptionsByCustomer,
  cartTemplates,
  products,
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
  latestLinks: Record<string, LatestLink>;
  subscriptionsByCustomer: Record<string, { hasPlan: boolean; planName?: string; status?: string; collectionMode?: string }>;
  cartTemplates: Array<{ id: string; name: string }>;
  products: any[];
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
  const [txItems, setTxItems] = useState<TransactionRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState("");
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
  const [cartTemplateByCustomer, setCartTemplateByCustomer] = useState<Record<string, string>>({});
  const [tokenTemplateByCustomer, setTokenTemplateByCustomer] = useState<Record<string, string>>({});
  const [paymentTemplateByCustomer, setPaymentTemplateByCustomer] = useState<Record<string, string>>({});
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planModalCustomer, setPlanModalCustomer] = useState<CustomerRow | null>(null);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartModalCustomer, setCartModalCustomer] = useState<CustomerRow | null>(null);
  const [cartModalMode, setCartModalMode] = useState<"PLAN" | "SUBSCRIPTION">("PLAN");
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payModalCustomer, setPayModalCustomer] = useState<CustomerRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenModalCustomer, setTokenModalCustomer] = useState<CustomerRow | null>(null);
  const [clearingTokenId, setClearingTokenId] = useState<string | null>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [sendMenuCustomer, setSendMenuCustomer] = useState<CustomerRow | null>(null);
  const planBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const subscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const publicBaseUrl = String(checkoutConfig?.planBaseUrl || checkoutConfig?.subscriptionBaseUrl || "").trim();
  const missingPlanBase = !planBaseUrl;
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

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [dept, setDept] = useState("");
  const [city, setCity] = useState("");
  const [code5, setCode5] = useState("");
  const [dane8, setDane8] = useState("");
  const modalRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  const modalTitle = useMemo(() => (editing ? `Editar: ${editing.name || editing.email || "Contacto"}` : "Editar contacto"), [editing]);

  function hasToken(customer: CustomerRow) {
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

  function resolveCartTemplate(customerId: string, mode?: "PLAN" | "SUBSCRIPTION") {
    const chosen = cartTemplateByCustomer[customerId];
    if (chosen) return chosen;
    const first = checkoutTemplates.find((t: any) => {
      if (String(t?.kind || "") !== "CART") return false;
      if (!mode) return true;
      const inferred = inferTemplateMode(t);
      return inferred !== "MIXED" && inferred === mode;
    });
    return first?.id || "";
  }

  function resolveTokenTemplate(customerId: string) {
    const chosen = tokenTemplateByCustomer[customerId];
    if (chosen) return chosen;
    return "";
  }

  function resolvePaymentTemplate(customerId: string) {
    const chosen = paymentTemplateByCustomer[customerId];
    if (chosen) return chosen;
    const first = checkoutTemplates.find((t: any) => String(t?.kind || "") === "PLAN");
    return first?.id || "";
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
    setName(item.name || "");
    setEmail(item.email || "");
    setPhone(item.phone || "");
    setIdType(String(item.metadata?.identificacionTipo || ""));
    setIdNumber(String(item.metadata?.identificacionNumero || item.metadata?.identificacion || ""));
    setAddressLine1(String(item.metadata?.address?.line1 || ""));
    setDept(String(item.metadata?.address?.dept || ""));
    setCity(String(item.metadata?.address?.city || ""));
    setCode5(String(item.metadata?.address?.code5 || ""));
    setDane8(String(item.metadata?.address?.dane8 || ""));
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
      const p = productById.get(String(id));
      const mode = String(p?.collectionMode || p?.metadata?.collectionMode || "");
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

  function openSendMenu(customer: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setSendMenuCustomer(customer);
    setSendMenuOpen(true);
  }

  function closeSendMenu() {
    setSendMenuOpen(false);
    setSendMenuCustomer(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
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
      case "missing_template":
        return "Selecciona una plantilla antes de enviar.";
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

  async function openTransactions(item: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setTxCustomer(item);
    setTxOpen(true);
    setTxLoading(true);
    setTxError("");
    setTxItems([]);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(String(item.id))}/transactions`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTxError(json?.error || `Error ${res.status}`);
        return;
      }
      setTxItems(Array.isArray(json?.items) ? json.items : []);
    } catch (err: any) {
      setTxError(String(err?.message || "request_failed"));
    } finally {
      setTxLoading(false);
    }
  }

  function closeTransactions() {
    setTxOpen(false);
    setTxCustomer(null);
    setTxItems([]);
    setTxError("");
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    const el = modalRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
  }, [open]);

  useEffect(() => {
    if (!initialTxCustomerId || txOpen) return;
    const found = items.find((c) => String(c.id) === String(initialTxCustomerId));
    if (found) openTransactions(found);
  }, [initialTxCustomerId, items]);

  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (txOpen) closeTransactions();
      else closeEditor();
      return;
    }
    if (e.key !== "Tab") return;
    const root = e.currentTarget as HTMLElement;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]"))
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
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
          const planName = subInfo?.planName || "";
          const status = String(subInfo?.status || "");
          const collectionMode = String(subInfo?.collectionMode || "");
          const kindLabel =
            collectionMode === "AUTO_DEBIT"
              ? "Suscripción"
              : collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK"
                ? "Plan"
                : "Suscripción";
          const statusLabel =
            status === "ACTIVE" ? "Activa" : status === "PAST_DUE" ? "En mora" : status ? "Inactiva" : "";
          const statusPillClass = status === "ACTIVE" ? "pill-ok" : status === "PAST_DUE" ? "pill-bad" : status ? "pill-muted" : "";
          return (
            <div className="contact-card" key={c.id}>
              <div className="contact-card-top">
                <div className="contact-head">
                  <div className="contact-title">{c.name || "—"}</div>
                  <div className="contact-tags">
                    {hasToken(c) ? <span className="pill pill-ok pill-sm">Tokenizada</span> : <span className="pill pill-bad pill-sm">Sin token</span>}
                    {hasPlan ? <span className="pill pill-muted pill-sm">{kindLabel}</span> : <span className="pill pill-muted pill-sm">Sin plan</span>}
                    {statusLabel && statusPillClass ? <span className={`pill ${statusPillClass} pill-sm`}>{statusLabel}</span> : null}
                  </div>
                </div>
                  <div className="contact-card-top-actions">
                    <button className="ghost btn-compact btn-noicon" type="button" onClick={() => openTransactions(c)} aria-label="Historial de pagos">
                      Historial
                    </button>
                    <button className="ghost btn-compact btn-noicon" type="button" onClick={() => openEditor(c)} aria-label="Editar">
                      Editar
                    </button>
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
                    <button className="ghost btn-compact btn-noicon btn-red" type="submit" aria-label="Eliminar">
                      Eliminar
                    </button>
                  </form>
                </div>
              </div>
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
                <div className="contact-block-title">Plan / suscripción</div>
                <div className="contact-plan-grid">
                  <div>
                    <span>Plan / Suscripción</span>
                    <div className="contact-plan-row">
                      {hasPlan ? (
                        <>
                          <span className="contact-value contact-value-strong" style={{ fontSize: 13 }}>
                            {planName ? `${planName}${statusLabel ? ` · ${statusLabel}` : ""}` : statusLabel || "Activa"}
                          </span>
                        </>
                      ) : (
                        <span className="contact-value contact-value-strong" style={{ fontSize: 13 }}>—</span>
                      )}
                    </div>
                  </div>
                  {!hasToken(c) ? (
                    <div>
                      <span>Método de pago</span>
                      <div className="field-hint">Envía el link de tokenización para que el cliente guarde su tarjeta.</div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="contact-paylink contact-footer">
                  <div className="paylink-header">
                    <span className="paylink-title">Pagos y tokenización</span>
                  </div>
                  <div className="paylink-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
                    <Link className="ghost btn-compact btn-noicon btn-amber btn-token" href={`/customers/${c.id}/payment-method`}>
                      {hasToken(c) ? "Tokenizar otra tarjeta" : "Tokenizar"}
                    </Link>
                    {hasToken(c) ? (
                      <button
                        className="ghost btn-compact btn-noicon btn-red"
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
                    <button className="ghost btn-compact btn-noicon btn-blue btn-send" type="button" data-modal="true" data-loader="off" onClick={() => openSendMenu(c)}>
                      Enviar
                    </button>
                    <Link className="ghost btn-compact btn-noicon btn-blue btn-view" href={`/customers/${c.id}`}>
                      Ver detalles
                    </Link>
                    <button className="ghost btn-compact btn-noicon btn-green btn-create" type="button" data-modal="true" data-loader="off" onClick={() => openPlanModal(c)}>
                      Crear plan / suscripción
                    </button>
                    {(() => {
                      const override = linkOverrides[c.id] || {};
                      const tokenLink = override.token || getTokenLink(c);
                      const cartLink = override.cart || getCartLink(c);
                      return (
                        <>
                          {tokenLink ? (
                            <a className="ghost btn-compact btn-noicon btn-amber btn-token" href={tokenLink} target="_blank" rel="noreferrer" title={maskUrl(tokenLink)}>
                              Link de tokenización
                            </a>
                          ) : null}
                          {cartLink ? (
                            <a className="ghost btn-compact btn-noicon btn-green btn-open" href={cartLink} target="_blank" rel="noreferrer" title={maskUrl(cartLink)}>
                              Link de catálogo
                            </a>
                          ) : null}
                        </>
                      );
                    })()}
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
              catalogItems={products}
              checkoutTemplates={checkoutTemplates}
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
                const templateId = resolvePaymentTemplate(customer.id);
                if (!templateId) {
                  setSendError((prev) => ({ ...prev, [customer.id]: "missing_template" }));
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
                      templateId
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
                  if (json?.notificationsRulesActive === false && !json?.fallbackSent) {
                    setSendError((prev) => ({ ...prev, [customer.id]: "no_rules" }));
                    openNotify("fail", "No hay notificaciones activas para enviar el link.");
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
                } catch (err: any) {
                  const msg = String(err?.message || "send_failed");
                  setSendError((prev) => ({ ...prev, [customer.id]: msg }));
                  openNotify("fail", mapSendError(msg));
                } finally {
                  setSendingPaymentId(null);
                }
              }}
            >
              <div className="field">
                <label>Checkout público</label>
                <select
                  className="select"
                  value={resolvePaymentTemplate(payModalCustomer.id)}
                  onChange={(e) =>
                    setPaymentTemplateByCustomer((prev) => ({
                      ...prev,
                      [payModalCustomer.id]: e.target.value
                    }))
                  }
                  required
                >
                  <option value="">Selecciona una plantilla</option>
                  {checkoutTemplates
                    .filter((t: any) => String(t?.kind || "") === "PLAN")
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                {checkoutTemplates.filter((t: any) => String(t?.kind || "") === "PLAN").length === 0 ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay plantillas de plan configuradas.
                  </div>
                ) : null}
              </div>
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
                {missingPlanBase ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Falta configurar la URL base de plan en Checkout público.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Plantilla de mensaje</label>
                <textarea
                  className="input"
                  rows={4}
                  readOnly
                  value={renderNotificationPreview(resolveNotificationTemplate("PAYMENT_LINK_CREATED", "LINK"))}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <div className="field-hint">Se usa la plantilla configurada en Notificaciones.</div>
              </div>
              {sendError[payModalCustomer.id] ? <div className="paylink-error">{mapSendError(sendError[payModalCustomer.id])}</div> : null}
              {sendOk[payModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closePayModal} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button className="primary btn-send" type="submit" disabled={!payAmount || missingPlanBase || !resolvePaymentTemplate(payModalCustomer.id)}>
                  Enviar
                </button>
              </div>
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
                const templateId = resolveCartTemplate(customer.id, cartModalMode);
                if (!templateId) {
                  openNotify("fail", "No hay plantillas de catálogo para enviar.");
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
                      templateId,
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
                } finally {
                  setSendingCartId(null);
                }
              }}
            >
              <div className="field">
                <label>Tipo de catálogo</label>
                <select className="select" value={cartModalMode} onChange={(e) => setCartModalMode(e.target.value as any)}>
                  <option value="PLAN">Plan (link de pago)</option>
                  <option value="SUBSCRIPTION">Suscripción (tokenización)</option>
                </select>
                <div className="field-hint">
                  Plan: el cliente paga con un link. Suscripción: el cliente tokeniza tarjeta para cobros automáticos.
                </div>
              </div>
              <div className="field">
                <label>Plantilla de catálogo</label>
                <select
                  className="select"
                  value={resolveCartTemplate(cartModalCustomer.id, cartModalMode)}
                  onChange={(e) =>
                    setCartTemplateByCustomer((prev) => ({
                      ...prev,
                      [cartModalCustomer.id]: e.target.value
                    }))
                  }
                  required
                >
                  {checkoutTemplates
                    .filter((t: any) => {
                      if (String(t?.kind || "") !== "CART") return false;
                      const mode = inferTemplateMode(t);
                      return mode === "MIXED" ? false : mode === cartModalMode;
                    })
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                {checkoutTemplates.filter((t: any) => String(t?.kind || "") === "CART").length === 0 ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay plantillas de catálogo configuradas.
                  </div>
                ) : null}
                {checkoutTemplates.filter((t: any) => String(t?.kind || "") === "CART" && inferTemplateMode(t) === cartModalMode).length === 0 ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay plantillas de catálogo para {cartModalMode === "PLAN" ? "planes" : "suscripciones"}.
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
              {sendError[cartModalCustomer.id] ? <div className="paylink-error">{mapSendError(sendError[cartModalCustomer.id])}</div> : null}
              {sendOk[cartModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeCartModal} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button
                  className="primary btn-send"
                  type="submit"
                  disabled={missingPublicBase || !resolveCartTemplate(cartModalCustomer.id, cartModalMode)}
                >
                  Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {sendMenuOpen && sendMenuCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Enviar</strong>
              <button className="ghost modal-close" type="button" onClick={closeSendMenu} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="panel module">
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Selecciona qué deseas enviar al cliente.
              </div>
              <div className="send-grid">
                <button
                  type="button"
                  className="ghost btn-noicon send-option"
                  onClick={() => {
                    closeSendMenu();
                    openPayModal(sendMenuCustomer);
                  }}
                  data-loader="off"
                >
                  <span className="send-icon btn-link" aria-hidden />
                  <span>Link de pago</span>
                </button>
                <button
                  type="button"
                  className="ghost btn-noicon send-option"
                  onClick={() => {
                    closeSendMenu();
                    openTokenModal(sendMenuCustomer);
                  }}
                  data-loader="off"
                >
                  <span className="send-icon btn-lock" aria-hidden />
                  <span>Tokenización</span>
                </button>
                <button
                  type="button"
                  className="ghost btn-noicon send-option"
                  onClick={() => {
                    closeSendMenu();
                    openCartModal(sendMenuCustomer);
                  }}
                  data-loader="off"
                >
                  <span className="send-icon btn-card" aria-hidden />
                  <span>Catálogo</span>
                </button>
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeSendMenu} data-modal-close="true" data-loader="off">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tokenModalOpen && tokenModalCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Enviar tokenización</strong>
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
                const templateId = resolveTokenTemplate(customer.id);
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
                      ...(templateId ? { templateId } : {})
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
                  openNotify("ok", "El link de tokenización fue enviado correctamente.");
                } finally {
                  setSendingTokenId(null);
                }
              }}
            >
              <div className="field">
                <label>Plantilla de suscripción</label>
                <select
                  className="select"
                  value={resolveTokenTemplate(tokenModalCustomer.id)}
                  onChange={(e) =>
                    setTokenTemplateByCustomer((prev) => ({
                      ...prev,
                      [tokenModalCustomer.id]: e.target.value
                    }))
                  }
                >
                  <option value="">Selecciona una plantilla</option>
                  {checkoutTemplates
                    .filter((t: any) => String(t?.kind || "") === "SUBSCRIPTION")
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                {checkoutTemplates.filter((t: any) => String(t?.kind || "") === "SUBSCRIPTION").length === 0 ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay plantillas de suscripción configuradas.
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
              {sendError[tokenModalCustomer.id] ? <div className="paylink-error">{mapSendError(sendError[tokenModalCustomer.id])}</div> : null}
              {sendOk[tokenModalCustomer.id] ? <div className="paylink-success">Mensaje enviado correctamente.</div> : null}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={closeTokenModal} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button className="primary btn-send" type="submit" disabled={!resolveTokenTemplate(tokenModalCustomer.id) || missingSubBase}>
                  Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}


      {open && editing ? (
        <div className="modal-backdrop">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-edit-title"
            className="modal-panel contact-edit-modal"
            style={{ width: "min(860px, 96vw)", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden" }}
            onKeyDown={onModalKeyDown}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="customer-edit-title" style={{ margin: 0 }}>{modalTitle}</h3>
              <button type="button" className="ghost modal-close" onClick={closeEditor} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>

            <form
              action={updateCustomer}
              onSubmit={(e) => {
                e.currentTarget.classList.add("was-validated");
              }}
              className="contact-edit-form"
            >
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="tenantId" value={editing.tenantId || ""} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

              <div className="contact-edit-grid-2">
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input className="input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              </div>

              <div className="contact-edit-grid-2">
                <div className="field">
                  <label>Teléfono</label>
                  <input className="input" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Identificación</label>
                  <div className="contact-edit-id-grid">
                    <input className="input" name="idType" value={idType} onChange={(e) => setIdType(e.target.value)} placeholder="CC" />
                    <input className="input" name="idNumber" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Dirección</label>
                <input className="input" name="addressLine1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
              </div>

              <div className="contact-edit-grid-4">
                <div className="field">
                  <label>Departamento</label>
                  <input className="input" name="dept" value={dept} onChange={(e) => setDept(e.target.value)} />
                </div>
                <div className="field">
                  <label>Ciudad</label>
                  <input className="input" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="field">
                  <label>Código 5</label>
                  <input className="input" name="code5" value={code5} onChange={(e) => setCode5(e.target.value)} />
                </div>
                <div className="field">
                  <label>DANE 8</label>
                  <input className="input" name="dane8" value={dane8} onChange={(e) => setDane8(e.target.value)} />
                </div>
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="ghost" type="button" onClick={closeEditor} data-modal-close="true" data-loader="off">
                  Cancelar
                </button>
                <button className="primary btn-save" type="submit">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {txOpen && txCustomer ? (
        <div className="modal-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-tx-title"
            className="modal-panel"
            style={{ width: "min(900px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
            onKeyDown={onModalKeyDown}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="customer-tx-title" style={{ margin: 0 }}>
                Transacciones: {txCustomer.name || txCustomer.email || txCustomer.id}
              </h3>
              <button type="button" className="ghost modal-close" onClick={closeTransactions} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            {txLoading ? <div className="field-hint">Cargando transacciones…</div> : null}
            {txError ? <div className="field-hint" style={{ color: "var(--danger)" }}>Error: {txError}</div> : null}
            {!txLoading && !txError && txItems.length === 0 ? <div className="field-hint">No hay transacciones.</div> : null}
            {!txLoading && !txError && txItems.length ? (
              <div className="table-scroll">
                <table className="table table-fixed">
                  <colgroup>
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "16%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Último intento</th>
                      <th>Producto/Plan</th>
                      <th>Referencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txItems.map((t) => (
                      <tr key={t.id}>
                        <td><LocalDateTime value={t.createdAt} /></td>
                        <td>{formatCopFromCents(t.amountInCents)}</td>
                        <td className="cell-truncate" title={t.status || "—"}>{t.status || "—"}</td>
                        <td>
                          {t.lastAttempt ? (
                            <div style={{ display: "grid", gap: 2 }}>
                              <span className="cell-truncate" title={t.lastAttempt.status || "—"}>{t.lastAttempt.status || "—"}</span>
                              {t.lastAttempt.errorMessage ? (
                                <span className="field-hint cell-wrap" style={{ color: "var(--danger)" }}>
                                  {t.lastAttempt.errorMessage}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="cell-truncate" title={t.planName || "—"}>{t.planName || "—"}</td>
                        <td className="cell-truncate mono" title={t.reference || "—"}>{t.reference || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
