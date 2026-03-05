"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { LocalDateTime } from "../ui/LocalDateTime";

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

export function AutoCutoffInlineForm({
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
  const initialCutoff = useMemo(() => toLocalInput(currentEndAt), [currentEndAt]);
  const [cutoffAt, setCutoffAt] = useState(initialCutoff);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setCutoffAt(initialCutoff);
  }, [initialCutoff]);

  return (
    <>
      <div className="billing-inline-cutoff">
        <button
          type="button"
          className="input billing-cutoff-trigger"
          data-loader="off"
          onClick={() => setOpen(true)}
          aria-label="Editar fecha de corte"
          title="Editar fecha de corte"
        >
          {currentEndAt ? <LocalDateTime value={currentEndAt} /> : "Sin fecha"}
        </button>
      </div>

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(520px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Fecha de corte</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>

            <form action={action} className="billing-cutoff-modal-form">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <div className="field">
                <label>Fecha y hora</label>
                <input
                  className="input"
                  type="datetime-local"
                  name="cutoffAt"
                  value={cutoffAt}
                  onChange={(e) => setCutoffAt(e.target.value)}
                  required
                />
              </div>
              <div className="module-footer">
                <button className="ghost btn-cancel" type="button" data-loader="off" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <PendingButton
                  className="primary btn-save"
                  type="submit"
                  pendingText="Guardando..."
                  disabled={!cutoffAt || cutoffAt === initialCutoff}
                >
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
