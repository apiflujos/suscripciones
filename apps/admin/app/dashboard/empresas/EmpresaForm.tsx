"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { enterToNextField } from "../../lib/enterToNext";
import "../../empresas/empresa-form.css";

type ContactRow = {
  id?: string;
  tempId?: string;
  nombre: string;
  email?: string;
  telefono?: string;
  cargo: string;
  empresaNombre?: string;
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
  returnTo,
  cancelHref,
  deleteHref,
  hideHeader = false,
  tenantId
}: {
  empresa: Empresa | null;
  contactos: ContactRow[];
  csrfToken: string;
  createEmpresa: (formData: FormData) => Promise<void>;
  updateEmpresa: (formData: FormData) => Promise<void>;
  returnTo?: string;
  /** Enlace de "Cancelar" (por defecto, returnTo o /empresas). */
  cancelHref?: string;
  /** Página de confirmación para eliminar (dos pasos, sin modal). */
  deleteHref?: string;
  /** Oculta el título interno cuando la página ya lo trae (PageShell). */
  hideHeader?: boolean;
  tenantId?: string | null;
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
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ContactRow[]>([]);

  const contactOptions = useMemo(
    () =>
      contacts.map((c) => {
        const key = c.id || c.tempId || "";
        const label = `${c.nombre || "Sin nombre"}${c.cargo ? ` · ${c.cargo}` : ""}`.trim();
        return { key, label };
      }),
    [contacts]
  );

  useEffect(() => {
    const q = search.trim();
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("take", q ? "50" : "12");
      if (tenantId) params.set("tenantId", tenantId);
      fetch(`/api/search/contactos?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("search_failed"))))
        .then((data) => {
          if (cancelled) return;
          const items = Array.isArray(data?.items) ? data.items : [];
          setSearchResults(items);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchError("No se pudo buscar contactos.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, tenantId]);

  function addExistingContact(item: ContactRow) {
    if (!item?.id) return;
    setContacts((prev) => {
      if (prev.some((c) => c.id === item.id)) return prev;
      return [
        ...prev,
        {
          id: item.id,
          nombre: item.nombre || "",
          email: item.email || "",
          telefono: item.telefono || "",
          cargo: item.cargo || "",
          empresaNombre: item.empresaNombre
        }
      ];
    });
  }

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
      {hideHeader ? null : (
        <div className="panel-header ui-panel-header ui-panel-header-left">
          <div className="ui-panel-title">
            <h2 className="ui-title-reset">{empresa ? "Editar empresa" : "Nueva empresa"}</h2>
          </div>
        </div>
      )}

      <form
        action={empresa ? updateEmpresa : createEmpresa}
        onKeyDownCapture={enterToNextField}
        onSubmit={(e) => {
          e.currentTarget.classList.add("was-validated");
        }}
        className="ui-form-grid ui-grid-2 compact-form empresa-form"
      >
        <input type="hidden" name="csrf" value={csrfToken} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <input type="hidden" name="contactsJson" value={contactsJson} />
        <input type="hidden" name="contactoPrincipalKey" value={principalKey} />
        {empresa ? <input type="hidden" name="id" value={empresa.id} /> : null}

        <div className="field">
          <label htmlFor="emp-nombre">Nombre</label>
          <input id="emp-nombre" className="input" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="emp-email">Email</label>
          <input id="emp-email" className="input" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" />
        </div>
        <div className="field">
          <label htmlFor="emp-telefono">Teléfono</label>
          <input id="emp-telefono" className="input" name="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+57..." />
        </div>
        <div className="field">
          <label htmlFor="emp-sitioWeb">Sitio web</label>
          <input id="emp-sitioWeb" className="input" name="sitioWeb" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field grid-span-2">
          <label htmlFor="emp-direccion">Dirección</label>
          <input id="emp-direccion" className="input" name="direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección completa" />
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

          <div className="field" style={{ marginTop: 6 }}>
            <label htmlFor="emp-search">Buscar contacto existente</label>
            <input
              id="emp-search"
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, email, teléfono o cargo..."
            />
            <div className="field-hint">{search.trim() ? "Busca por nombre, email, teléfono o cargo." : "Mostrando contactos recientes del tenant."}</div>
          </div>
          {searching ? <div className="field-hint">Buscando...</div> : null}
          {searchError ? <div className="field-hint" style={{ color: "var(--bad)" }}>{searchError}</div> : null}
          {searchResults.length ? (
            <div className="table-wrap empresa-table" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Contacto</th>
                    <th>Cargo</th>
                    <th>Empresa</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((c) => (
                    <tr key={c.id || c.tempId}>
                      <td data-label="Contacto">
                        <div style={{ fontWeight: 600 }}>{c.nombre || "Sin nombre"}</div>
                        <div className="field-hint">{c.email || c.telefono || "—"}</div>
                      </td>
                      <td data-label="Cargo">{c.cargo || "—"}</td>
                      <td data-label="Empresa">{c.empresaNombre || "—"}</td>
                      <td className="empresa-row-action">
                        <button
                          className="ghost btn-compact btn-noicon"
                          type="button"
                          onClick={() => addExistingContact(c)}
                        >
                          Agregar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {hasContacts ? (
            <div className="table-wrap empresa-table">
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
                      <td data-label="Nombre">
                        <input
                          className="input"
                          aria-label="Nombre del contacto"
                          value={c.nombre}
                          onChange={(e) => updateContact(idx, { nombre: e.target.value })}
                          required
                        />
                      </td>
                      <td data-label="Cargo">
                        <input
                          className="input"
                          aria-label="Cargo del contacto"
                          value={c.cargo}
                          onChange={(e) => updateContact(idx, { cargo: e.target.value })}
                          required
                        />
                      </td>
                      <td data-label="Email">
                        <input
                          className="input"
                          aria-label="Email del contacto"
                          type="email"
                          value={c.email || ""}
                          onChange={(e) => updateContact(idx, { email: e.target.value })}
                        />
                      </td>
                      <td data-label="Teléfono">
                        <input
                          className="input"
                          aria-label="Teléfono del contacto"
                          value={c.telefono || ""}
                          onChange={(e) => updateContact(idx, { telefono: e.target.value })}
                        />
                      </td>
                      <td className="empresa-row-action">
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
            <label htmlFor="emp-principal">Contacto principal</label>
            <select
              id="emp-principal"
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

        <div className="module-footer">
          <Link
            className="ghost btn-compact btn-cancel"
            href={cancelHref || returnTo || "/empresas"}
            data-loader="off"
            title="Cancelar y volver"
          >
            Cancelar
          </Link>
          <button 
            className="primary btn-compact btn-save" 
            type="submit"
            title={empresa ? "Guardar cambios de la empresa" : "Crear nueva empresa"}
            aria-label={empresa ? "Guardar cambios" : "Crear empresa"}
          >
            {empresa ? "Guardar" : "Crear empresa"}
          </button>
          {empresa ? (
            <Link
              className="ghost btn-compact btn-red"
              href={deleteHref || `/empresas/${empresa.id}/delete`}
              data-loader="off"
              title="Eliminar empresa permanentemente"
            >
              Eliminar
            </Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}
