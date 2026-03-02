"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

type PlanOption = {
  id: string;
  name: string;
  sku?: string;
  searchText?: string;
  collectionMode?: string | null;
  priceInCents?: number | null;
  currency?: string | null;
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

export function ChangePlanButton({
  subscriptionId,
  currentPlanId,
  currentEndAt,
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
  const [remotePlans, setRemotePlans] = useState<PlanOption[]>([]);
  const [searching, setSearching] = useState(false);
  const hasChange = planId && planId !== currentPlanId;

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
    const q = query.trim();
    if (q.length < 2) {
      setRemotePlans([]);
      setSearching(false);
      return;
    }
    let canceled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("q", q);
        qs.set("take", "120");
        if (tenantId) qs.set("tenantId", tenantId);
        const res = await fetch(`/api/search/plans?${qs.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (canceled) return;
        const items = Array.isArray(json?.items) ? json.items : [];
        const mapped = items.map((p: any) => ({
          id: String(p?.id || ""),
          name: String(p?.metadata?.displayName || p?.name || "Plan"),
          sku: String(p?.metadata?.sku || ""),
          searchText: [
            p?.metadata?.displayName,
            p?.name,
            p?.metadata?.sku,
            p?.metadata?.catalog?.name,
            p?.id
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          collectionMode: String(p?.metadata?.collectionMode || p?.collectionMode || ""),
          priceInCents: Number(p?.priceInCents || 0),
          currency: String(p?.currency || "COP")
        }));
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
  }, [query, tenantId]);

  const filteredPlans = useMemo(() => {
    const q = query.trim();
    const source = q.length >= 2 ? remotePlans : localFilteredPlans;
    const merged = new Map<string, PlanOption>();
    const current = plans.find((p) => p.id === currentPlanId);
    if (current) merged.set(current.id, current);
    for (const p of source) merged.set(p.id, p);
    return Array.from(merged.values());
  }, [query, remotePlans, localFilteredPlans, plans, currentPlanId]);

  return (
    <>
      <button
        className={`ghost btn-compact btn-noicon btn-blue ${iconOnly ? "btn-icon-only btn-edit" : ""}`}
        type="button"
        data-loader="off"
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? "Cambiar producto" : undefined}
        title={iconOnly ? "Cambiar producto" : undefined}
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
                    Debes seleccionar un producto diferente.
                  </div>
                ) : null}
                <div className="field-hint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>Si necesitas otro plan, créalo aquí mismo.</span>
                  <a className="ghost btn-compact" href="/products" target="_blank" rel="noreferrer">
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
