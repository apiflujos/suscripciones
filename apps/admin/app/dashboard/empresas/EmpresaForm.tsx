"use client";

import { useMemo, useState } from "react";
import { enterToNextField } from "../../lib/enterToNext";

type ContactRow = {
  id?: string;
  tempId?: string;
  nombre: string;
  email?: string;
  telefono?: string;
  cargo: string;
};

type Empresa = {
  id: string;
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  sitioWeb?: string | null;
  contactoPrincipalId?: string | null;
};

export function EmpresaForm({
  empresa,
  contactos,
  csrfToken,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,
  returnTo
}: {
  empresa: Empresa | null;
  contactos: ContactRow[];
  csrfToken: string;
  createEmpresa: (formData: FormData) => Promise<void>;
  updateEmpresa: (formData: FormData) => Promise<void>;
  deleteEmpresa: (formData: FormData) => Promise<void>;
  returnTo?: string;
}) {
  const [nombre, setNombre] = useState(empresa?.nombre || "");
  const [email, setEmail] = useState(empresa?.email || "");
  const [telefono, setTelefono] = useState(empresa?.telefono || "");
  const [direccion, setDireccion] = useState(empresa?.direccion || "");
  const [sitioWeb, setSitioWeb] = useState(empresa?.sitioWeb || "");
  const [contacts, setContacts] = useState<ContactRow[]>(
    (contactos || []).map((c) => ({
      id: c.id,
      nombre: c.nombre || "",
      email: c.email || "",
      telefono: c.telefono || "",
      cargo: c.cargo || ""
    }))
  );
  const [principalKey, setPrincipalKey] = useState<string>(empresa?.contactoPrincipalId || "");

  const contactOptions = useMemo(
    () =>
      contacts.map((c) => {
        const key = c.id || c.tempId || "";
        const label = `${c.nombre || "Sin nombre"}${c.cargo ? ` · ${c.cargo}` : ""}`.trim();
        return { key, label };
      }),
    [contacts]
  );

  function addContact() {
    setContacts((prev) => [
      ...prev,
      {
        tempId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        nombre: "",
        email: "",
        telefono: "",
        cargo: ""
      }
    ]);
  }

  function updateContact(idx: number, patch: Partial<ContactRow>) {
    setContacts((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    );
  }

  function removeContact(idx: number) {
    setContacts((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (!next.some((c) => (c.id || c.tempId) === principalKey)) {
        setPrincipalKey("");
      }
      return next;
    });
  }

  const contactsJson = useMemo(() => JSON.stringify(contacts), [contacts]);
  const hasContacts = contacts.length > 0;

  return (
    <div className="panel module">
      <div className="panel-header ui-panel-header ui-panel-header-left">
        <div className="ui-panel-title">
          <h3 className="ui-title-reset">{empresa ? "Editar empresa" : "Nueva empresa"}</h3>
        </div>
      </div>

      <form
        action={empresa ? updateEmpresa : createEmpresa}
        onKeyDownCapture={enterToNextField}
        onSubmit={(e) => {
          e.currentTarget.classList.add("was-validated");
        }}
        className="ui-form-grid ui-grid-2 compact-form"
      >
        <input type="hidden" name="csrf" value={csrfToken} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        <input type="hidden" name="contactsJson" value={contactsJson} />
        <input type="hidden" name="contactoPrincipalKey" value={principalKey} />
        {empresa ? <input type="hidden" name="id" value={empresa.id} /> : null}

        <div className="field">
          <label>Nombre</label>
          <input className="input" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" />
        </div>
        <div className="field">
          <label>Teléfono</label>
          <input className="input" name="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+57..." />
        </div>
        <div className="field">
          <label>Sitio web</label>
          <input className="input" name="sitioWeb" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field grid-span-2">
          <label>Dirección</label>
          <input className="input" name="direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección completa" />
        </div>

        <div className="panel module grid-span-2">
          <div className="panel-header ui-panel-header">
            <div className="ui-panel-title">
              <h3 className="ui-title-reset">Contactos</h3>
            </div>
            <button className="ghost btn-compact btn-create btn-noicon" type="button" onClick={addContact}>
              Agregar contacto
            </button>
          </div>

          {hasContacts ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Cargo</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c, idx) => (
                    <tr key={c.id || c.tempId || idx}>
                      <td>
                        <input
                          className="input"
                          value={c.nombre}
                          onChange={(e) => updateContact(idx, { nombre: e.target.value })}
                          required
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          value={c.cargo}
                          onChange={(e) => updateContact(idx, { cargo: e.target.value })}
                          required
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="email"
                          value={c.email || ""}
                          onChange={(e) => updateContact(idx, { email: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          value={c.telefono || ""}
                          onChange={(e) => updateContact(idx, { telefono: e.target.value })}
                        />
                      </td>
                      <td>
                        <button className="ghost btn-compact btn-danger btn-noicon" type="button" onClick={() => removeContact(idx)}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="contact-empty">Aún no hay contactos. Agrega uno para continuar.</div>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>Contacto principal</label>
            <select
              className="select"
              value={principalKey}
              onChange={(e) => setPrincipalKey(e.target.value)}
              disabled={!hasContacts}
            >
              <option value="">Sin contacto principal</option>
              {contactOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="field-hint">Solo puedes elegir entre los contactos registrados en la empresa.</div>
          </div>
        </div>

        <div className="grid-span-2" style={{ display: "flex", gap: 10 }}>
          <button className="primary btn-create" type="submit">
            {empresa ? "Guardar cambios" : "Crear empresa"}
          </button>
          {empresa ? (
            <button className="ghost btn-compact btn-danger btn-noicon" type="submit" formAction={deleteEmpresa}>
              Eliminar empresa
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
