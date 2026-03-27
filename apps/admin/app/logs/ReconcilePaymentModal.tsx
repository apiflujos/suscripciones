"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";

export function ReconcilePaymentModal({
  csrfToken,
  action
}: {
  csrfToken: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ghost btn-compact btn-blue" type="button" data-loader="off" onClick={() => setOpen(true)}>
        Reconciliar pago
      </button>

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(520px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Reconciliar pago Wompi</h3>
              <button
                type="button"
                className="ghost modal-close"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                data-modal-close="true"
                data-loader="off"
              >
                X
              </button>
            </div>

            <form action={action} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />

              <div className="muted" style={{ fontSize: 12 }}>
                Ingresa al menos uno: Transacción, Referencia, Payment ID o Link id.
              </div>

              <div className="field">
                <label>Transacción Wompi</label>
                <input className="input" name="wompiTransactionId" placeholder="125761-1772468109-43044" />
              </div>
              <div className="field">
                <label>Referencia (opcional)</label>
                <input className="input" name="reference" placeholder="SUB_xxx_1" />
              </div>
              <div className="field">
                <label>Payment ID (opcional)</label>
                <input className="input" name="paymentId" placeholder="UUID del pago" />
              </div>
              <div className="field">
                <label>Link id (opcional)</label>
                <input className="input" name="wompiPaymentLinkId" placeholder="izuz78" />
              </div>

              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  data-loader="off" 
                  onClick={() => setOpen(false)}
                  title="Cerrar sin reconciliar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit" 
                  pendingText="Reconciliando..."
                  title="Reconciliar pago con Wompi"
                  aria-label="Reconciliar pago"
                >
                  Reconciliar
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
