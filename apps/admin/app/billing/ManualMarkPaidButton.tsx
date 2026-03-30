"use client";

import React, { useRef, useState } from "react";

export function ManualMarkPaidButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId,
  returnTo,
  warnAlreadyPaid,
  manualMarkPaidEnabled
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string | null;
  returnTo?: string;
  warnAlreadyPaid: boolean;
  manualMarkPaidEnabled?: boolean;
}) {
  const methodRef = useRef<HTMLInputElement | null>(null);
  const [showConfigAlert, setShowConfigAlert] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    if (manualMarkPaidEnabled === false) {
      e.preventDefault();
      setShowConfigAlert(true);
      return;
    }

    if (warnAlreadyPaid) {
      const ok = confirm("Esta suscripción ya tiene un pago aprobado en el periodo actual. ¿Deseas marcarla como pagada manualmente de todas formas?");
      if (!ok) {
        e.preventDefault();
        return;
      }
    }
    const raw = prompt("¿Cómo se pagó? Escribe: Transferencia, Bre-B o Efectivo.", "Transferencia") || "";
    const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");
    const method =
      normalized === "TRANSFERENCIA"
        ? "TRANSFERENCIA"
        : normalized === "BRE-B" || normalized === "BREB"
          ? "BREB"
          : normalized === "EFECTIVO"
            ? "EFECTIVO"
            : "";
    if (!method) {
      alert("Método inválido. Usa: Transferencia, Bre-B o Efectivo.");
      e.preventDefault();
      return;
    }
    if (methodRef.current) methodRef.current.value = method;
  };

  return (
    <>
      <form action={action} onSubmit={handleSubmit}>
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <input ref={methodRef} type="hidden" name="manualMethod" value="" />
        <button
          className="ghost btn-compact btn-amber btn-noicon"
          type="submit"
          title={manualMarkPaidEnabled === false ? "El marcado manual está deshabilitado. Hacé clic para ir a Configuración." : "Marcar como pagada manualmente"}
          aria-disabled={manualMarkPaidEnabled === false}
          style={manualMarkPaidEnabled === false ? { opacity: 0.7, cursor: "pointer" } : undefined}
        >
          Marcar pagada
        </button>
      </form>

      {showConfigAlert && (
        <div className="modal-backdrop" onClick={() => setShowConfigAlert(false)}>
          <div className="modal-panel" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Marcado manual deshabilitado</h3>
              <button className="ghost modal-close" type="button" onClick={() => setShowConfigAlert(false)}>X</button>
            </div>
            <div className="modal-body">
              <p>El marcado manual de pagos está desactivado en la configuración. Para habilitarlo:</p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>Andá a <strong>Configuración</strong></li>
                <li>Seleccioná la pestaña <strong>Cobros</strong></li>
                <li>Activá la opción <strong>"Permitir marcado manual de pagos"</strong></li>
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
          </div>
        </div>
      )}
    </>
  );
}
