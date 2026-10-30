"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormActions, PageSection } from "../ui/PageShell";
import "./customers.css";

type CustomerRow = {
  id: string;
  tenantId?: string | null;
  tenantIds?: string[];
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: any;
};

function describeError(code: string) {
  if (code === "contacto_requerido") return "Ingresa al menos un teléfono o un email.";
  if (code === "telefono_invalido") return "El teléfono no es válido. Incluye el indicativo, por ejemplo +57 300 123 4567.";
  if (code === "invalid_id") return "No se encontró el contacto.";
  return code || "Error guardando el contacto";
}

/**
 * Formulario de /customers/[id]/edit. Era el modal "Editar contacto": mismos campos
 * y misma acción (`updateCustomer`); al guardar vuelve a `returnTo`.
 */
export function CustomerEditForm({
  customer,
  tenants,
  csrfToken,
  returnTo,
  updateCustomer
}: {
  customer: CustomerRow;
  tenants: Array<{ id: string; name: string }>;
  csrfToken: string;
  returnTo: string;
  updateCustomer: (formData: FormData) => Promise<{ ok: boolean; error?: string; redirectTo?: string }>;
}) {
  const router = useRouter();
  const meta = customer.metadata || {};
  const initialTenantIds = Array.from(
    new Set(
      [...(Array.isArray(customer.tenantIds) ? customer.tenantIds : []), String(customer.tenantId || "")]
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  );
  const [name, setName] = useState(customer.name || "");
  const [email, setEmail] = useState(customer.email || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [idType, setIdType] = useState(String(meta.identificacionTipo || ""));
  const [idNumber, setIdNumber] = useState(String(meta.identificacionNumero || meta.identificacion || ""));
  const [addressLine1, setAddressLine1] = useState(String(meta.address?.line1 || ""));
  const [dept, setDept] = useState(String(meta.address?.dept || ""));
  const [city, setCity] = useState(String(meta.address?.city || ""));
  const [code5, setCode5] = useState(String(meta.address?.code5 || ""));
  const [dane8, setDane8] = useState(String(meta.address?.dane8 || ""));
  const [tenantIds, setTenantIds] = useState<string[]>(initialTenantIds);
  const [primaryTenantId, setPrimaryTenantId] = useState<string>(
    initialTenantIds.includes(String(customer.tenantId || "")) ? String(customer.tenantId || "") : initialTenantIds[0] || ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTenant(id: string, checked: boolean) {
    if (checked) {
      setTenantIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      if (!primaryTenantId) setPrimaryTenantId(id);
      return;
    }
    const next = tenantIds.filter((t) => t !== id);
    setTenantIds(next);
    if (primaryTenantId === id) setPrimaryTenantId(next[0] || "");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTenantIds = Array.from(new Set(tenantIds.map((v) => String(v || "").trim()).filter(Boolean)));
    const nextPrimary =
      primaryTenantId && normalizedTenantIds.includes(primaryTenantId) ? primaryTenantId : normalizedTenantIds[0] || "";
    if (!normalizedTenantIds.length) {
      setError("Selecciona al menos un canal");
      return;
    }

    const formData = new FormData();
    formData.set("csrf", csrfToken);
    formData.set("id", customer.id);
    formData.set("name", name);
    formData.set("email", email);
    formData.set("phone", phone);
    formData.set("idType", idType);
    formData.set("idNumber", idNumber);
    formData.set("addressLine1", addressLine1);
    formData.set("dept", dept);
    formData.set("city", city);
    formData.set("code5", code5);
    formData.set("dane8", dane8);
    formData.set("scopeTenantId", String(customer.tenantId || normalizedTenantIds[0] || ""));
    for (const tenantId of normalizedTenantIds) formData.append("tenantIds", tenantId);
    formData.set("primaryTenantId", nextPrimary);
    formData.set("returnTo", returnTo);

    setSaving(true);
    setError(null);
    try {
      const result = await updateCustomer(formData);
      if (!result?.ok) {
        setError(describeError(String(result?.error || "")));
        return;
      }
      router.replace(result.redirectTo || returnTo);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Error guardando el contacto");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="page-shell-body" onSubmit={onSubmit}>
      <PageSection title="Información básica">
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="edit-name">Nombre completo</label>
            <input id="edit-name" className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del contacto" />
          </div>
          <div className="field">
            <label htmlFor="edit-phone">Teléfono</label>
            <input id="edit-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 123 4567" />
          </div>
          <div className="field field-full">
            <label htmlFor="edit-email">Email</label>
            <input id="edit-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
          </div>
        </div>
      </PageSection>

      <PageSection title="Identificación">
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="edit-idtype">Tipo</label>
            <select id="edit-idtype" className="select" value={idType} onChange={(e) => setIdType(e.target.value)}>
              <option value="">Seleccionar</option>
              <option value="CC">Cédula de Ciudadanía</option>
              <option value="CE">Cédula de Extranjería</option>
              <option value="NIT">NIT</option>
              <option value="PASAPORTE">Pasaporte</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-idnumber">Número</label>
            <input id="edit-idnumber" className="input" type="text" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Número de identificación" />
          </div>
        </div>
      </PageSection>

      <PageSection title="Dirección">
        <div className="page-shell-form-grid">
          <div className="field field-full">
            <label htmlFor="edit-address">Dirección</label>
            <input id="edit-address" className="input" type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Calle 123 #45-67" />
          </div>
          <div className="field">
            <label htmlFor="edit-dept">Departamento</label>
            <input id="edit-dept" className="input" type="text" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Bogotá D.C." />
          </div>
          <div className="field">
            <label htmlFor="edit-city">Ciudad</label>
            <input id="edit-city" className="input" type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bogotá" />
          </div>
          <div className="field">
            <label htmlFor="edit-dane">Código DANE</label>
            <input id="edit-dane" className="input" type="text" value={dane8} onChange={(e) => setDane8(e.target.value)} placeholder="11001" />
          </div>
        </div>
      </PageSection>

      <PageSection title="Canales" description="El contacto puede pertenecer a varios canales; el principal es el que se usa por defecto.">
        <fieldset className="customers-channels">
          <legend className="customers-sr-only">Canales del contacto</legend>
          {tenants.map((tenant) => (
            <label key={tenant.id} className="customers-channel">
              <input type="checkbox" checked={tenantIds.includes(tenant.id)} onChange={(e) => toggleTenant(tenant.id, e.target.checked)} />
              <span>{tenant.name}</span>
              {primaryTenantId === tenant.id ? <span className="pill pill-sm pill-ok">Principal</span> : null}
            </label>
          ))}
        </fieldset>
        {tenantIds.length > 1 ? (
          <div className="field">
            <label htmlFor="edit-primary-tenant">Canal principal</label>
            <select id="edit-primary-tenant" className="select" value={primaryTenantId} onChange={(e) => setPrimaryTenantId(e.target.value)}>
              {tenantIds.map((id) => (
                <option key={id} value={id}>
                  {tenants.find((t) => t.id === id)?.name || id}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {tenantIds.length === 0 ? <div className="field-hint">Selecciona al menos un canal</div> : null}
      </PageSection>

      {error ? (
        <div className="customers-alert is-error" role="alert">
          {error}
        </div>
      ) : null}

      <FormActions cancelHref={returnTo}>
        <button className="primary btn-compact btn-save" type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </FormActions>
    </form>
  );
}
