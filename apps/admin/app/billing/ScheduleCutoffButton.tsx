"use client";

import { useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

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

export function ScheduleCutoffButton({
  subscriptionId,
  csrfToken,
  returnTo,
  tenantId,
  currentEndAt,
  action
}: {
  subscriptionId: string;
  csrfToken: string;
  returnTo: string;
  tenantId?: string;
  currentEndAt?: string | null;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const initialValue = useMemo(() => toLocalInput(currentEndAt), [currentEndAt]);
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <button className="ghost btn-compact btn-blue" type="button" onClick={() => setOpen(true)}>
        Programar fecha de corte
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
              <h3 style={{ margin: 0 }}>Fecha de corte</h3>
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
                  <span>Fecha y hora</span>
                  <HelpTip text="Fecha en la que se hará el cobro automático." />
                </label>
                <input
                  className="input"
                  type="datetime-local"
                  name="cutoffAt"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                />
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost" type="button" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
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
