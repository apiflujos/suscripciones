"use client";

import { useEffect, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

export function PaymentLinkModalButton({
  subscriptionId,
  customerId,
  tenantId,
  csrfToken,
  returnTo,
  defaultAmountPesos,
  action
}: {
  subscriptionId: string;
  customerId: string;
  tenantId?: string;
  csrfToken: string;
  returnTo: string;
  defaultAmountPesos?: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => amountRef.current?.focus(), 0);
  }, [open]);

  return (
    <>
      <button className="ghost btn-compact btn-send" type="button" onClick={() => setOpen(true)} data-modal="true" data-loader="off">
        Crear link de pago
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header ui-panel-header">
              <strong>Crear link de pago</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form action={action} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>Monto (COP)</span>
                  <HelpTip text="Deja vacío para usar el monto configurado en la suscripción." />
                </label>
                <input
                  ref={amountRef}
                  className="input"
                  name="amountPesos"
                  inputMode="numeric"
                  placeholder={defaultAmountPesos ? `${defaultAmountPesos}` : "Ej: 390000"}
                  defaultValue={defaultAmountPesos ? String(defaultAmountPesos) : ""}
                />
              </div>
              <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="sendNow" value="1" />
                <span>Enviar por WhatsApp al crear</span>
              </label>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-compact" type="button" onClick={() => setOpen(false)} data-loader="off">
                  Cancelar
                </button>
                <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Creando...">
                  Crear link
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
