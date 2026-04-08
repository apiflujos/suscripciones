"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { AppModal } from "../ui/AppModal";

export function ReconcilePaymentModal({
  csrfToken,
  action,
  returnTo,
  className
}: {
  csrfToken: string;
  action: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={className || "ghost btn-compact btn-blue btn-noicon"} type="button" data-loader="off" onClick={() => setOpen(true)}>
        Reconciliar
      </button>

      {open ? (
        <AppModal open={open} onClose={() => setOpen(false)} title="Reconciliar pago Wompi" width="min(520px, 96vw)">
          <>
            <form action={action} className="modal-form-stack">
              <input type="hidden" name="csrf" value={csrfToken} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

              <div className="field-hint modal-note">
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
          </>
        </AppModal>
      ) : null}
    </>
  );
}
