"use client";

import { useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { AppModal } from "../ui/AppModal";

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
      <button className="ghost btn-compact btn-noicon btn-blue" type="button" data-loader="off" onClick={() => setOpen(true)}>
        Fecha de cobro
      </button>

      {open ? (
        <AppModal open={open} onClose={() => setOpen(false)} title="Fecha de corte" width="min(520px, 96vw)">
          <>
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
                  title="Guardar fecha de corte"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
            </form>
          </>
        </AppModal>
      ) : null}
    </>
  );
}
