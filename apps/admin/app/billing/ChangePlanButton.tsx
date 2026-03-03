"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

export type PlanOption = {
  id: string;
  name: string;
  sku?: string;
  searchText?: string;
  collectionMode?: string | null;
  priceInCents?: number | null;
  currency?: string | null;
  kind?: "PRODUCT" | "SERVICE" | null;
  requiresShipping?: boolean;
  shippingInCents?: number | null;
};

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

function mapPlanFromApi(p: any): PlanOption {
  const metadata = p?.metadata && typeof p.metadata === "object" ? p.metadata : {};
  const catalog = metadata?.catalog && typeof metadata.catalog === "object" ? metadata.catalog : {};
  const pricing = readPlanPricing(metadata);
  const kind = String(catalog?.kind || "").toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT";
  const requiresShippingRaw = catalog?.requiresShipping;
  return {
    id: String(p?.id || ""),
    name: String(metadata?.displayName || p?.name || "Plan"),
    sku: String(metadata?.sku || ""),
    searchText: [metadata?.displayName, p?.name, metadata?.sku, catalog?.name, p?.id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    collectionMode: String(metadata?.collectionMode || p?.collectionMode || ""),
    priceInCents: Number(p?.priceInCents || 0),
    currency: String(p?.currency || "COP"),
    kind,
    requiresShipping: kind === "PRODUCT" && (requiresShippingRaw === true || requiresShippingRaw == null),
    shippingInCents: Number(pricing?.shippingInCents || 0)
  };
}

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

function planRequiresShipping(plan: PlanOption | null | undefined) {
  if (!plan) return false;
  const kind = String(plan.kind || "").toUpperCase();
  return kind !== "SERVICE";
}

export function ChangePlanButton({
  subscriptionId,
  currentPlanId,
  currentEndAt,
  currentShippingInCents = 0,
  currentRequiresShipping = false,
  currentPlanName = "Plan actual",
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
  currentEndAt?: string | null;
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
  const initialCutoff = useMemo(() => toLocalInput(currentEndAt), [currentEndAt]);
  const [planId, setPlanId] = useState(currentPlanId);
  const [cutoffAt, setCutoffAt] = useState(initialCutoff);
  const [query, setQuery] = useState("");
  const [shippingCop, setShippingCop] = useState(centsToCurrencyInput(currentShippingInCents || 0, "COP"));
  const [freeShipping, setFreeShipping] = useState(Boolean(currentRequiresShipping) && Number(currentShippingInCents || 0) <= 0);
  const [remotePlans, setRemotePlans] = useState<PlanOption[]>([]);
  const [searching, setSearching] = useState(false);
  const currentPlanFallback = useMemo<PlanOption>(
    () => ({
      id: currentPlanId,
      name: currentPlanName || "Plan actual",
      currency: currentPlanCurrency || "COP",
      kind: currentRequiresShipping ? "PRODUCT" : "SERVICE",
      requiresShipping: currentRequiresShipping,
      shippingInCents: Number(currentShippingInCents || 0)
    }),
    [currentPlanId, currentPlanName, currentPlanCurrency, currentRequiresShipping, currentShippingInCents]
  );

  useEffect(() => {
    if (!open) return;
    setPlanId(currentPlanId);
    setCutoffAt(initialCutoff);
    setQuery("");
    setShippingCop(centsToCurrencyInput(currentShippingInCents || 0, currentPlanCurrency || "COP"));
    setFreeShipping(Boolean(currentRequiresShipping) && Number(currentShippingInCents || 0) <= 0);
  }, [open, currentPlanId, initialCutoff, currentShippingInCents, currentRequiresShipping, currentPlanCurrency]);

  const localFilteredPlans = useMemo(() => {
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

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    let canceled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("take", "120");
        if (q) qs.set("q", q);
        if (tenantId) qs.set("tenantId", tenantId);
        const res = await fetch(`/api/search/plans?${qs.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (canceled) return;
        const items = Array.isArray(json?.items) ? json.items : [];
        const mapped = items.map((p: any) => mapPlanFromApi(p));
        setRemotePlans(mapped.filter((p: any) => p.id));
      } catch {
        if (!canceled) setRemotePlans([]);
      } finally {
        if (!canceled) setSearching(false);
      }
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [open, query, tenantId]);

  const filteredPlans = useMemo(() => {
    const merged = new Map<string, PlanOption>();
    const current = plans.find((p) => p.id === currentPlanId) || remotePlans.find((p) => p.id === currentPlanId) || currentPlanFallback;
    if (current) merged.set(current.id, current);
    for (const p of localFilteredPlans) merged.set(p.id, p);
    for (const p of remotePlans) merged.set(p.id, p);
    if (planId && !merged.has(planId)) merged.set(planId, currentPlanFallback);
    return Array.from(merged.values());
  }, [remotePlans, localFilteredPlans, plans, currentPlanId, planId, currentPlanFallback]);

  const selectedPlan = useMemo(() => {
    return filteredPlans.find((p) => String(p.id) === String(planId)) || plans.find((p) => String(p.id) === String(planId)) || null;
  }, [filteredPlans, plans, planId]);
  const selectedRequiresShipping = planRequiresShipping(selectedPlan);
  const currentShippingComparable = currentRequiresShipping ? Number(currentShippingInCents || 0) : 0;
  const selectedShippingInCents = selectedRequiresShipping ? (freeShipping ? 0 : currencyInputToCents(shippingCop)) : 0;
  const shippingChanged = selectedRequiresShipping && selectedShippingInCents !== currentShippingComparable;
  const hasChange = Boolean(
    planId &&
      (planId !== currentPlanId || cutoffAt !== initialCutoff || shippingChanged)
  );

  useEffect(() => {
    const plan = plans.find((p) => String(p.id) === String(planId)) || remotePlans.find((p) => String(p.id) === String(planId));
    if (!plan) return;
    const requires = planRequiresShipping(plan);
    if (!requires) {
      setFreeShipping(false);
      setShippingCop("");
      return;
    }
    const nextShipping = Number(plan.shippingInCents || 0);
    setFreeShipping(nextShipping <= 0);
    setShippingCop(centsToCurrencyInput(nextShipping, String(plan.currency || "COP")));
  }, [planId, plans, remotePlans]);

  return (
    <>
      <button
        className={`ghost btn-compact btn-blue ${iconOnly ? "btn-icon-only btn-edit" : "btn-noicon"}`}
        type="button"
        data-loader="off"
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? "Editar producto/flete" : undefined}
        title={iconOnly ? "Editar producto/flete" : undefined}
      >
        {iconOnly ? null : "Cambiar producto"}
      </button>

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(560px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Cambiar producto del contacto</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>

            <form action={action} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Nuevo producto</span>
                  <HelpTip text="Puedes elegir cualquier producto/plan existente o crear uno nuevo en Productos." />
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
                <select className="select" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {filteredPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!filteredPlans.length ? (
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
                  <span>Si necesitas otro plan, créalo aquí mismo.</span>
                  <a
                    href="/products"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}
                  >
                    Crear plan
                  </a>
                </div>
              </div>

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Nueva fecha de corte</span>
                  <HelpTip text="Se recalcula el ciclo y se programa el cobro o link de pago según el plan." />
                </label>
                <input
                  className="input"
                  type="datetime-local"
                  name="cutoffAt"
                  value={cutoffAt}
                  onChange={(e) => setCutoffAt(e.target.value)}
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
                    className="input"
                    name="shippingPesos"
                    inputMode="numeric"
                    value={shippingCop}
                    onChange={(e) => setShippingCop(formatCurrencyInput(e.target.value, String(selectedPlan?.currency || "COP")))}
                    disabled={freeShipping}
                    placeholder="$ 0"
                    required={!freeShipping}
                  />
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

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" data-loader="off" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <PendingButton className="primary btn-save" type="submit" pendingText="Guardando..." disabled={!hasChange || !cutoffAt}>
                  Guardar
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
