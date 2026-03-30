"use client";

import { useState } from "react";
import { EmpresaForm } from "./EmpresaForm";

type ContactRow = {
  id?: string;
  tempId?: string;
  nombre: string;
  email?: string;
  telefono?: string;
  cargo: string;
};

export function EmpresaCreateModal({
  csrfToken,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,
  returnTo,
  tenantId
}: {
  csrfToken: string;
  createEmpresa: (formData: FormData) => Promise<void>;
  updateEmpresa: (formData: FormData) => Promise<void>;
  deleteEmpresa: (formData: FormData) => Promise<void>;
  returnTo: string;
  tenantId?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="primary btn-compact btn-create" type="button" data-loader="off" onClick={() => setOpen(true)}>
        Crear empresa
      </button>
      {open ? (
        <div className="smartListModal">
          <div className="smartListModalCard">
            <div className="smartListModalHeader">
              <div>
                <strong>Nueva empresa</strong>
                <div className="muted">Crea la empresa y asocia contactos.</div>
              </div>
              <button className="ghost" type="button" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>
            <EmpresaForm
              empresa={null}
              contactos={[] as ContactRow[]}
              csrfToken={csrfToken}
              createEmpresa={createEmpresa}
              updateEmpresa={updateEmpresa}
              deleteEmpresa={deleteEmpresa}
              returnTo={returnTo}
              tenantId={tenantId || undefined}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
