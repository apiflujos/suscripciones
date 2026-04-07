"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { AppModal } from "../ui/AppModal";

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
      <button className="ghost btn-compact btn-blue" type="button" data-loader="off" onClick={() => setOpen(true)}>
        Editar plan
      </button>

      <AppModal open={open} onClose={() => setOpen(false)} title="Recurrencia del plan" width="min(520px, 96vw)">
        <form action={action} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Unidad de recurrencia</span>
                  <HelpTip text="Día, semana o mes." />
                </label>
                <select className="select" name="intervalUnit" value={unit} onChange={(e) => setUnit(e.target.value as any)}>
                  <option value="DAY">Día</option>
                  <option value="WEEK">Semana</option>
                  <option value="MONTH">Mes</option>
                </select>
              </div>

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Cada (cantidad)</span>
                  <HelpTip text="Número de unidades entre cobros." />
                </label>
                <input
                  className="input"
                  name="intervalCount"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  inputMode="numeric"
                />
              </div>

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
                  title="Guardar recurrencia del plan"
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
