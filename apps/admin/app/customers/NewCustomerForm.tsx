"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { enterToNextField } from "../lib/enterToNext";
import { HelpTip } from "../ui/HelpTip";

type Municipality = { dept: string; city: string; code5: string; dane8: string };

type Props = {
  createCustomer: (formData: FormData) => Promise<void>;
  defaultOpen?: boolean;
  mode?: "toggle" | "always_open";
  hidePanelHeader?: boolean;
  returnTo?: string;
  csrfToken: string;
  tenantId?: string;
  tenants: Array<{ id: string; name: string }>;
};

export function NewCustomerForm({
  createCustomer,
  defaultOpen = false,
  mode = "toggle",
  hidePanelHeader = false,
  returnTo,
  csrfToken,
  tenantId,
  tenants
}: Props) {
  const alwaysOpen = mode === "always_open";
  const [open, setOpen] = useState(alwaysOpen ? true : Boolean(defaultOpen));
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Municipality[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dept, setDept] = useState("");
  const [city, setCity] = useState("");
  const [idType, setIdType] = useState("CC");
  const [idNumber, setIdNumber] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<string>(tenantId || "");
  const selectedTenantName =
    tenants.find((t) => String(t.id) === String(selectedTenant))?.name || "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/data/dane_municipios.json")
      .then((r) => {
        if (!r.ok) throw new Error(`dane_fetch_${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setItems(Array.isArray(json) ? (json as Municipality[]) : []);
        setLoadError(null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setItems([]);
        setLoadError(String(err?.message || "dane_fetch_failed"));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      nameRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (alwaysOpen) return;
    if (defaultOpen === false) setOpen(false);
  }, [defaultOpen, alwaysOpen]);

  const depts = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it?.dept) set.add(String(it.dept));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [items]);

  const cities = useMemo(() => {
    if (!dept) return [];
    return items
      .filter((it) => it.dept === dept)
      .map((it) => it.city)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [items, dept]);

  const selected = useMemo(() => {
    if (!dept || !city) return null;
    return items.find((it) => it.dept === dept && it.city === city) ?? null;
  }, [items, dept, city]);

  useEffect(() => {
    if (!dept) {
      if (city) setCity("");
      return;
    }
    if (city && !cities.includes(city)) setCity("");
  }, [dept, cities, city]);

  return (
    <div className="panel module">
      {!hidePanelHeader ? (
        <div className="panel-header ui-panel-header">
          <div className="ui-panel-title">
            <h3 className="ui-title-reset">Nuevo contacto</h3>
            <HelpTip text="Crea un contacto con datos básicos, dirección (DANE) e identificación." />
          </div>
          {alwaysOpen ? null : (
            <button className="primary btn-create" type="button" onClick={() => setOpen(true)}>
              Crear contacto
            </button>
          )}
        </div>
      ) : null}

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="panel-header ui-panel-header">
              <h3 className="ui-title-reset">Crear contacto</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form
              action={createCustomer}
              onKeyDownCapture={enterToNextField}
              onSubmit={(e) => {
                e.currentTarget.classList.add("was-validated");
              }}
              className="ui-form-grid"
            >
              <input type="hidden" name="csrf" value={csrfToken} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          <div className="field">
            <label>Canal de ventas</label>
            <select
              className="select select-compact"
              name="tenantId"
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              required
            >
              <option value="" disabled>
                Selecciona un canal
              </option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="field-hint">
              {selectedTenantName ? `Seleccionado: ${selectedTenantName}` : "Selecciona un canal para continuar."}
            </div>
          </div>
          <div className="field">
            <label>Nombre</label>
            <input ref={nameRef} className="input" name="name" placeholder="Nombre" required />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input className="input" name="phone" placeholder="+57..." required />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" name="email" type="email" placeholder="correo@empresa.com" required />
          </div>

          <div className="panel module">
            <div className="panel-header ui-panel-header">
              <div className="ui-panel-title">
                <h3 className="ui-title-reset">Dirección</h3>
                <HelpTip text="Selecciona departamento y municipio para guardar los códigos DANE." />
              </div>
            </div>

            {loadError ? (
              <div className="field-hint ui-alert-danger">
                No se pudo cargar DANE: {loadError}
              </div>
            ) : null}

            <div className="field">
              <label>Dirección</label>
              <input className="input" name="addressLine1" placeholder="Calle 123 # 45-67" />
            </div>
            <div className="field">
              <label>Departamento</label>
              <select className="select" name="dept" value={dept} disabled={loading} onChange={(e) => setDept(e.target.value)} required>
                <option value="">{loading ? "Cargando..." : "Selecciona"}</option>
                {depts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Municipio</label>
              <select className="select" name="city" value={city} disabled={loading || !dept} onChange={(e) => setCity(e.target.value)} required>
                <option value="">{!dept ? "Selecciona departamento" : loading ? "Cargando..." : "Selecciona"}</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <input type="hidden" name="code5" value={selected?.code5 ?? ""} />
            <input type="hidden" name="dane8" value={selected?.dane8 ?? ""} />
          </div>

          <div className="panel module">
            <div className="panel-header ui-panel-header">
              <div className="ui-panel-title">
                <h3 className="ui-title-reset">Identificación</h3>
                <HelpTip text="Opcional. Útil para búsquedas y para trazabilidad del cliente." />
              </div>
            </div>

            <div className="ui-grid-2-wide">
              <div className="field">
                <label>Tipo</label>
                <select className="select" name="idType" value={idType} onChange={(e) => setIdType(e.target.value)}>
                  <option value="CC">CC</option>
                  <option value="NIT">NIT</option>
                  <option value="CE">CE</option>
                  <option value="PP">PP</option>
                </select>
              </div>
              <div className="field">
                <label>Número</label>
                <input className="input" name="idNumber" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="123456789" />
              </div>
            </div>
          </div>

              <div className="module-footer">
                <button className="primary btn-save" type="submit">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
