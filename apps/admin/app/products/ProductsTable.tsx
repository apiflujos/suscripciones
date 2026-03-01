"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { sendProductToCustomer, updateProduct } from "./actions";
import { HelpTip } from "../ui/HelpTip";
import { VariantsEditor } from "./VariantsEditor";
import { LocalDateTime } from "../ui/LocalDateTime";
import { DeleteProductButton } from "./DeleteProductButton";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";

function formatCopCurrency(input: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function formatCopFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  tenantName?: string;
  tenantId?: string | null;
  tenantIds?: string[];
  kind: "PRODUCT" | "SERVICE";
  currency: string;
  basePriceInCents: number;
  intervalUnit?: "DAY" | "WEEK" | "MONTH" | "CUSTOM";
  intervalCount?: number;
  taxPercent?: number;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  description?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string | null;
  unit?: string | null;
  requiresShipping?: boolean;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
  imageUrl?: string | null;
  collectionMode?: string | null;
};

type ChatwootInbox = {
  id: number;
  name: string;
  channelType?: string;
  medium?: string;
  provider?: string;
};

export function ProductsTable({
  items,
  csrfToken,
  deleteProductAction,
  tenants,
  customers,
  inboxes,
  checkoutTemplates,
  createCustomer,
  createPlanAndSubscription,
  returnTo
}: {
  items: ProductRow[];
  csrfToken: string;
  deleteProductAction: (formData: FormData) => void | Promise<void>;
  tenants: Array<{ id: string; name: string }>;
  customers: any[];
  inboxes: ChatwootInbox[];
  checkoutTemplates: any[];
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
}) {
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [txProduct, setTxProduct] = useState<ProductRow | null>(null);
  const [txItems, setTxItems] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendProduct, setSendProduct] = useState<ProductRow | null>(null);
  const [sendCustomerId, setSendCustomerId] = useState("");
  const [sendIncludeLink, setSendIncludeLink] = useState(true);
  const [sendIncludeImage, setSendIncludeImage] = useState(true);
  const [sendMessage, setSendMessage] = useState("");
  const [sendSearch, setSendSearch] = useState("");
  const [sendSearchDebounced, setSendSearchDebounced] = useState("");
  const [messageDirty, setMessageDirty] = useState(false);
  const [sendInboxId, setSendInboxId] = useState("");
  const [txError, setTxError] = useState("");
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planModalProduct, setPlanModalProduct] = useState<ProductRow | null>(null);

  const [kind, setKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");
  const [unit, setUnit] = useState("");
  const [priceCop, setPriceCop] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");
  const [discountType, setDiscountType] = useState<"NONE" | "FIXED" | "PERCENT">("NONE");
  const [discountCop, setDiscountCop] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [collectionMode, setCollectionMode] = useState<"AUTO_LINK" | "AUTO_DEBIT">("AUTO_LINK");
  const [requiresShipping, setRequiresShipping] = useState(false);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [option1Name, setOption1Name] = useState("");
  const [option2Name, setOption2Name] = useState("");
  const [variantOptionsCount, setVariantOptionsCount] = useState<0 | 1 | 2>(0);
  const [variantsJson, setVariantsJson] = useState("[]");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const modalRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  const showVariants = variantOptionsCount > 0 && kind === "PRODUCT";
  const showOption2 = showVariants && variantOptionsCount === 2;

  function openEditor(item: ProductRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setEditing(item);
    setOpen(true);
    setKind(item.kind || "PRODUCT");
    setName(item.name || "");
    setSku(item.sku || "");
    setDescription(item.description || "");
    setVendor(item.vendor || "");
    setProductType(item.productType || "");
    setTags(item.tags || "");
    setUnit(item.unit || "");
    setPriceCop(formatCopFromCents(Number(item.basePriceInCents || 0)));
    setTaxPercent(String(item.taxPercent ?? 0));
    setDiscountType((item.discountType as any) || "NONE");
    setDiscountCop(formatCopFromCents(Number(item.discountValueInCents || 0)));
    setDiscountPercent(String(item.discountPercent ?? 0));
    setCollectionMode(String(item.collectionMode || "AUTO_LINK") as any);
    setIntervalUnit((item.intervalUnit as any) || "MONTH");
    setIntervalCount(String(item.intervalCount || 1));
    setRequiresShipping(Boolean(item.requiresShipping));
    setOption1Name(item.option1Name || "");
    setOption2Name(item.option2Name || "");
    const currentImageUrl = String(item.imageUrl || "");
    setImageUrl(currentImageUrl);
    setImageUrlInput(isPublicImage(currentImageUrl) ? currentImageUrl : "");
    const ids = Array.isArray(item.tenantIds) && item.tenantIds.length ? item.tenantIds : item.tenantId ? [item.tenantId] : [];
    setSelectedTenantIds(ids as string[]);
    const hasOpt2 = Boolean(item.option2Name) || (item.variants || []).some((v) => v?.option2);
    const hasOpt1 = Boolean(item.option1Name) || (item.variants || []).some((v) => v?.option1);
    setVariantOptionsCount(hasOpt2 ? 2 : hasOpt1 ? 1 : 0);
    setVariantsJson(JSON.stringify(item.variants || []));
  }

  function closeEditor() {
    setOpen(false);
    setEditing(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  async function openTransactions(item: ProductRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setTxProduct(item);
    setTxOpen(true);
    setTxLoading(true);
    setTxError("");
    setTxItems([]);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(String(item.id))}/transactions`, { cache: "no-store" });
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
    setTxProduct(null);
    setTxItems([]);
    setTxError("");
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function openPlanModal(item: ProductRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setPlanModalProduct(item);
    setPlanModalOpen(true);
  }

  function closePlanModal() {
    setPlanModalOpen(false);
    setPlanModalProduct(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    const el = modalRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
  }, [open]);

  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor();
      return;
    }
    if (e.key !== "Tab") return;
    const root = modalRef.current;
    if (!root) return;
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

  const modalTitle = useMemo(() => (editing ? `Editar: ${editing.name}` : "Editar producto"), [editing]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSendSearchDebounced(sendSearch);
    }, 250);
    return () => clearTimeout(handle);
  }, [sendSearch]);

  const normalizedQuery = useMemo(() => {
    const raw = sendSearchDebounced.trim();
    if (!raw) return "";
    return raw
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }, [sendSearchDebounced]);

  const filteredCustomers = useMemo(() => {
    const list = Array.isArray(customers) ? customers : [];
    if (!normalizedQuery) return list;
    return list.filter((c: any) => {
      const name = String(c?.name || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
      const email = String(c?.email || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
      const phone = String(c?.phone || "")
        .replace(/\s+/g, "")
        .toLowerCase();
      return name.includes(normalizedQuery) || email.includes(normalizedQuery) || phone.includes(normalizedQuery);
    });
  }, [customers, normalizedQuery]);

  const selectedCustomer = useMemo(
    () => (Array.isArray(customers) ? customers.find((c: any) => String(c.id) === String(sendCustomerId)) : null),
    [customers, sendCustomerId]
  );
  const sortedInboxes = useMemo(() => {
    const list = Array.isArray(inboxes) ? inboxes.slice() : [];
    return list.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "es"));
  }, [inboxes]);
  const searchActive = normalizedQuery.length >= 2;
  const selectedInbox = useMemo(
    () => (sendInboxId ? sortedInboxes.find((i) => String(i.id) === String(sendInboxId)) : null),
    [sendInboxId, sortedInboxes]
  );
  const selectedInboxChannel = useMemo(() => {
    const raw = selectedInbox?.channelType || selectedInbox?.medium || selectedInbox?.provider || "";
    return String(raw || "").trim();
  }, [selectedInbox]);
  const selectedInboxChannelLabel = useMemo(() => {
    if (!selectedInboxChannel) return "";
    return selectedInboxChannel.replace(/_/g, " ");
  }, [selectedInboxChannel]);
  const selectedInboxIsWhatsapp = selectedInboxChannel.toLowerCase().includes("whatsapp");
  const sendImageReady = Boolean(sendProduct && sendIncludeImage && isPublicImage(sendProduct.imageUrl));
  const searchResults = useMemo(() => {
    if (!normalizedQuery || normalizedQuery.length < 2) return [];
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const scored = filteredCustomers
      .map((c: any) => {
        const name = String(c?.name || "")
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
        const email = String(c?.email || "")
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
        const phone = String(c?.phone || "").replace(/\s+/g, "").toLowerCase();
        let score = 0;
        let reason = "";
        if (email && email === normalizedQuery) {
          score += 160;
          reason = "Email exacto";
        }
        if (phone && phone === normalizedQuery.replace(/\s+/g, "")) {
          score += 160;
          reason = reason || "Teléfono exacto";
        }
        if (name && name === normalizedQuery) {
          score += 140;
          reason = reason || "Nombre exacto";
        }
        if (name.startsWith(normalizedQuery)) {
          score += 90;
          reason = reason || "Nombre inicia";
        }
        if (email.startsWith(normalizedQuery) || phone.startsWith(normalizedQuery.replace(/\s+/g, ""))) {
          score += 80;
          reason = reason || "Contacto inicia";
        }
        if (name.includes(normalizedQuery)) {
          score += 60;
          reason = reason || "Nombre contiene";
        }
        if (email.includes(normalizedQuery) || phone.includes(normalizedQuery.replace(/\s+/g, ""))) {
          score += 50;
          reason = reason || "Contacto contiene";
        }
        if (tokens.length) {
          const tokenHits = tokens.reduce((acc, t) => (name.includes(t) ? acc + 1 : acc), 0);
          score += tokenHits * 10;
          if (tokenHits && !reason) reason = "Coincidencias parciales";
        }
        return { item: c, score, reason };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.item?.name || "").localeCompare(String(b.item?.name || ""), "es");
      })
      .slice(0, 10);
    return scored;
  }, [filteredCustomers, normalizedQuery]);
  const searchTotal = searchActive ? filteredCustomers.length : 0;

  function formatCustomerLabel(c: any) {
    return String(c?.name || c?.email || c?.phone || "Contacto").trim() || "Contacto";
  }

  function formatCustomerMeta(c: any) {
    const email = String(c?.email || "").trim();
    const phone = String(c?.phone || "").trim();
    return [email, phone].filter(Boolean).join(" · ");
  }

  function pickCustomer(c: any) {
    if (!c) return;
    const label = formatCustomerLabel(c);
    setSendCustomerId(String(c.id));
    setSendSearch(label);
  }

  function isPublicImage(url?: string | null) {
    const value = String(url || "").trim();
    return /^https?:\/\//i.test(value);
  }

  function buildSendTemplate(product: ProductRow, includeLink: boolean, includeImage: boolean) {
    const lines: string[] = [];
    lines.push("Hola {{cliente}} 👋");
    lines.push("");
    lines.push(`Te comparto ${product.kind === "SERVICE" ? "el servicio" : "el producto"} *{{producto}}*.`);
    if (product.description) {
      lines.push("");
      lines.push("{{descripcion}}");
    }
    lines.push("");
    lines.push("Precio: {{precio}}");
    if (includeImage && isPublicImage(product.imageUrl)) {
      lines.push("");
      lines.push("Imagen: {{imagen}}");
    }
    if (includeLink) {
      lines.push("");
      lines.push("Puedes pagar de forma segura aquí:");
      lines.push("{{link}}");
    }
    lines.push("");
    lines.push("Quedo atento.");
    return lines.join("\n");
  }

  function openSendModal(item: ProductRow) {
    setSendProduct(item);
    setSendOpen(true);
    const includeImg = isPublicImage(item.imageUrl);
    setSendIncludeImage(includeImg);
    setSendIncludeLink(true);
    setSendCustomerId("");
    setSendSearch("");
    setMessageDirty(false);
    setSendInboxId("");
    setSendMessage(buildSendTemplate(item, true, includeImg));
  }

  function closeSendModal() {
    setSendOpen(false);
    setSendProduct(null);
    setSendCustomerId("");
    setSendSearch("");
    setSendMessage("");
    setMessageDirty(false);
    setSendInboxId("");
  }

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      setImageError("La imagen supera 2MB. Usa una URL pública o comprímela.");
      return;
    }
    setImageUploading(true);
    setImageError("");
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/uploads/product-image", { method: "POST", body: fd })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "upload_failed");
        const url = String(json?.url || "").trim();
        if (!url) throw new Error("upload_missing_url");
        setImageUrl(url);
        setImageUrlInput(url);
      })
      .catch((err) => {
        setImageError(String(err?.message || "No se pudo subir la imagen."));
      })
      .finally(() => {
        setImageUploading(false);
      });
  }

  function applyImageUrl(value?: string) {
    const trimmed = String(value ?? imageUrlInput).trim();
    if (!trimmed) {
      setImageUrl("");
      return;
    }
    if (!isPublicImage(trimmed)) return;
    setImageUrl(trimmed);
  }

  function formatInboxLabel(inbox: ChatwootInbox) {
    const name = String(inbox?.name || `Inbox ${inbox?.id}`);
    const channel = String(inbox?.channelType || inbox?.medium || inbox?.provider || "").trim();
    return channel ? `${name} · ${channel}` : name;
  }

  return (
    <>
      <div className="product-grid" aria-label="Listado de productos y servicios">
        {items.map((p) => (
          <div className="product-card" key={p.id}>
            <div className="product-header">
              <div className="product-title-row">
                <div className="product-thumb">
                  {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <span>📦</span>}
                </div>
              <div className="product-title">
                <div className="product-name">{p.name}</div>
                <div className="product-sub">
                  <span className="product-sku">{p.sku}</span>
                  <span>·</span>
                  <span>{p.kind === "SERVICE" ? "Servicio" : "Producto"}</span>
                  {p.tenantName ? (
                    <>
                      <span>·</span>
                      <span>{p.tenantName}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ghost btn-compact btn-blue btn-view" type="button" data-modal="true" onClick={() => openTransactions(p)}>
                  🧾 Transacciones
                </button>
                <button className="ghost btn-compact btn-amber" type="button" data-modal="true" data-loader="off" onClick={() => openSendModal(p)}>
                  📩 Enviar
                </button>
                <button className="ghost btn-compact btn-green btn-create" type="button" data-modal="true" onClick={() => openPlanModal(p)}>
                  Crear plan / suscripción
                </button>
                <button className="ghost btn-compact btn-blue btn-edit" type="button" data-modal="true" onClick={() => openEditor(p)}>
                  Editar
                </button>
                <DeleteProductButton action={deleteProductAction} csrfToken={csrfToken} productId={p.id} tenantId={String(p.tenantId || "")} returnTo={returnTo} />
              </div>
            </div>
            <div className="product-info">
              <div>
                <span>Precio</span>
                <strong>{formatCopFromCents(p.basePriceInCents)}</strong>
              </div>
              <div>
                <span>IVA</span>
                <strong>{p.taxPercent ? `${p.taxPercent}%` : "—"}</strong>
              </div>
              <div>
                <span>Descuento</span>
                <strong>
                  {p.discountType === "PERCENT"
                    ? `${p.discountPercent || 0}%`
                    : p.discountType === "FIXED"
                      ? formatCopFromCents(p.discountValueInCents || 0)
                      : "—"}
                </strong>
              </div>
              <div>
                <span>Variantes</span>
                <strong>{(p.variants || []).length ? `${(p.variants || []).length}` : "—"}</strong>
              </div>
              <div>
                <span>Recurrencia</span>
                <strong>
                  {p.intervalUnit ? `${p.intervalCount || 1} ${String(p.intervalUnit).toLowerCase()}` : "—"}
                </strong>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 ? <div className="contact-empty">Sin productos/servicios.</div> : null}
      </div>

      {planModalOpen && planModalProduct ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 980 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear plan o suscripción</strong>
              <button className="ghost modal-close" type="button" onClick={closePlanModal} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <NewBillingAssignmentForm
              customers={customers}
              catalogItems={items}
              checkoutTemplates={checkoutTemplates}
              csrfToken={csrfToken}
              tenantId={planModalProduct?.tenantId || ""}
              tenants={tenants}
              defaultOpen
              forceOpen
              hideHeader
              returnTo={returnTo || "/products"}
              defaultSelectedProductId={String(planModalProduct.id)}
              createCustomer={createCustomer}
              createPlanAndSubscription={createPlanAndSubscription}
            />
          </div>
        </div>
      ) : null}

      {sendOpen && sendProduct ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(980px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Enviar producto</strong>
              <button className="ghost modal-close" type="button" onClick={closeSendModal} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form action={sendProductToCustomer} className="send-product-grid">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="productId" value={sendProduct.id} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

              <div className="send-product-left">
                <div className="send-product-card">
                  <div className="send-product-header">
                    <div className="product-thumb">
                      {sendProduct.imageUrl ? <img src={sendProduct.imageUrl} alt={sendProduct.name} /> : <span>📦</span>}
                    </div>
                    <div>
                      <div className="send-product-name">{sendProduct.name}</div>
                      <div className="send-product-meta">
                        <span>{sendProduct.kind === "SERVICE" ? "Servicio" : "Producto"}</span>
                        <span>·</span>
                        <span>{formatCopFromCents(sendProduct.basePriceInCents)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="send-product-media">
                    <div className={`send-product-media-thumb ${isPublicImage(sendProduct.imageUrl) ? "" : "is-muted"}`}>
                      {isPublicImage(sendProduct.imageUrl) ? (
                        <img src={sendProduct.imageUrl || ""} alt="Imagen del producto" />
                      ) : (
                        <span>🖼️</span>
                      )}
                    </div>
                    <div className="send-product-media-info">
                      <div className="send-product-media-title">Imagen del producto</div>
                      <div className="send-product-media-meta">
                        {isPublicImage(sendProduct.imageUrl) ? (
                          <>
                            <span className="pill pill-ok">Lista para WhatsApp</span>
                            <span>URL pública detectada</span>
                            {sendProduct.imageUrl ? (
                              <a className="btnLink btn-open" href={sendProduct.imageUrl} target="_blank" rel="noreferrer">
                                Ver imagen
                              </a>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="pill pill-warn">No disponible</span>
                            <span>Configura una URL https en el producto</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="field">
                  <label>Buscar contacto</label>
                  <input
                    className="input"
                    type="search"
                    placeholder="Nombre, email o teléfono"
                    value={sendSearch}
                    onChange={(e) => {
                      setSendSearch(e.target.value);
                    }}
                  />
                  {!selectedCustomer && !searchActive ? (
                    <div className="field-hint">Escribe al menos 2 caracteres para buscar rápido.</div>
                  ) : null}
                  {selectedCustomer ? (
                    <div className="send-selected-card">
                      <div>
                        <div className="send-selected-name">{formatCustomerLabel(selectedCustomer)}</div>
                        <div className="send-selected-meta">{formatCustomerMeta(selectedCustomer) || "Sin contacto adicional"}</div>
                      </div>
                      <button
                        type="button"
                        className="ghost btn-compact"
                        onClick={() => {
                          setSendSearch("");
                        }}
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : null}
                  {searchActive ? (
                    <div className="send-search-results">
                      <div className="send-search-heading">
                        {searchResults.length
                          ? searchTotal > searchResults.length
                            ? `Resultados rápidos (${searchResults.length} de ${searchTotal})`
                            : `Resultados rápidos (${searchResults.length})`
                          : "Sin coincidencias"}
                      </div>
                      {searchResults.length ? (
                        <div className="send-search-list">
                          {searchResults.map((row: any) => {
                            const c = row.item;
                            const isSelected = String(c.id) === String(sendCustomerId);
                            return (
                              <button
                                key={c.id}
                                className={`send-search-item ${isSelected ? "is-selected" : ""}`}
                                type="button"
                                onClick={() => pickCustomer(c)}
                              >
                                <span className="send-search-name">{formatCustomerLabel(c)}</span>
                                <span className="send-search-meta">{formatCustomerMeta(c) || "Sin contacto adicional"}</span>
                                <div className="send-search-tags">
                                  {row.reason ? <span className="pill pill-soft">{row.reason}</span> : null}
                                  {isSelected ? <span className="pill pill-ok">Seleccionado</span> : <span className="pill">Elegir</span>}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                    <span>Contacto destino</span>
                    {selectedCustomer ? (
                      <button
                        type="button"
                        className="ghost btn-compact"
                        onClick={() => {
                          setSendCustomerId("");
                          setSendSearch("");
                        }}
                      >
                        Limpiar
                      </button>
                    ) : null}
                  </label>
                  <select
                    className="select"
                    name="customerId"
                    value={sendCustomerId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSendCustomerId(nextId);
                      const found = filteredCustomers.find((c: any) => String(c?.id) === String(nextId));
                      if (found) {
                        setSendSearch(formatCustomerLabel(found));
                      }
                    }}
                  >
                    <option value="">Selecciona un contacto…</option>
                    {filteredCustomers.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {formatCustomerLabel(c)}
                      </option>
                    ))}
                  </select>
                  {selectedCustomer ? (
                    <div className="field-hint">
                      <span>Seleccionado: {formatCustomerLabel(selectedCustomer)}</span>
                      {formatCustomerMeta(selectedCustomer) ? <span> · {formatCustomerMeta(selectedCustomer)}</span> : null}
                    </div>
                  ) : null}
                </div>

                <div className="field">
                  <label style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span>Opciones</span>
                    <label className="check-pill">
                      <input
                        type="checkbox"
                        name="includePaymentLink"
                        checked={sendIncludeLink}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setSendIncludeLink(next);
                          if (!messageDirty && sendProduct) setSendMessage(buildSendTemplate(sendProduct, next, sendIncludeImage));
                        }}
                      />
                      <span>Incluir link de pago</span>
                    </label>
                    <label className="check-pill">
                      <input
                        type="checkbox"
                        name="includeImage"
                        checked={sendIncludeImage}
                        disabled={!isPublicImage(sendProduct.imageUrl)}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setSendIncludeImage(next);
                          if (!messageDirty && sendProduct) setSendMessage(buildSendTemplate(sendProduct, sendIncludeLink, next));
                        }}
                      />
                      <span>Agregar imagen</span>
                    </label>
                  </label>
                  <div className="field-hint">
                    {isPublicImage(sendProduct.imageUrl)
                      ? "La imagen se envía como adjunto público al canal del cliente."
                      : "La imagen debe ser una URL https pública para poder enviarse."}
                  </div>
                </div>
                <div className="field">
                  <label>Canal Chatwoot</label>
                  <select
                    className="select"
                    name="inboxId"
                    value={sendInboxId}
                    onChange={(e) => setSendInboxId(e.target.value)}
                  >
                    <option value="">Automático según contacto</option>
                    {sortedInboxes.length ? (
                      sortedInboxes.map((inbox) => (
                        <option key={inbox.id} value={inbox.id}>
                          {formatInboxLabel(inbox)}
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>
                        No hay inboxes disponibles
                      </option>
                    )}
                  </select>
                  <div className="field-hint">
                    {sendInboxId
                      ? `Se usará el inbox seleccionado (${selectedInboxChannelLabel || "canal configurado"}).`
                      : "Se selecciona el inbox configurado o el mejor canal disponible."}
                    {selectedInboxIsWhatsapp ? (
                      <span> · WhatsApp: se recomienda plantilla y adjunto público.</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="send-product-right">
                <div className="send-product-summary">
                  <div className="send-summary-row">
                    <span>Adjuntos</span>
                    {sendImageReady ? <span className="pill pill-ok">Imagen lista</span> : <span className="pill pill-soft">Sin imagen</span>}
                  </div>
                  <div className="send-summary-row">
                    <span>Link de pago</span>
                    {sendIncludeLink ? <span className="pill pill-ok">Incluido</span> : <span className="pill pill-soft">No incluido</span>}
                  </div>
                  <div className="send-summary-row">
                    <span>Inbox</span>
                    <span className="send-summary-value">{selectedInbox ? formatInboxLabel(selectedInbox) : "Automático"}</span>
                  </div>
                  <div className="send-summary-row">
                    <span>Canal</span>
                    {selectedInboxChannelLabel ? (
                      <span className="pill pill-soft">{selectedInboxChannelLabel}</span>
                    ) : (
                      <span className="send-summary-value">Automático</span>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label>Mensaje para el cliente</label>
                  <textarea
                    className="input"
                    name="message"
                    rows={13}
                    value={sendMessage}
                    onChange={(e) => {
                      setSendMessage(e.target.value);
                      setMessageDirty(true);
                    }}
                  />
                  <div className="field-hint">
                    Variables disponibles: <strong>{"{{cliente}}"}</strong>, <strong>{"{{producto}}"}</strong>, <strong>{"{{precio}}"}</strong>, <strong>{"{{descripcion}}"}</strong>, <strong>{"{{imagen}}"}</strong>, <strong>{"{{link}}"}</strong>.
                  </div>
                </div>
                <div className="send-product-actions">
                  <button className="primary btn-send" type="submit" disabled={!sendCustomerId || !sendMessage.trim()}>
                    Enviar mensaje
                  </button>
                </div>
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
            aria-labelledby="product-edit-title"
            className="modal-panel"
            style={{ width: "min(980px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
            onKeyDown={onModalKeyDown}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="product-edit-title" style={{ margin: 0 }}>{modalTitle}</h3>
              <button type="button" className="ghost modal-close" onClick={closeEditor} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>

            <form action={updateProduct} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="currency" value="COP" />
              <input type="hidden" name="tenantId" value={editing.tenantId || ""} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              {selectedTenantIds.map((id) => (
                <input key={id} type="hidden" name="tenantIds" value={id} />
              ))}
              <input type="hidden" name="imageUrl" value={imageUrl} />
              <input type="hidden" name="intervalUnit" value={intervalUnit} />
              <input type="hidden" name="intervalCount" value={intervalCount} />

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>¿Es producto o servicio?</span>
                  <HelpTip text="Producto permite variantes y envío. Servicio no requiere envío." />
                </label>
                <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                  <option value="PRODUCT">Producto</option>
                  <option value="SERVICE">Servicio</option>
                </select>
              </div>
              <div className="field">
                <label>Tipo de cobro</label>
                <select className="select" name="collectionMode" value={collectionMode} onChange={(e) => setCollectionMode(e.target.value as any)}>
                  <option value="AUTO_LINK">Plan (link de pago)</option>
                  <option value="AUTO_DEBIT">Suscripción (tokenización)</option>
                </select>
                <div className="field-hint">Define si este producto se cobra por link o por tokenización.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Referencia / SKU</span>
                    <HelpTip text="Código único para identificar el ítem." />
                  </label>
                  <input className="input" name="sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
                </div>
              </div>
              {tenants.length > 0 ? (
                <div className="field">
                  <label>Canal(es)</label>
                  <select
                    className="select"
                    multiple
                    value={selectedTenantIds}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                      setSelectedTenantIds(values);
                    }}
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <div className="field-hint">Puedes seleccionar uno o varios canales.</div>
                </div>
              ) : null}

              <div className="field">
                <label>Descripción</label>
                <textarea className="input" name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
                <div className="field">
                  <label>Imagen (URL pública)</label>
                  <div className="image-url-row">
                    <input
                      className="input"
                      placeholder="https://..."
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      onBlur={(e) => applyImageUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyImageUrl(e.currentTarget.value);
                        }
                      }}
                    />
                    <button type="button" className="ghost" onClick={() => applyImageUrl()} disabled={!isPublicImage(imageUrlInput)}>
                      Usar URL
                    </button>
                  </div>
                  <div className="field-hint">Puedes pegar URLs de Shopify, WooCommerce, VTEX, Tiendanube, Exito, Falabella, Magento o Prestashop.</div>
                  {!isPublicImage(imageUrl) && imageUrl ? (
                    <div className="field-hint" style={{ color: "var(--status-warning)" }}>
                      La imagen actual es un archivo interno; para WhatsApp usa una URL pública.
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label>Subir archivo (opcional)</label>
                  <div className="file-row">
                    <input type="file" accept="image/*" onChange={onImageFile} />
                    {imageUrl ? <img src={imageUrl} alt="Producto" className="logo-preview" /> : null}
                    {imageUrl ? (
                      <button type="button" className="ghost" onClick={() => { setImageUrl(""); setImageUrlInput(""); }}>
                        Quitar
                      </button>
                    ) : null}
                  </div>
                  {imageUploading ? <div className="field-hint">Subiendo imagen…</div> : null}
                  {imageError ? <div className="field-hint" style={{ color: "var(--status-warning)" }}>{imageError}</div> : null}
                </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Marca / Proveedor</label>
                  <input className="input" name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
                </div>
                <div className="field">
                  <label>Categoría</label>
                  <input className="input" name="productType" value={productType} onChange={(e) => setProductType(e.target.value)} />
                </div>
                <div className="field">
                  <label>Etiquetas</label>
                  <input className="input" name="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Unidad de recurrencia</span>
                    <HelpTip text="Cada cuánto se cobra este plan/producto." />
                  </label>
                  <select className="select" value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as any)}>
                    <option value="DAY">Día</option>
                    <option value="WEEK">Semana</option>
                    <option value="MONTH">Mes</option>
                    <option value="CUSTOM">Personalizado</option>
                  </select>
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Cada</span>
                    <HelpTip text="Cantidad de unidades entre cobros." />
                  </label>
                  <input className="input" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} inputMode="numeric" />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Unidad</span>
                    <HelpTip text="Unidad de medida interna. Ej: UND, MES, HORA." />
                  </label>
                  <input className="input" name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Precio</span>
                    <HelpTip text="Precio base antes de impuestos/descuentos." />
                  </label>
                  <input
                    className="input"
                    name="basePricePesos"
                    inputMode="numeric"
                    value={priceCop}
                    onChange={(e) => setPriceCop(formatCopCurrency(e.target.value))}
                    required
                  />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{kind === "PRODUCT" ? "Requiere envío" : "Requiere envío (no aplica a servicios)"}</span>
                    <HelpTip text="Actívalo solo si el producto necesita logística de envío." />
                  </label>
                  <select
                    className="select"
                    name="requiresShipping"
                    value={requiresShipping ? "on" : ""}
                    onChange={(e) => setRequiresShipping(e.target.value === "on")}
                    disabled={kind === "SERVICE"}
                  >
                    <option value="">No</option>
                    <option value="on">Sí</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Impuesto</span>
                    <HelpTip text="Se aplica sobre el precio base." />
                  </label>
                  <select className="select" name="taxPercent" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)}>
                    <option value="0">Sin impuesto</option>
                    <option value="19">IVA 19%</option>
                    <option value="8">Consumo 8%</option>
                  </select>
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Descuento</span>
                    <HelpTip text="Elige si el descuento es fijo o porcentual." />
                  </label>
                  <select className="select" name="discountType" value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}>
                    <option value="NONE">Sin descuento</option>
                    <option value="FIXED">Valor fijo</option>
                    <option value="PERCENT">Porcentaje</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Descuento (valor)</span>
                    <HelpTip text="Valor fijo en COP." />
                  </label>
                  <input
                    className="input"
                    name="discountValuePesos"
                    placeholder="$ 0"
                    inputMode="numeric"
                    value={discountCop}
                    onChange={(e) => setDiscountCop(formatCopCurrency(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Descuento (%)</span>
                    <HelpTip text="Porcentaje entre 0 y 100." />
                  </label>
                  <input className="input" name="discountPercent" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} inputMode="numeric" />
                </div>
              </div>

              <input type="hidden" name="taxable" value="on" />

              {kind === "PRODUCT" ? (
                <>
                  <div className="field">
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Variantes</span>
                      <HelpTip text="Define opciones (ej: talla/color) y luego las combinaciones." />
                    </label>
                    <select
                      className="select"
                      value={variantOptionsCount}
                      onChange={(e) => setVariantOptionsCount(Number(e.target.value) as any)}
                    >
                      <option value={0}>Sin variantes</option>
                      <option value={1}>1 opción</option>
                      <option value={2}>2 opciones</option>
                    </select>
                  </div>

                  {showVariants ? (
                    <div style={{ display: "grid", gridTemplateColumns: showOption2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                      <div className="field">
                        <label>{showOption2 ? "Opción 1" : "Nombre de opción"}</label>
                        <input className="input" name="option1Name" value={option1Name} onChange={(e) => setOption1Name(e.target.value)} />
                      </div>
                      {showOption2 ? (
                        <div className="field">
                          <label>Opción 2</label>
                          <input className="input" name="option2Name" value={option2Name} onChange={(e) => setOption2Name(e.target.value)} />
                        </div>
                      ) : (
                        <input type="hidden" name="option2Name" value="" />
                      )}
                    </div>
                  ) : (
                    <>
                      <input type="hidden" name="option1Name" value="" />
                      <input type="hidden" name="option2Name" value="" />
                    </>
                  )}

                  {showVariants ? (
                    <VariantsEditor
                      option1Name={option1Name || "Opción 1"}
                      option2Name={option2Name || "Opción 2"}
                      showOption2={showOption2}
                      disabled={!option1Name || (showOption2 && !option2Name)}
                      initialJson={variantsJson}
                      resetKey={editing.id}
                      onJsonChange={(json) => setVariantsJson(json)}
                    />
                  ) : (
                    <input type="hidden" name="variantsJson" value="[]" />
                  )}
                </>
              ) : (
                <>
                  <input type="hidden" name="requiresShipping" value="" />
                  <input type="hidden" name="option1Name" value="" />
                  <input type="hidden" name="option2Name" value="" />
                  <input type="hidden" name="variantsJson" value="[]" />
                </>
              )}

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="primary btn-save" type="submit">
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {txOpen && txProduct ? (
        <div className="modal-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-tx-title"
            className="modal-panel"
            style={{ width: "min(900px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="product-tx-title" style={{ margin: 0 }}>
                Transacciones: {txProduct.name}
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
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Contacto</th>
                      <th>Referencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txItems.map((t) => (
                      <tr key={t.id}>
                        <td><LocalDateTime value={t.createdAt} /></td>
                        <td>{formatCopFromCents(t.amountInCents)}</td>
                        <td>{t.status}</td>
                        <td>{t.customerName || "—"}</td>
                        <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{t.reference || "—"}</td>
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
