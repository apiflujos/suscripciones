"use client";

import { useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

type PlanOption = {
  id: string;
  name: string;
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
  action
}: {
  subscriptionId: string;
  currentPlanId: string;
  currentEndAt?: string | null;
  plans: PlanOption[];
  csrfToken: string;
  returnTo: string;
  tenantId?: string;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const initialCutoff = useMemo(() => toLocalInput(currentEndAt), [currentEndAt]);
  const [planId, setPlanId] = useState(currentPlanId);
  const [cutoffAt, setCutoffAt] = useState(initialCutoff);
  const [query, setQuery] = useState("");
  const hasChange = planId && planId !== currentPlanId;

  const filteredPlans = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => {
      const name = String(p.name || "").toLowerCase();
      const id = String(p.id || "").toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [plans, query]);

  return (
    <>
      <button className="ghost btn-compact btn-blue" type="button" onClick={() => setOpen(true)}>
        Cambiar producto
      </button>

      {open ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16
          }}
        >
          <div className="panel module" style={{ width: "min(560px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Cambiar producto del contacto</h3>
              <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label="Cerrar">
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
                <button className="ghost" type="button" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <PendingButton className="primary" type="submit" pendingText="Guardando..." disabled={!hasChange || !cutoffAt}>
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
