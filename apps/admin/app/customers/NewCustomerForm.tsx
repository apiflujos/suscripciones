"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { enterToNextField } from "../lib/enterToNext";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { FormActions, PageSection } from "../ui/PageShell";
import "./customers.css";

type Municipality = { dept: string; city: string; code5: string; dane8: string };

type Props = {
  createCustomer: (formData: FormData) => Promise<void>;
  returnTo?: string;
  /** Dónde mostrar un error de validación (por defecto, en returnTo). */
  errorReturnTo?: string;
  /** Con enlace de cancelar se pinta la barra de acciones de página; sin él, solo "Guardar". */
  cancelHref?: string;
  csrfToken: string;
  tenantId?: string;
  tenants: Array<{ id: string; name: string }>;
  /** @deprecated Ya no hay modal ni panel plegable; se ignoran. */
  defaultOpen?: boolean;
  /** @deprecated */
  mode?: "toggle" | "always_open";
  /** @deprecated */
  hidePanelHeader?: boolean;
  /** @deprecated */
  useModal?: boolean;
};

/**
 * Formulario "Crear contacto". Es una página (/customers/new), no un modal: el
 * llamador decide el retorno y, al guardar, la acción redirige ahí con
 * `selectCustomerId=<id nuevo>`.
 */
export function NewCustomerForm({ createCustomer, returnTo, errorReturnTo, cancelHref, csrfToken, tenantId, tenants }: Props) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Municipality[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dept, setDept] = useState("");
  const [city, setCity] = useState("");
  const [idType, setIdType] = useState("CC");
  const [idNumber, setIdNumber] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<string>(tenantId || "");
  const selectedTenantName = tenants.find((t) => String(t.id) === String(selectedTenant))?.name || "";

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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

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

  const submit = (
    <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
      Guardar
    </PendingButton>
  );

  return (
    <form
      action={createCustomer}
      onKeyDownCapture={enterToNextField}
      onSubmit={(e) => e.currentTarget.classList.add("was-validated")}
      className="page-shell-body"
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {errorReturnTo ? <input type="hidden" name="errorReturnTo" value={errorReturnTo} /> : null}

      <PageSection title="Datos básicos" description="Con teléfono o email basta para crear el contacto.">
        <div className="page-shell-form-grid">
          <div className="field field-full">
            <label htmlFor="cust-tenant">Canal de ventas</label>
            <select
              id="cust-tenant"
              className="select"
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
            <label htmlFor="cust-name">Nombre</label>
            <input id="cust-name" ref={nameRef} className="input" name="name" placeholder="Nombre" required />
          </div>
          <div className="field">
            <label htmlFor="cust-phone">Teléfono</label>
            <input id="cust-phone" className="input" name="phone" type="tel" placeholder="+57..." required />
          </div>
          <div className="field field-full">
            <label htmlFor="cust-email">Email</label>
            <input id="cust-email" className="input" name="email" type="email" placeholder="correo@empresa.com" required />
          </div>
        </div>
      </PageSection>

      <PageSection
        title={
          <span className="customers-inline-title">
            Dirección <HelpTip text="Selecciona departamento y municipio para guardar los códigos DANE." />
          </span>
        }
      >
        {loadError ? <div className="customers-alert is-error">No se pudo cargar DANE: {loadError}</div> : null}
        <div className="page-shell-form-grid">
          <div className="field field-full">
            <label htmlFor="cust-address">Dirección</label>
            <input id="cust-address" className="input" name="addressLine1" placeholder="Calle 123 # 45-67" />
          </div>
          <div className="field">
            <label htmlFor="cust-dept">Departamento</label>
            <select id="cust-dept" className="select" name="dept" value={dept} disabled={loading} onChange={(e) => setDept(e.target.value)} required>
              <option value="">{loading ? "Cargando..." : "Selecciona"}</option>
              {depts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cust-city">Municipio</label>
            <select id="cust-city" className="select" name="city" value={city} disabled={loading || !dept} onChange={(e) => setCity(e.target.value)} required>
              <option value="">{!dept ? "Selecciona departamento" : loading ? "Cargando..." : "Selecciona"}</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input type="hidden" name="code5" value={selected?.code5 ?? ""} />
        <input type="hidden" name="dane8" value={selected?.dane8 ?? ""} />
      </PageSection>

      <PageSection
        title={
          <span className="customers-inline-title">
            Identificación <HelpTip text="Opcional. Útil para búsquedas y para trazabilidad del cliente." />
          </span>
        }
      >
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="cust-idtype">Tipo</label>
            <select id="cust-idtype" className="select" name="idType" value={idType} onChange={(e) => setIdType(e.target.value)}>
              <option value="CC">CC</option>
              <option value="NIT">NIT</option>
              <option value="CE">CE</option>
              <option value="PP">PP</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cust-idnumber">Número</label>
            <input id="cust-idnumber" className="input" name="idNumber" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="123456789" />
          </div>
        </div>
      </PageSection>

      {cancelHref ? (
        <FormActions cancelHref={cancelHref}>{submit}</FormActions>
      ) : (
        <div className="module-footer">{submit}</div>
      )}
    </form>
  );
}
