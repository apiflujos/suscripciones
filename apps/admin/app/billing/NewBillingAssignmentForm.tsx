"use client";

import { useEffect, useMemo, useState } from "react";
import { NewCustomerForm } from "../customers/NewCustomerForm";
import { enterToNextField } from "../lib/enterToNext";
import { HelpTip } from "../ui/HelpTip";

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

type IntervalUnit = "DAY" | "WEEK" | "MONTH";

function fmtMoneyFromCents(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(localValue: string) {
  const v = String(localValue || "").trim();
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function getOptionValues(item: CatalogItem | null, key: "option1" | "option2") {
  if (!item) return [] as string[];
  const values = new Set<string>();
  for (const v of item.variants ?? []) {
    const val = key === "option1" ? v.option1 : v.option2;
    if (val) values.add(String(val));
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "es"));
}

export function NewBillingAssignmentForm({
  customers,
  catalogItems,
  csrfToken,
  defaultOpen = false,
  defaultSelectedCustomerId = "",
  createCustomer,
  createPlanAndSubscription
}: {
  customers: Customer[];
  catalogItems: CatalogItem[];
  csrfToken: string;
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
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("MONTH");
  const [intervalCount, setIntervalCount] = useState(1);
  const [option1Value, setOption1Value] = useState("");
  const [option2Value, setOption2Value] = useState("");

  const [startLocal, setStartLocal] = useState("");
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [sameCutoff, setSameCutoff] = useState(true);

  useEffect(() => {
    const now = new Date();
    const v = toDatetimeLocalValue(now);
    setStartLocal((x) => x || v);
    setCutoffLocal((x) => x || v);
  }, []);

  useEffect(() => {
    if (sameCutoff) setCutoffLocal(startLocal);
  }, [sameCutoff, startLocal]);

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

  const hasToken = Boolean(selectedCustomer?.metadata?.wompi?.paymentSourceId);

  const option1Values = useMemo(() => getOptionValues(selectedProduct, "option1"), [selectedProduct]);
  const option2Values = useMemo(() => getOptionValues(selectedProduct, "option2"), [selectedProduct]);

  useEffect(() => {
    if (!selectedProduct) {
      setOption1Value("");
      setOption2Value("");
      return;
    }
    if (option1Value && !option1Values.includes(option1Value)) setOption1Value("");
    if (option2Value && !option2Values.includes(option2Value)) setOption2Value("");
  }, [selectedProduct, option1Value, option2Value, option1Values, option2Values]);


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
      fetch(`/api/search/products?${new URLSearchParams({ q, take: "80" }).toString()}`, { cache: "no-store", signal: ac.signal })
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
      fetch(`/api/search/customers?${new URLSearchParams({ q, take: "80" }).toString()}`, { cache: "no-store", signal: ac.signal })
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

  const startAtIso = useMemo(() => localToIso(startLocal), [startLocal]);
  const cutoffAtIso = useMemo(() => localToIso(cutoffLocal), [cutoffLocal]);

  const canSubmit = Boolean(productId && customerId && intervalCount > 0);

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
                    setOption1Value("");
                    setOption2Value("");
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
                  <strong>{selectedCustomer.name || selectedCustomer.email || selectedCustomer.id}</strong>
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
                      {c.name || c.email || c.id} · {c.metadata?.identificacion || c.email || c.phone || "—"}
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
                <NewCustomerForm createCustomer={createCustomer} defaultOpen mode="always_open" hidePanelHeader returnTo="/billing?crear=1" csrfToken={csrfToken} />
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
                <div className="field">
                  <label>Cobro</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={intervalCount}
                      onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value || 1)))}
                      disabled={!productId || !customerId}
                    />
                    <select
                      className="select"
                      value={intervalUnit}
                      onChange={(e) => setIntervalUnit((e.target.value || "MONTH") as IntervalUnit)}
                      disabled={!productId || !customerId}
                    >
                      <option value="DAY">Día</option>
                      <option value="WEEK">Semana</option>
                      <option value="MONTH">Mes</option>
                    </select>
                  </div>
                </div>
              </div>

              {selectedProduct?.option1Name ? (
                <div className="field">
                  <label>{selectedProduct.option1Name}</label>
                  <select className="select" value={option1Value} onChange={(e) => setOption1Value(e.target.value)} disabled={!productId || !customerId}>
                    <option value="">Selecciona…</option>
                    {option1Values.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              {selectedProduct?.option2Name ? (
                <div className="field">
                  <label>{selectedProduct.option2Name}</label>
                  <select className="select" value={option2Value} onChange={(e) => setOption2Value(e.target.value)} disabled={!productId || !customerId}>
                    <option value="">Selecciona…</option>
                    {option2Values.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Inicio (activación)</span>
                    <HelpTip text="Fecha/hora en la que inicia la suscripción." />
                  </label>
                  <input className="input" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} disabled={!productId || !customerId} />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Corte (cobro)</span>
                    <HelpTip text="Fecha/hora del primer cobro. Si se deja igual al inicio, se cobra de inmediato." />
                  </label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={cutoffLocal}
                    onChange={(e) => setCutoffLocal(e.target.value)}
                    disabled={!productId || !customerId || sameCutoff}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={sameCutoff} onChange={(e) => setSameCutoff(e.target.checked)} disabled={!productId || !customerId} />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span>Corte = inicio</span>
                      <HelpTip text="Usa la misma fecha/hora de activación." />
                    </span>
                  </label>
                </div>
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                {billingType === "SUBSCRIPCION" && hasToken ? (
                  <>
                    <button
                      className="ghost"
                      type="submit"
                      name="submitAction"
                      value="CREATE"
                      disabled={!canSubmit}
                    >
                      Crear
                    </button>
                    <button
                      className="primary"
                      type="submit"
                      name="submitAction"
                      value="CHARGE_NOW"
                      disabled={!canSubmit}
                    >
                      Crear y cobrar ahora
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    type="submit"
                    name="submitAction"
                    value="LINK_NOW"
                    disabled={!canSubmit}
                  >
                    Crear y enviar link de pago
                  </button>
                )}
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
