"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

export function PlanRecurrenceEditor({
  planId,
  intervalUnit,
  intervalCount,
  csrfToken,
  returnTo,
  action,
  tenantId
}: {
  planId: string;
  intervalUnit: "DAY" | "WEEK" | "MONTH" | "CUSTOM";
  intervalCount: number;
  csrfToken: string;
  returnTo: string;
  action: (formData: FormData) => void;
  tenantId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">(intervalUnit || "MONTH");
  const [count, setCount] = useState(String(intervalCount || 1));

  return (
    <>
      <button className="ghost btn-compact btn-blue" type="button" onClick={() => setOpen(true)}>
        Editar plan
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
          <div className="panel module" style={{ width: "min(520px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Recurrencia del plan</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>

            <form action={action} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Unidad</span>
                  <HelpTip text="Unidad del cobro recurrente." />
                </label>
                <select className="select" name="intervalUnit" value={unit} onChange={(e) => setUnit(e.target.value as any)}>
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
                <input
                  className="input"
                  name="intervalCount"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  inputMode="numeric"
                />
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <PendingButton className="primary btn-save" type="submit" pendingText="Guardando...">
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
