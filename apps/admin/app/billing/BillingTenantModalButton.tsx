"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";

export function BillingTenantModalButton({
  triggerId,
  triggerLabel = "Cambiar canal",
  triggerClassName = "ghost btn-compact btn-noicon",
  triggerStyle,
  hideTrigger = false,
  subscriptionId,
  scopeTenantId,
  tenantIds,
  tenants,
  csrfToken,
  returnTo,
  action
}: {
  triggerId?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  hideTrigger?: boolean;
  subscriptionId: string;
  scopeTenantId?: string;
  tenantIds: string[];
  tenants: Array<{ id: string; name: string }>;
  csrfToken: string;
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        id={triggerId}
        className={triggerClassName}
        style={hideTrigger ? { display: "none" } : triggerStyle}
        type="button"
        onClick={() => setOpen(true)}
        data-modal="true"
        data-loader="off"
      >
        {triggerLabel}
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header">
              <strong>Canales de la suscripción</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form action={action} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="scopeTenantId" value={scopeTenantId || ""} />
              <input type="hidden" name="primaryTenantId" value={scopeTenantId || ""} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div style={{ display: "grid", gap: 6, maxHeight: 260, overflow: "auto", paddingRight: 4 }}>
                {tenants.map((tenant) => {
                  const id = String(tenant.id || "");
                  const checked = tenantIds.includes(id);
                  return (
                    <label key={`${subscriptionId}-${id}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" name="tenantIds" value={id} defaultChecked={checked} />
                      <span>{tenant.name}</span>
                    </label>
                  );
                })}
              </div>
              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  onClick={() => setOpen(false)} 
                  data-loader="off"
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit" 
                  pendingText="Guardando..."
                  title="Guardar canales de venta"
                  aria-label="Guardar cambios"
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
