"use client";

import { useEffect, useMemo, useState } from "react";
import { NewCustomerForm } from "../customers/NewCustomerForm";
import { enterToNextField } from "../lib/enterToNext";

type Customer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: any;
};

type EmpresaContact = {
  id: string;
  nombre: string;
  cargo: string;
  email?: string | null;
  telefono?: string | null;
};

type Empresa = {
  id: string;
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  sitioWeb?: string | null;
  contactoPrincipal?: EmpresaContact | null;
};

type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  requiresShipping?: boolean;
  currency: string;
  basePriceInCents: number;
  intervalUnit?: "DAY" | "WEEK" | "MONTH" | "CUSTOM";
  intervalCount?: number;
  taxPercent?: number;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
};

type BillingType = "PLAN" | "SUBSCRIPCION";


function fmtMoneyFromCents(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

function formatCurrencyInput(input: string, currency: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function NewBillingAssignmentForm({
  customers,
  empresas,
  catalogItems,
  csrfToken,
  tenantId,
  tenants,
  defaultOpen = false,
  forceOpen = false,
  hideHeader = false,
  returnTo = "/billing",
  defaultSelectedProductId = "",
  defaultSelectedCustomerId = "",
  defaultBillingType = "SUBSCRIPCION",
  defaultExistingPaymentId = "",
  createCustomer,
  createPlanAndSubscription
}: {
  customers: Customer[];
  empresas: Empresa[];
  catalogItems: CatalogItem[];
  csrfToken: string;
  tenantId?: string;
  tenants: Array<{ id: string; name: string }>;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  hideHeader?: boolean;
  returnTo?: string;
  defaultSelectedProductId?: string;
  defaultSelectedCustomerId?: string;
  defaultBillingType?: BillingType;
  defaultExistingPaymentId?: string;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen || forceOpen));
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const [productQ, setProductQ] = useState("");
  const [productId, setProductId] = useState(defaultSelectedProductId || "");
  const [productHits, setProductHits] = useState<CatalogItem[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [productSearchError, setProductSearchError] = useState("");

  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState(defaultSelectedCustomerId || "");
  const [customerHits, setCustomerHits] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [selectedCustomerOverride, setSelectedCustomerOverride] = useState<Customer | null>(null);
  const [selectedEmpresaId, setSelectedEmpresaId] = useState("");

  const [billingType, setBillingType] = useState<BillingType>(defaultBillingType === "PLAN" ? "PLAN" : "SUBSCRIPCION");
  const option1Value = "";
  const option2Value = "";
  const [shippingCop, setShippingCop] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [duplicateChecking, setDuplicateChecking] = useState(false);

  const [startAtIso, setStartAtIso] = useState("");
  const [cutoffAtIso, setCutoffAtIso] = useState("");

  const selectedProduct = useMemo(() => {
    if (!productId) return null;
    return catalogItems.find((p) => String(p.id) === String(productId)) || productHits.find((p) => String(p.id) === String(productId)) || null;
  }, [catalogItems, productHits, productId]);

  useEffect(() => {
    setShippingCop("");
  }, [productId]);

  useEffect(() => {
    setAllowDuplicate(false);
  }, [customerId, productId, billingType]);

  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState<number>(1);

  useEffect(() => {
    if (!defaultSelectedProductId) return;
    if (productId && String(productId) === String(defaultSelectedProductId)) return;
    setProductId(defaultSelectedProductId);
    const found = catalogItems.find((p) => String(p.id) === String(defaultSelectedProductId));
    if (found) setProductQ(String(found.name || ""));
  }, [defaultSelectedProductId, catalogItems, productId]);

  useEffect(() => {
    setBillingType(defaultBillingType === "PLAN" ? "PLAN" : "SUBSCRIPCION");
  }, [defaultBillingType]);

  const selectedCustomer = useMemo(() => {
    if (!customerId) return null;
    if (selectedCustomerOverride && String(selectedCustomerOverride.id) === String(customerId)) return selectedCustomerOverride;
    return (
      customers.find((c) => String(c.id) === String(customerId)) ||
      customerHits.find((c) => String(c.id) === String(customerId)) ||
      null
    );
  }, [customers, customerHits, customerId, selectedCustomerOverride]);

  const selectedEmpresa = useMemo(() => {
    if (!selectedEmpresaId) return null;
    return empresas.find((e) => String(e.id) === String(selectedEmpresaId)) || null;
  }, [empresas, selectedEmpresaId]);

  const selectedContactFromEmpresa = selectedEmpresa?.contactoPrincipal || null;

  const hasToken = useMemo(() => {
    const meta = selectedCustomer?.metadata ?? {};
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
  }, [selectedCustomer]);

  // Variantes y fechas simplificadas en este flujo.



  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(tenantId ? [tenantId] : []);

  const filteredProducts = useMemo(() => {
    const q = productQ.trim().toLowerCase();
    if (q.length >= 2) {
      const list = productHits.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      return list.slice(0, 200);
    }
    const list = catalogItems.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    if (!q) return list.slice(0, 200);
    return list
      .filter((p) => `${p.sku || ""} ${p.name || ""} ${p.id}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [catalogItems, productHits, productQ]);

  const filteredCustomers = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    if (q.length >= 2) {
      const list = customerHits.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      return list.slice(0, 200);
    }

    const list = customers.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    if (!q) return list.slice(0, 200);
    return list
      .filter((c) => `${c.name || ""} ${c.email || ""} ${c.phone || ""} ${c.metadata?.identificacion || ""} ${c.id}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [customers, customerHits, customerQ]);

  const filteredEmpresas = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    const list = empresas.slice().sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    if (!q) return list.slice(0, 200);
    return list
      .filter((e) => `${e.nombre || ""} ${e.email || ""} ${e.telefono || ""}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [empresas, customerQ]);

  useEffect(() => {
    const q = productQ.trim();
    if (q.length < 2) {
      setProductHits([]);
      setProductSearching(false);
      setProductSearchError("");
      return;
    }

    const ac = new AbortController();
    setProductSearching(true);
    setProductSearchError("");
    const t = setTimeout(() => {
      fetch(`/api/search/products?${new URLSearchParams({ q, take: "80", ...(tenantId ? { tenantId } : {}) }).toString()}`, { cache: "no-store", signal: ac.signal })
        .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
        .then(({ ok, status, json }) => {
          if (!ok) {
            setProductHits([]);
            setProductSearchError(status === 401 ? "No autorizado (revisa el token del Admin)." : `Error buscando productos (${status}).`);
            return;
          }
          setProductHits(Array.isArray(json?.items) ? json.items : []);
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          setProductHits([]);
          setProductSearchError("Error de red buscando productos.");
        })
        .finally(() => {
          setProductSearching(false);
        });
    }, 260);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [productQ]);

  useEffect(() => {
    const q = customerQ.trim();
    if (q.length < 2) {
      setCustomerHits([]);
      setCustomerSearching(false);
      setCustomerSearchError("");
      return;
    }

    const ac = new AbortController();
    setCustomerSearching(true);
    setCustomerSearchError("");
    const t = setTimeout(() => {
      fetch(`/api/search/customers?${new URLSearchParams({ q, take: "80", ...(tenantId ? { tenantId } : {}) }).toString()}`, { cache: "no-store", signal: ac.signal })
        .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
        .then(({ ok, status, json }) => {
          if (!ok) {
            setCustomerHits([]);
            setCustomerSearchError(status === 401 ? "No autorizado (revisa el token del Admin)." : `Error buscando contactos (${status}).`);
            return;
          }
          const items = Array.isArray(json?.items) ? (json.items as Customer[]) : [];
          setCustomerHits(items);
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setCustomerHits([]);
          setCustomerSearchError("Error de red buscando contactos.");
        })
        .finally(() => {
          if (ac.signal.aborted) return;
          setCustomerSearching(false);
        });
    }, 250);

    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [customerQ]);

  useEffect(() => {
    if (!customerId || !productId || billingType !== "SUBSCRIPCION") {
      setDuplicateCount(0);
      setDuplicateChecking(false);
      return;
    }
    const ac = new AbortController();
    setDuplicateChecking(true);
    fetch(
      `/api/billing/duplicates?${new URLSearchParams({
        customerId: String(customerId),
        productId: String(productId),
        ...(tenantId ? { tenantId } : {})
      }).toString()}`,
      { cache: "no-store", signal: ac.signal }
    )
      .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!ok) {
          setDuplicateCount(0);
          return;
        }
        setDuplicateCount(Number(json?.duplicatesCount || 0));
      })
      .catch(() => {
        if (!ac.signal.aborted) setDuplicateCount(0);
      })
      .finally(() => {
        if (!ac.signal.aborted) setDuplicateChecking(false);
      });

    return () => ac.abort();
  }, [customerId, productId, billingType, tenantId]);

  const mustPickTenant = tenants.length > 0;
  const canSubmit = Boolean(
    productId &&
      (customerId || selectedEmpresaId) &&
      (!selectedEmpresaId || Boolean(selectedContactFromEmpresa)) &&
      (!mustPickTenant || selectedTenantIds.length > 0)
  );

  const isOpen = forceOpen ? true : open;

  return (
    <div className="panel module">
      {!hideHeader ? (
        <div className="panel-header ui-panel-header ui-panel-header-left">
          <div className="ui-panel-title">
            <h3 style={{ margin: 0 }}>Crear plan o suscripción para un contacto</h3>
            {!forceOpen ? (
              <button className={open ? "ghost btn-compact btn-cancel" : "primary btn-compact btn-subscription"} type="button" data-loader="off" onClick={() => setOpen((v) => !v)}>
                {open ? "Cerrar" : "Crear suscripción"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isOpen ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>1) Producto</h3>
            </div>

            {selectedProduct ? (
              <div className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "grid" }}>
                  <strong>{selectedProduct.name}</strong>
                  <span className="field-hint">
                    {selectedProduct.sku || "—"} · {selectedProduct.kind === "SERVICE" ? "Servicio" : "Producto"} · {fmtMoneyFromCents(selectedProduct.basePriceInCents, selectedProduct.currency)}
                  </span>
                </div>
                <button
                  className="ghost btn-compact btn-noicon"
                  type="button"
                  onClick={() => {
                    setProductId("");
                    setProductQ("");
                    setProductHits([]);
                  }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  className="input"
                  value={productQ}
                  onChange={(e) => setProductQ(e.target.value)}
                  placeholder="Buscar por nombre o SKU…"
                  aria-label="Buscar producto"
                />
                <div aria-live="polite">
                  {productSearching ? <div className="field-hint">Buscando…</div> : null}
                  {productSearchError ? <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)" }}>{productSearchError}</div> : null}
                </div>
                {filteredProducts.length > 0 ? (
                  <div className="customer-search-list">
                    {filteredProducts.slice(0, 8).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="ghost btn-compact btn-noicon product-search-item"
                        onClick={() => {
                          setProductId(String(p.id));
                          setProductQ(String(p.name || ""));
                        }}
                      >
                        {p.sku || "—"} · {p.name} · {p.kind === "SERVICE" ? "Servicio" : "Producto"} · {fmtMoneyFromCents(p.basePriceInCents, p.currency)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!productSearching && filteredProducts.length === 0 ? (
                  <div className="field-hint">
                    {productQ.trim().length >= 2 ? "Sin resultados. Prueba con otro término." : "No hay productos activos disponibles."}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>2) Contacto</h3>
                  <button className={showNewCustomer ? "ghost btn-compact btn-cancel" : "ghost btn-compact btn-contact"} type="button" onClick={() => setShowNewCustomer((v) => !v)}>
                    {showNewCustomer ? "Cerrar" : "Crear contacto"}
                  </button>
            </div>

            {selectedCustomer || selectedEmpresa ? (
              <div className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "grid" }}>
                  {selectedCustomer ? (
                    <>
                      <strong style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span>{selectedCustomer.name || selectedCustomer.email || selectedCustomer.id}</span>
                        {hasToken ? (
                          <span className="pill pill-ok">Tokenizada</span>
                        ) : (
                          <span className="pill pill-bad">Sin token</span>
                        )}
                      </strong>
                      <span className="field-hint">
                        {selectedCustomer.metadata?.identificacion || "—"}
                        {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                        {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
                      </span>
                    </>
                  ) : selectedEmpresa ? (
                    <>
                      <strong style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span>{selectedEmpresa.nombre}</span>
                        <span className="pill">Empresa</span>
                      </strong>
                      <span className="field-hint">
                        {selectedEmpresa.email ? `${selectedEmpresa.email} · ` : ""}
                        {selectedEmpresa.telefono || "Sin teléfono"}
                      </span>
                      <span className="field-hint">
                        Contacto principal:{" "}
                        {selectedContactFromEmpresa
                          ? `${selectedContactFromEmpresa.nombre} · ${selectedContactFromEmpresa.cargo}`
                          : "Sin contacto principal"}
                      </span>
                    </>
                  ) : null}
                </div>
                <button
                  className="ghost btn-compact btn-noicon"
                  type="button"
                  onClick={() => {
                    setCustomerId("");
                    setCustomerQ("");
                    setCustomerHits([]);
                    setSelectedCustomerOverride(null);
                    setSelectedEmpresaId("");
                  }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  className="input"
                  value={customerQ}
                  onChange={(e) => setCustomerQ(e.target.value)}
                  placeholder="Buscar contacto o empresa…"
                  aria-label="Buscar contacto o empresa"
                />
                <div aria-live="polite">
                  {customerSearching ? <div className="field-hint">Buscando…</div> : null}
                  {customerSearchError ? <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)" }}>{customerSearchError}</div> : null}
                </div>
                {filteredCustomers.length > 0 || filteredEmpresas.length > 0 ? (
                  <div className="customer-search-list">
                    {filteredCustomers.slice(0, 6).map((c) => (
                      <button
                        key={`customer-${c.id}`}
                        type="button"
                        className="ghost btn-compact btn-noicon customer-search-item"
                        onClick={() => {
                          setCustomerId(String(c.id));
                          setSelectedCustomerOverride(c);
                          setCustomerQ(String(c.name || c.email || ""));
                          setSelectedEmpresaId("");
                          setShowNewCustomer(false);
                        }}
                      >
                        {c.name || c.email || c.id} · {c.metadata?.identificacion || c.email || c.phone || "—"} ·{" "}
                        {(typeof c.metadata?.wompi?.paymentSourceId === "number" && Number.isFinite(c.metadata?.wompi?.paymentSourceId)) ||
                        (typeof c.metadata?.wompi?.paymentSourceId === "string" && /^\d+$/.test(c.metadata?.wompi?.paymentSourceId)) ||
                        (typeof c.metadata?.wompi?.payment_source_id === "string" && /^\d+$/.test(c.metadata?.wompi?.payment_source_id)) ||
                        (typeof c.metadata?.paymentSourceId === "string" && /^\d+$/.test(c.metadata?.paymentSourceId)) ||
                        (typeof c.metadata?.payment_source_id === "string" && /^\d+$/.test(c.metadata?.payment_source_id))
                          ? "Tokenizada"
                          : "Sin token"}
                      </button>
                    ))}
                    {filteredEmpresas.slice(0, 6).map((e) => (
                      <button
                        key={`empresa-${e.id}`}
                        type="button"
                        className="ghost btn-compact btn-noicon customer-search-item"
                        onClick={() => {
                          setSelectedEmpresaId(String(e.id));
                          setCustomerId("");
                          setSelectedCustomerOverride(null);
                          setCustomerQ(String(e.nombre || ""));
                          setShowNewCustomer(false);
                        }}
                      >
                        {e.nombre} · {e.email || e.telefono || "Sin contacto"} ·{" "}
                        {e.contactoPrincipal ? `${e.contactoPrincipal.nombre} · ${e.contactoPrincipal.cargo}` : "Sin contacto principal"}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!customerSearching && filteredCustomers.length === 0 && filteredEmpresas.length === 0 ? (
                  <div className="field-hint">
                    {customerQ.trim().length >= 2 ? "Sin resultados. Prueba con otro término." : "No hay contactos ni empresas disponibles."}
                  </div>
                ) : null}
              </div>
            )}

            {selectedEmpresa && !selectedContactFromEmpresa ? (
              <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)", marginTop: 8 }}>
                La empresa no tiene contacto principal. Asigna uno en Empresas para poder crear la suscripción.
              </div>
            ) : null}

            {showNewCustomer ? (
              forceOpen ? (
                <div className="card cardPad" style={{ marginTop: 8 }}>
                  <div className="panel-header ui-panel-header">
                    <strong>Crear contacto</strong>
                    <button className="ghost modal-close" type="button" onClick={() => setShowNewCustomer(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                      X
                    </button>
                  </div>
                  <NewCustomerForm
                    createCustomer={createCustomer}
                    defaultOpen
                    mode="always_open"
                    hidePanelHeader
                    useModal={false}
                    returnTo={`${returnTo}${returnTo.includes("?") ? "&" : "?"}crear=1`}
                    csrfToken={csrfToken}
                    tenantId={tenantId}
                    tenants={tenants}
                  />
                </div>
              ) : (
                <div className="modal-backdrop">
                  <div className="modal-panel ui-modal-panel-wide">
                    <div className="panel-header ui-panel-header">
                      <strong>Crear contacto</strong>
                      <button className="ghost modal-close" type="button" onClick={() => setShowNewCustomer(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                        X
                      </button>
                    </div>
                    <NewCustomerForm
                      createCustomer={createCustomer}
                      defaultOpen
                      mode="always_open"
                      hidePanelHeader
                      useModal={false}
                      returnTo={`${returnTo}${returnTo.includes("?") ? "&" : "?"}crear=1`}
                      csrfToken={csrfToken}
                      tenantId={tenantId}
                      tenants={tenants}
                    />
                  </div>
                </div>
              )
            ) : null}
          </div>

          <div className="panel module" style={{ margin: 0, opacity: canSubmit ? 1 : 0.6 }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>3) Tipo de suscripción</h3>
            </div>

            <form
              action={createPlanAndSubscription}
              onKeyDownCapture={enterToNextField}
              onSubmit={(e) => {
                if (billingType !== "SUBSCRIPCION") return;
                const form = e.currentTarget;
                const allowInput = form.querySelector('input[name="allowDuplicate"]') as HTMLInputElement | null;
                if (allowDuplicate || allowInput?.value === "1") return;
                if (duplicateCount <= 0) return;
                e.preventDefault();
                const ok = window.confirm(
                  `Este cliente ya tiene ${duplicateCount} suscripción(es) activa(s)/en mora/suspendida(s) para este mismo producto. ¿Deseas crear otra igual?`
                );
                if (!ok) return;
                if (allowInput) allowInput.value = "1";
                setAllowDuplicate(true);
                const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
                setTimeout(() => {
                  if (submitter && "click" in submitter) {
                    (submitter as HTMLButtonElement).click();
                  } else {
                    form.requestSubmit();
                  }
                }, 0);
              }}
              style={{ display: "grid", gap: 10 }}
            >
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="empresaId" value={selectedEmpresaId} />
              <input type="hidden" name="contactoId" value={selectedContactFromEmpresa?.id || ""} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="paymentId" value={defaultExistingPaymentId} />
              <input type="hidden" name="billingType" value={billingType} />
              <input type="hidden" name="allowDuplicate" value={allowDuplicate ? "1" : "0"} />
              {selectedTenantIds.map((id) => (
                <input key={id} type="hidden" name="tenantIds" value={id} />
              ))}
              <input type="hidden" name="intervalUnit" value={intervalUnit} />
              <input type="hidden" name="intervalCount" value={intervalCount} />
              <input type="hidden" name="option1Value" value={option1Value} />
              <input type="hidden" name="option2Value" value={option2Value} />
              <input type="hidden" name="startAt" value={startAtIso} />
              <input type="hidden" name="firstPeriodEndAt" value={cutoffAtIso} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label>Tipo</label>
                  <select
                    className="select"
                    value={billingType}
                    onChange={(e) => setBillingType(e.target.value === "PLAN" ? "PLAN" : "SUBSCRIPCION")}
                    disabled={!productId || !(customerId || selectedEmpresaId)}
                  >
                    <option value="SUBSCRIPCION">Débito automático</option>
                    <option value="PLAN">Link de pago</option>
                  </select>
                </div>
                <div className="field">
                  <label>Periodicidad</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      className="select"
                      value={intervalCount}
                      onChange={(e) => setIntervalCount(Number(e.target.value))}
                      disabled={!productId}
                    >
                      {[1, 2, 3, 6, 12].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <select
                      className="select"
                      value={intervalUnit}
                      onChange={(e) => setIntervalUnit(e.target.value as any)}
                      disabled={!productId}
                    >
                      <option value="DAY">día(s)</option>
                      <option value="WEEK">semana(s)</option>
                      <option value="MONTH">mes(es)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label>Inicio del ciclo</label>
                  <input
                    className="input"
                    type="date"
                    value={startAtIso}
                    onChange={(e) => setStartAtIso(e.target.value)}
                    disabled={!productId || !(customerId || selectedEmpresaId)}
                  />
                </div>
                <div className="field">
                  <label>Fin del primer ciclo</label>
                  <input
                    className="input"
                    type="date"
                    value={cutoffAtIso}
                    onChange={(e) => setCutoffAtIso(e.target.value)}
                    disabled={!productId || !(customerId || selectedEmpresaId)}
                  />
                </div>
              </div>

              <div className="field">
                <label>Checkout asociado</label>
                <div className="field-hint">Se usa el checkout público asociado al producto seleccionado.</div>
              </div>

              {tenants.length > 0 ? (
                <div className="field">
                  <label>Canal</label>
                  <select
                    className="select"
                    value={selectedTenantIds[0] || ""}
                    onChange={(e) => {
                      const value = String(e.target.value || "").trim();
                      setSelectedTenantIds(value ? [value] : []);
                    }}
                    disabled={!productId || !(customerId || selectedEmpresaId)}
                  >
                    <option value="">Selecciona un canal…</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                <div className="field-hint">Selecciona un solo canal para esta creación.</div>
              </div>
              ) : null}

              {selectedProduct?.kind === "PRODUCT" ? (
                <div className="field">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <label style={{ margin: 0 }}>Flete / envío para este contacto</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!selectedProduct?.requiresShipping || shippingCop === "0" || shippingCop === "$ 0"}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setShippingCop("$ 0");
                          } else {
                            setShippingCop(formatCurrencyInput("0", selectedProduct.currency || "COP"));
                          }
                        }}
                        disabled={!productId || !customerId}
                      />
                      <span>Flete gratis</span>
                    </label>
                  </div>
                  <input
                    className="input shipping-currency-input"
                    name="shippingPesos"
                    value={shippingCop}
                    onChange={(e) => setShippingCop(formatCurrencyInput(e.target.value, selectedProduct.currency || "COP"))}
                    inputMode="numeric"
                    placeholder="$ 0"
                    disabled={!productId || !customerId || shippingCop === "$ 0"}
                  />
                  <div className="field-hint">
                    Este valor solo se aplica a esta suscripción/plan. Deja en $0 para envío gratis.
                  </div>
                  <div className="field-hint">Moneda: {selectedProduct.currency || "COP"}</div>
                </div>
              ) : (
                <input type="hidden" name="shippingPesos" value="0" />
              )}

              {billingType === "SUBSCRIPCION" && duplicateCount > 0 ? (
                <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)" }}>
                  Atención: este cliente ya tiene {duplicateCount} suscripción(es) del mismo producto. Al guardar se pedirá confirmación.
                </div>
              ) : null}
              {billingType === "SUBSCRIPCION" && duplicateChecking ? (
                <div className="field-hint">Validando duplicados…</div>
              ) : null}

              <div className="module-footer">
                <button
                  className="ghost btn-compact btn-cancel"
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cerrar sin crear"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <button
                  className="ghost btn-compact"
                  type="submit"
                  name="submitAction"
                  value="CREATE"
                  disabled={!canSubmit}
                  title="Crear sin enviar link"
                  aria-label="Crear"
                >
                  {billingType === "PLAN" ? "Crear plan" : "Crear suscripción"}
                </button>
                <button
                  className="primary btn-compact btn-send"
                  type="submit"
                  name="submitAction"
                  value="LINK_NOW"
                  disabled={!canSubmit}
                  title="Crear y enviar link inmediatamente"
                  aria-label="Crear y enviar"
                >
                  {billingType === "PLAN" ? "Crear y enviar link" : "Crear y enviar débito"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        null
      )}
    </div>
  );
}
