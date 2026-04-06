"use client";

import React, { useState } from "react";
import { AppModal } from "../ui/AppModal";

export function ManualChargeButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId,
  returnTo,
  warnNotDue,
  warnAlreadyPaid,
  manualChargeEnabled
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string | null;
  returnTo?: string;
  warnNotDue: boolean;
  warnAlreadyPaid: boolean;
  manualChargeEnabled?: boolean;
}) {
  const [showConfigAlert, setShowConfigAlert] = useState(false);

  const handleClick = (e: React.FormEvent) => {
    if (manualChargeEnabled === false) {
      e.preventDefault();
      setShowConfigAlert(true);
      return;
    }
    
    if (!warnNotDue && !warnAlreadyPaid) return;
    const parts: string[] = [];
    if (warnAlreadyPaid) {
      parts.push("Esta suscripción ya tiene un pago aprobado en el periodo actual.");
    }
    if (warnNotDue) {
      parts.push("La fecha de corte aún no se ha cumplido.");
    }
    const msg = `${parts.join(" ")} ¿Deseas cobrar igualmente?`;
    if (!confirm(msg)) e.preventDefault();
  };

  return (
    <>
      <form action={action} onSubmit={handleClick}>
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <button
          className="primary btn-compact btn-pay subscription-action-btn"
          type="submit"
          title={manualChargeEnabled === false ? "El cobro manual está deshabilitado. Hacé clic para ir a Configuración." : "Cobrar suscripción ahora (débito automático)"}
          aria-disabled={manualChargeEnabled === false}
          style={manualChargeEnabled === false ? { opacity: 0.7, cursor: "pointer" } : undefined}
        >
          Cobrar
        </button>
      </form>

      <AppModal
        open={showConfigAlert}
        onClose={() => setShowConfigAlert(false)}
        title="Cobro manual deshabilitado"
        maxWidth={520}
        bodyClassName=""
      >
        <div>
          <p>El cobro manual está desactivado en la configuración. Para habilitarlo:</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Andá a <strong>Configuración</strong></li>
            <li>Seleccioná la pestaña <strong>Cobros</strong></li>
            <li>Activá la opción <strong>"Permitir cobro manual"</strong></li>
          </ol>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <a className="primary btn-compact btn-noicon" href="/settings?tab=cobros">
              Ir a Configuración
            </a>
            <button className="ghost btn-compact btn-noicon" type="button" onClick={() => setShowConfigAlert(false)}>
              Cancelar
            </button>
          </div>
        </div>
      </AppModal>
    </>
  );
}
