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

type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  currency: string;
  basePriceInCents: number;
  taxPercent?: number;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
};

type BillingType = "PLAN" | "SUBSCRIPCION";

type CheckoutTemplate = {
  id: string;
  name: string;
  kind: "PLAN" | "SUBSCRIPTION";
  active: boolean;
};

function fmtMoneyFromCents(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

export function NewBillingAssignmentForm({
  customers,
  catalogItems,
  checkoutTemplates,
  csrfToken,
  tenantId,
  tenants,
  defaultOpen = false,
  defaultSelectedCustomerId = "",
  createCustomer,
  createPlanAndSubscription
}: {
  customers: Customer[];
  catalogItems: CatalogItem[];
  checkoutTemplates: CheckoutTemplate[];
  csrfToken: string;
  tenantId?: string;
  tenants: Array<{ id: string; name: string }>;
  defaultOpen?: boolean;
  defaultSelectedCustomerId?: string;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const [productQ, setProductQ] = useState("");
  const [productId, setProductId] = useState("");
  const [productHits, setProductHits] = useState<CatalogItem[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [productSearchError, setProductSearchError] = useState("");

  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState(defaultSelectedCustomerId || "");
  const [customerHits, setCustomerHits] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [selectedCustomerOverride, setSelectedCustomerOverride] = useState<Customer | null>(null);

  const [billingType, setBillingType] = useState<BillingType>("SUBSCRIPCION");
  const intervalUnit = "MONTH";
  const intervalCount = 1;
  const option1Value = "";
  const option2Value = "";
  const [templateId, setTemplateId] = useState("");

  const startAtIso = "";
  const cutoffAtIso = "";

  const selectedProduct = useMemo(() => {
    if (!productId) return null;
    return catalogItems.find((p) => String(p.id) === String(productId)) || productHits.find((p) => String(p.id) === String(productId)) || null;
  }, [catalogItems, productHits, productId]);

  const selectedCustomer = useMemo(() => {
    if (!customerId) return null;
    if (selectedCustomerOverride && String(selectedCustomerOverride.id) === String(customerId)) return selectedCustomerOverride;
    return (
      customers.find((c) => String(c.id) === String(customerId)) ||
      customerHits.find((c) => String(c.id) === String(customerId)) ||
      null
    );
  }, [customers, customerHits, customerId, selectedCustomerOverride]);

  const hasToken = useMemo(() => {
    const meta = selectedCustomer?.metadata ?? {};
    const candidates = [
      meta?.wompi?.paymentSourceId,
      meta?.wompi?.payment_source_id,
      meta?.paymentSourceId,
      meta?.payment_source_id
    ];
    return candidates.some((v: any) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^\d+$/.test(v)));
  }, [selectedCustomer]);

  // Variantes y fechas simplificadas en este flujo.

  const templatesForType = useMemo(() => {
    const targetKind = billingType === "PLAN" ? "PLAN" : "SUBSCRIPTION";
    return checkoutTemplates.filter((t) => t.kind === targetKind);
  }, [billingType, checkoutTemplates]);

  useEffect(() => {
    if (!templateId) return;
    if (!templatesForType.some((t) => String(t.id) === String(templateId))) {
      setTemplateId("");
    }
  }, [templateId, templatesForType]);

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

  const mustPickTenant = tenants.length > 0;
  const canSubmit = Boolean(productId && customerId && (!mustPickTenant || selectedTenantIds.length > 0));

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "grid" }}>
          <h3 style={{ margin: 0 }}>Crear plan o suscripción para un contacto</h3>
        </div>
        <button className={open ? "ghost" : "primary"} type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear plan / suscripción"}
        </button>
      </div>

      {open ? (
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
                  className="ghost"
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
                {productQ.trim().length >= 2 && filteredProducts.length > 0 ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {filteredProducts.slice(0, 8).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setProductId(String(p.id));
                          setProductQ(String(p.name || ""));
                        }}
                        style={{ textAlign: "left" }}
                      >
                        {p.sku || "—"} · {p.name} · {p.kind === "SERVICE" ? "Servicio" : "Producto"} · {fmtMoneyFromCents(p.basePriceInCents, p.currency)}
                      </button>
                    ))}
                  </div>
                ) : null}
                <select
                  className="select"
                  value={productId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProductId(id);
                    const picked = filteredProducts.find((p) => String(p.id) === String(id)) || null;
                    if (picked) setProductQ(String(picked.name || ""));
                  }}
                >
                  <option value="">Selecciona un producto…</option>
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku || "—"} · {p.name} · {p.kind === "SERVICE" ? "Servicio" : "Producto"} · {fmtMoneyFromCents(p.basePriceInCents, p.currency)}
                    </option>
                  ))}
                </select>
                {!productSearching && filteredProducts.length === 0 ? (
                  <div className="field-hint">
                    {productQ.trim().length >= 2 ? "Sin resultados. Prueba con otro término." : "No se encontraron productos."}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>2) Contacto</h3>
              <button className="ghost" type="button" onClick={() => setShowNewCustomer((v) => !v)}>
                {showNewCustomer ? "Cerrar" : "Crear contacto"}
              </button>
            </div>

            {selectedCustomer ? (
              <div className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "grid" }}>
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
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setCustomerId("");
                    setCustomerQ("");
                    setCustomerHits([]);
                    setSelectedCustomerOverride(null);
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
                  placeholder="Buscar por nombre, email o identificación…"
                  aria-label="Buscar contacto"
                />
                <div aria-live="polite">
                  {customerSearching ? <div className="field-hint">Buscando…</div> : null}
                  {customerSearchError ? <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)" }}>{customerSearchError}</div> : null}
                </div>
                {customerQ.trim().length >= 2 && filteredCustomers.length > 0 ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {filteredCustomers.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setCustomerId(String(c.id));
                          setSelectedCustomerOverride(c);
                          setCustomerQ(String(c.name || c.email || ""));
                          setShowNewCustomer(false);
                        }}
                        style={{ textAlign: "left" }}
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
                  </div>
                ) : null}
                <select
                  className="select"
                  value={customerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCustomerId(id);
                    const picked = filteredCustomers.find((c) => String(c.id) === String(id)) || null;
                    setSelectedCustomerOverride(picked);
                    setShowNewCustomer(false);
                  }}
                >
                  <option value="">Selecciona un contacto…</option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.email || c.id} · {c.metadata?.identificacion || c.email || c.phone || "—"} ·{" "}
                      {(typeof c.metadata?.wompi?.paymentSourceId === "number" && Number.isFinite(c.metadata?.wompi?.paymentSourceId)) ||
                      (typeof c.metadata?.wompi?.paymentSourceId === "string" && /^\d+$/.test(c.metadata?.wompi?.paymentSourceId)) ||
                      (typeof c.metadata?.wompi?.payment_source_id === "string" && /^\d+$/.test(c.metadata?.wompi?.payment_source_id)) ||
                      (typeof c.metadata?.paymentSourceId === "string" && /^\d+$/.test(c.metadata?.paymentSourceId)) ||
                      (typeof c.metadata?.payment_source_id === "string" && /^\d+$/.test(c.metadata?.payment_source_id))
                        ? "Tokenizada"
                        : "Sin token"}
                    </option>
                  ))}
                </select>
                {!customerSearching && filteredCustomers.length === 0 ? (
                  <div className="field-hint">
                    {customerQ.trim().length >= 2 ? "Sin resultados. Prueba con otro término." : "No se encontraron contactos."}
                  </div>
                ) : null}
              </div>
            )}

            {showNewCustomer ? (
              <div style={{ marginTop: 10 }}>
                <NewCustomerForm createCustomer={createCustomer} defaultOpen mode="always_open" hidePanelHeader returnTo="/billing?crear=1" csrfToken={csrfToken} tenantId={tenantId} tenants={tenants} />
              </div>
            ) : null}
          </div>

          <div className="panel module" style={{ margin: 0, opacity: canSubmit ? 1 : 0.6 }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>3) Plan o suscripción</h3>
            </div>

            <form action={createPlanAndSubscription} onKeyDownCapture={enterToNextField} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="billingType" value={billingType} />
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
                  <select className="select" value={billingType} onChange={(e) => setBillingType(e.target.value === "PLAN" ? "PLAN" : "SUBSCRIPCION")} disabled={!productId || !customerId}>
                    <option value="SUBSCRIPCION">Suscripción</option>
                    <option value="PLAN">Plan</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Plantilla de checkout</label>
                <select
                  className="select"
                  name="templateId"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={!productId || !customerId}
                >
                  <option value="">Usar configuración global</option>
                  {templatesForType.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.active ? "" : " (inactiva)"}
                    </option>
                  ))}
                </select>
                {!templatesForType.length ? <div className="field-hint">No hay plantillas {billingType === "PLAN" ? "de plan" : "de suscripción"}.</div> : null}
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
                    disabled={!productId || !customerId}
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

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                {!canSubmit ? (
                  <span className="field-hint">
                    Selecciona producto, contacto{mustPickTenant ? " y canal" : ""} para continuar.
                  </span>
                ) : null}
                <button
                  className="primary"
                  type="submit"
                  name="submitAction"
                  value="LINK_NOW"
                  disabled={!canSubmit}
                >
                  {billingType === "PLAN" ? "Enviar link de pago" : "Enviar link de tokenización"}
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
