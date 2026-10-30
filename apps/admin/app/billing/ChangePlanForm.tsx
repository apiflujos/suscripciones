"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { AppModal } from "../ui/AppModal";

export type PlanOption = {
  id: string;
  name: string;
  sku: string;
  searchText: string;
  collectionMode: string;
  priceInCents: number;
  currency: string;
  kind: "PRODUCT" | "SERVICE";
  requiresShipping: boolean;
  shippingInCents: number;
};

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function centsToCurrencyInput(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(major) || major <= 0) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(major);
}

function currencyInputToCents(input: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value) * 100;
}

function formatCurrencyInput(input: string, currency: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function productRequiresShipping(product: PlanOption | null | undefined) {
  if (!product) return false;
  const kind = String(product.kind || "").toUpperCase();
  return kind !== "SERVICE";
}

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

export function mapPlanFromApi(p: any): PlanOption {
  const metadata = p?.metadata && typeof p.metadata === "object" ? p.metadata : {};
  const catalog = metadata?.catalog && typeof metadata.catalog === "object" ? metadata.catalog : {};
  const pricing = readPlanPricing(metadata);
  const kindRaw = String(p?.kind || catalog?.kind || "").toUpperCase();
  const kind = kindRaw === "SERVICE" ? "SERVICE" : "PRODUCT";
  const requiresShippingRaw = p?.requiresShipping ?? catalog?.requiresShipping;
  return {
    id: String(p?.id || ""),
    name: String(metadata?.displayName || p?.name || "Producto"),
    sku: String(p?.sku || metadata?.sku || ""),
    searchText: [metadata?.displayName, p?.name, p?.sku, metadata?.sku, catalog?.name, p?.id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    collectionMode: String(p?.collectionMode || metadata?.collectionMode || ""),
    priceInCents: Number(p?.priceInCents || p?.basePriceInCents || 0),
    currency: String(p?.currency || "COP"),
    kind,
    requiresShipping: kind === "PRODUCT" && (requiresShippingRaw === true || requiresShippingRaw == null),
    shippingInCents: Number(p?.shippingInCents || pricing?.shippingInCents || 0)
  };
}

export function ChangePlanButton({
  subscriptionId,
  currentPlanId,
  currentChargeAt,
  currentShippingInCents = 0,
  currentRequiresShipping = false,
  currentPlanName = "Producto actual",
  currentPlanCurrency = "COP",
  plans,
  csrfToken,
  returnTo,
  tenantId,
  action,
  iconOnly = false
}: {
  subscriptionId: string;
  currentPlanId: string;
  currentChargeAt?: string | null;
  currentShippingInCents?: number;
  currentRequiresShipping?: boolean;
  currentPlanName?: string;
  currentPlanCurrency?: string;
  plans: PlanOption[];
  csrfToken: string;
  returnTo: string;
  tenantId?: string;
  action: (formData: FormData) => void;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const initialChargeDate = useMemo(() => toLocalInput(currentChargeAt), [currentChargeAt]);
  const [productId, setProductId] = useState(currentPlanId);
  const [chargeDate, setChargeDate] = useState(initialChargeDate);
  const [query, setQuery] = useState("");
  const [shippingCop, setShippingCop] = useState(centsToCurrencyInput(currentShippingInCents || 0, "COP"));
  const [freeShipping, setFreeShipping] = useState(Boolean(currentRequiresShipping) && Number(currentShippingInCents || 0) <= 0);
  const [remoteProducts, setRemoteProducts] = useState<PlanOption[]>([]);
  const [searching, setSearching] = useState(false);
  const appliedDefaultsPlanIdRef = useRef<string>("");
  const currentProductFallback = useMemo<PlanOption>(
    () => ({
      id: currentPlanId,
      name: currentPlanName || "Producto actual",
      sku: "",
      searchText: "",
      collectionMode: "",
      priceInCents: 0,
      currency: currentPlanCurrency || "COP",
      kind: currentRequiresShipping ? "PRODUCT" : "SERVICE",
      requiresShipping: currentRequiresShipping,
      shippingInCents: Number(currentShippingInCents || 0)
    }),
    [currentPlanId, currentPlanName, currentPlanCurrency, currentRequiresShipping, currentShippingInCents]
  );

  useEffect(() => {
    if (!open) return;
    setProductId(currentPlanId);
    setChargeDate(initialChargeDate);
    setQuery("");
    setShippingCop(centsToCurrencyInput(currentShippingInCents || 0, currentPlanCurrency || "COP"));
    setFreeShipping(Boolean(currentRequiresShipping) && Number(currentShippingInCents || 0) <= 0);
    appliedDefaultsPlanIdRef.current = String(currentPlanId || "");
  }, [open, currentPlanId, initialChargeDate, currentShippingInCents, currentRequiresShipping, currentPlanCurrency]);

  const localFilteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => {
      const name = String(p.name || "").toLowerCase();
      const id = String(p.id || "").toLowerCase();
      const sku = String(p.sku || "").toLowerCase();
      const search = String(p.searchText || "").toLowerCase();
      return name.includes(q) || id.includes(q) || sku.includes(q) || search.includes(q);
    });
  }, [plans, query]);

  const fetchProducts = useCallback(
    async (qRaw: string) => {
      const q = String(qRaw || "").trim();
      setSearching(true);
      try {
        const fetchBatch = async (opts: { scopedTenant: boolean }) => {
          const qs = new URLSearchParams();
          qs.set("take", "2000");
          if (q) qs.set("q", q);
          if (tenantId && opts.scopedTenant) qs.set("tenantId", tenantId);
          qs.set("_ts", String(Date.now()));
          const res = await fetch(`/api/search/products?${qs.toString()}`, { cache: "no-store" });
          if (!res.ok) return [] as any[];
          const json = await res.json().catch(() => null);
          return Array.isArray(json?.items) ? json.items : [];
        };

        const scopedItems = await fetchBatch({ scopedTenant: true });
        const shouldTryGlobal = Boolean(tenantId) && scopedItems.length <= 1;
        const globalItems = shouldTryGlobal ? await fetchBatch({ scopedTenant: false }) : [];
        const merged = new Map<string, PlanOption>();
        for (const item of [...scopedItems, ...globalItems]) {
          const mapped = mapPlanFromApi(item);
          if (mapped?.id) merged.set(mapped.id, mapped);
        }
        setRemoteProducts(Array.from(merged.values()));
      } catch {
        setRemoteProducts([]);
      } finally {
        setSearching(false);
      }
    },
    [tenantId]
  );

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    const timer = setTimeout(async () => {
      if (canceled) return;
      await fetchProducts(query);
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [open, query, fetchProducts]);

  useEffect(() => {
    if (!open) return;
    const onFocus = () => {
      void fetchProducts(query);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [open, query, fetchProducts]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      void fetchProducts(query);
    }, 15000);
    return () => {
      clearInterval(timer);
    };
  }, [open, query, fetchProducts]);

  const filteredProducts = useMemo(() => {
    const merged = new Map<string, PlanOption>();
    const current = plans.find((p) => p.id === currentPlanId) || remoteProducts.find((p) => p.id === currentPlanId) || currentProductFallback;
    if (current) merged.set(current.id, current);
    for (const p of localFilteredProducts) merged.set(p.id, p);
    for (const p of remoteProducts) merged.set(p.id, p);
    if (productId && !merged.has(productId)) merged.set(productId, currentProductFallback);
    return Array.from(merged.values());
  }, [remoteProducts, localFilteredProducts, plans, currentPlanId, productId, currentProductFallback]);

  const selectedProduct = useMemo(() => {
    return filteredProducts.find((p) => String(p.id) === String(productId)) || plans.find((p) => String(p.id) === String(productId)) || null;
  }, [filteredProducts, plans, productId]);
  const selectedRequiresShipping = productRequiresShipping(selectedProduct);
  const currentShippingComparable = currentRequiresShipping ? Number(currentShippingInCents || 0) : 0;
  const selectedShippingInCents = selectedRequiresShipping ? (freeShipping ? 0 : currencyInputToCents(shippingCop)) : 0;
  const shippingChanged = selectedRequiresShipping && selectedShippingInCents !== currentShippingComparable;
  const hasChange = Boolean(
    productId &&
      (productId !== currentPlanId || chargeDate !== initialChargeDate || shippingChanged)
  );

  useEffect(() => {
    const current = String(productId || "");
    if (!current || appliedDefaultsPlanIdRef.current === current) return;
    const product = plans.find((p) => String(p.id) === current) || remoteProducts.find((p) => String(p.id) === current);
    if (!product) return;
    const requires = productRequiresShipping(product);
    if (!requires) {
      setFreeShipping(false);
      setShippingCop("");
    } else {
      const nextShipping = Number(product.shippingInCents || 0);
      setFreeShipping(nextShipping <= 0);
      setShippingCop(centsToCurrencyInput(nextShipping, String(product.currency || "COP")));
    }
    appliedDefaultsPlanIdRef.current = current;
  }, [productId, plans, remoteProducts]);

  return (
    <>
      <button
        className={`ghost btn-compact btn-blue ${iconOnly ? "btn-icon-only btn-edit" : "btn-noicon"}`}
        type="button"
        data-loader="off"
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? "Editar producto, flete y fecha de pago" : undefined}
        title={iconOnly ? "Editar producto, flete y fecha de pago" : undefined}
      >
        {iconOnly ? null : "Cambiar producto"}
      </button>

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title="Cambiar producto de la suscripción"
        width="min(560px, 96vw)"
        bodyClassName=""
      >
        <form action={action} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <input type="hidden" name="productId" value={productId} />

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Nuevo producto</span>
                  <HelpTip text="Puedes elegir cualquier producto existente o crear uno nuevo en Productos." />
                </label>
                <input
                  className="input"
                  type="search"
                  placeholder="Buscar producto..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                {searching ? <div className="field-hint">Buscando productos...</div> : null}
                {filteredProducts.length ? (
                  <div className="plan-option-list">
                    {filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`ghost btn-compact btn-noicon plan-option-item${String(productId) === String(p.id) ? " is-selected" : ""}`}
                        onClick={() => setProductId(String(p.id))}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!filteredProducts.length ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    No hay resultados con esa búsqueda.
                  </div>
                ) : null}
                {!hasChange ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Debes hacer al menos un cambio para guardar.
                  </div>
                ) : null}
                <div className="field-hint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>Si necesitas otro producto, créalo aquí mismo.</span>
                  <a
                    href="/products"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}
                  >
                    Crear producto
                  </a>
                </div>
              </div>

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Nueva fecha de pago</span>
                  <HelpTip text="Esta fecha define el próximo cobro y el ciclo de facturación." />
                </label>
                <input
                  className="input"
                  type="datetime-local"
                  name="chargeDate"
                  value={chargeDate}
                  onChange={(e) => setChargeDate(e.target.value)}
                  required
                />
              </div>

              {selectedRequiresShipping ? (
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Flete para esta suscripción</span>
                    <HelpTip text="Este valor queda solo para esta suscripción." />
                  </label>
                  <input
                    className="input shipping-currency-input"
                    name="shippingPesos"
                    inputMode="numeric"
                    value={shippingCop}
                    onChange={(e) => setShippingCop(formatCurrencyInput(e.target.value, String(selectedProduct?.currency || "COP")))}
                    disabled={freeShipping}
                    placeholder="$ 0"
                    required={!freeShipping}
                  />
                  <div className="field-hint">Moneda: {String(selectedProduct?.currency || "COP")}</div>
                  <label className="field-hint" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={freeShipping}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFreeShipping(checked);
                        if (checked) setShippingCop("");
                      }}
                    />
                    Envío gratis
                  </label>
                  <input type="hidden" name="freeShipping" value={freeShipping ? "1" : "0"} />
                </div>
              ) : (
                <>
                  <input type="hidden" name="shippingPesos" value="0" />
                  <input type="hidden" name="freeShipping" value="0" />
                </>
              )}

              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  data-loader="off" 
                  onClick={() => setOpen(false)}
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit" 
                  pendingText="Guardando..." 
                  disabled={!hasChange || !chargeDate}
                  title="Guardar cambios del producto"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
        </form>
      </AppModal>
    </>
  );
}
