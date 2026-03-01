"use client";

import { useState } from "react";
import { SmartListBuilder } from "./SmartListBuilder";

type Props = {
  action: (formData: FormData) => void;
  csrfToken: string;
  returnTo: string;
  preset?: string;
  prefillName?: string;
  prefillDescription?: string;
  nowIso: string;
  initialRules?: any;
};

export function SmartListCreateModal({
  action,
  csrfToken,
  returnTo,
  preset,
  prefillName,
  prefillDescription,
  nowIso,
  initialRules
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="primary btn-create" type="button" onClick={() => setOpen(true)}>
        Nueva lista
      </button>
      {open ? (
        <div className="smartListModal">
          <div className="smartListModalCard">
            <div className="smartListModalHeader">
              <div>
                <strong>Crear lista inteligente</strong>
                <div className="muted">Define reglas dinámicas para segmentar contactos.</div>
              </div>
              <button className="ghost" type="button" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>

            <form action={action} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Nombre</span>
                </label>
                <input className="input" name="name" defaultValue={prefillName} required />
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Descripción</span>
                </label>
                <input className="input" name="description" defaultValue={prefillDescription} />
              </div>
              <SmartListBuilder preset={preset || undefined} initialRules={initialRules || undefined} nowIso={nowIso} />
              <label className="checkbox" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="enabled" value="1" defaultChecked />
                <span>Habilitada</span>
              </label>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="primary btn-create" type="submit">Crear</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
