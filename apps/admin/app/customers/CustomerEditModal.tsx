"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PendingButton } from "../ui/PendingButton";
import { AppModal } from "../ui/AppModal";

type CustomerRow = {
  id: string;
  tenantId?: string | null;
  tenantIds?: string[];
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: any;
};

export function CustomerEditModal({
  customer,
  tenants,
  csrfToken,
  returnTo,
  updateCustomer,
  open,
  onClose
}: {
  customer: CustomerRow | null;
  tenants: Array<{ id: string; name: string }>;
  csrfToken: string;
  returnTo: string;
  updateCustomer: (formData: FormData) => Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }>;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [dept, setDept] = useState("");
  const [city, setCity] = useState("");
  const [code5, setCode5] = useState("");
  const [dane8, setDane8] = useState("");
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [primaryTenantId, setPrimaryTenantId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !customer) return;

    setError(null);
    setName(customer.name || "");
    setEmail(customer.email || "");
    setPhone(customer.phone || "");
    setIdType(String(customer.metadata?.identificacionTipo || ""));
    setIdNumber(String(customer.metadata?.identificacionNumero || customer.metadata?.identificacion || ""));
    setAddressLine1(String(customer.metadata?.address?.line1 || ""));
    setDept(String(customer.metadata?.address?.dept || ""));
    setCity(String(customer.metadata?.address?.city || ""));
    setCode5(String(customer.metadata?.address?.code5 || ""));
    setDane8(String(customer.metadata?.address?.dane8 || ""));
    
    const uniqueTenantIds = Array.from(
      new Set(
        [...(Array.isArray(customer.tenantIds) ? customer.tenantIds : []), String(customer.tenantId || "")]
          .map((v) => String(v || "").trim())
          .filter(Boolean)
      )
    );
    setTenantIds(uniqueTenantIds);
    setPrimaryTenantId(uniqueTenantIds.includes(String(customer.tenantId || "")) ? String(customer.tenantId || "") : uniqueTenantIds[0] || "");
  }, [open, customer]);

  const handleSave = async () => {
    const normalizedTenantIds = Array.from(new Set(tenantIds.map((value) => String(value || "").trim()).filter(Boolean)));
    const nextPrimaryTenantId =
      String(primaryTenantId || "").trim() && normalizedTenantIds.includes(String(primaryTenantId || "").trim())
        ? String(primaryTenantId || "").trim()
        : normalizedTenantIds[0] || "";

    if (!normalizedTenantIds.length) {
      setError("Selecciona al menos un canal");
      return;
    }

    const formData = new FormData();
    formData.set("csrf", csrfToken);
    formData.set("id", customer?.id || "");
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
    formData.set("scopeTenantId", String(customer?.tenantId || normalizedTenantIds[0] || ""));
    for (const tenantId of normalizedTenantIds) formData.append("tenantIds", tenantId);
    formData.set("primaryTenantId", nextPrimaryTenantId);
    if (returnTo) formData.set("returnTo", returnTo);

    setSaving(true);
    setError(null);
    try {
      const result = await updateCustomer(formData);
      if (!result.ok) {
        setError(result.error || "Error guardando el contacto");
        return;
      }
      onClose();
      router.replace(result.redirectTo);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Error guardando el contacto");
    } finally {
      setSaving(false);
    }
  };

  if (!open || !customer) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Editar contacto"
      width="min(900px, 96vw)"
      panelClassName="customer-edit-modal"
      footer={
        <>
          {error && (
            <div style={{ flex: 1, color: "var(--danger)", fontSize: 12, fontWeight: 500 }}>
              {error}
            </div>
          )}
          <button className="ghost btn-compact" type="button" onClick={onClose}>Cancelar</button>
          <PendingButton className="primary btn-compact" type="button" pendingText="Guardando..." onClick={handleSave} disabled={saving}>
            Guardar cambios
          </PendingButton>
        </>
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
          {/* 1. Información básica */}
          <section className="card cardPad" style={{ padding: "12px" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600 }}>Información básica</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label className="field-label">Nombre completo</label>
                <input
                  className="input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nombre del contacto"
                />
              </div>
              <div className="field">
                <label className="field-label">Teléfono</label>
                <input
                  className="input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+57 300 123 4567"
                />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label className="field-label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                />
              </div>
            </div>
          </section>

          {/* 2. Identificación */}
          <section className="card cardPad" style={{ padding: "12px" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600 }}>Identificación</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <div className="field">
                <label className="field-label">Tipo</label>
                <select
                  className="select"
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  <option value="CC">Cédula de Ciudadanía</option>
                  <option value="CE">Cédula de Extranjería</option>
                  <option value="NIT">NIT</option>
                  <option value="PASAPORTE">Pasaporte</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Número</label>
                <input
                  className="input"
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder="Número de identificación"
                />
              </div>
            </div>
          </section>

          {/* 3. Dirección */}
          <section className="card cardPad" style={{ padding: "12px" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600 }}>Dirección</h4>
            <div style={{ display: "grid", gap: 12 }}>
              <div className="field">
                <label className="field-label">Dirección</label>
                <input
                  className="input"
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  placeholder="Calle 123 #45-67"
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label className="field-label">Departamento</label>
                  <input
                    className="input"
                    type="text"
                    value={dept}
                    onChange={(e) => setDept(e.target.value)}
                    placeholder="Bogotá D.C."
                  />
                </div>
                <div className="field">
                  <label className="field-label">Ciudad</label>
                  <input
                    className="input"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Bogotá"
                  />
                </div>
                <div className="field">
                  <label className="field-label">Código DANE</label>
                  <input
                    className="input"
                    type="text"
                    value={dane8}
                    onChange={(e) => setDane8(e.target.value)}
                    placeholder="11001"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 4. Canales */}
          <section className="card cardPad" style={{ padding: "12px" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600 }}>Canales</h4>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tenants.map((tenant) => {
                  const isSelected = tenantIds.includes(tenant.id);
                  const isPrimary = primaryTenantId === tenant.id;
                  return (
                    <button
                      key={tenant.id}
                      type="button"
                      className={`pill ${isSelected ? "is-active" : ""} ${isPrimary ? "pill-primary" : ""}`}
                      onClick={() => {
                        if (isSelected) {
                          if (tenantIds.length > 1) {
                            setTenantIds(tenantIds.filter((id) => id !== tenant.id));
                            if (isPrimary) {
                              setPrimaryTenantId(tenantIds.find((id) => id !== tenant.id) || "");
                            }
                          }
                        } else {
                          setTenantIds([...tenantIds, tenant.id]);
                          if (!primaryTenantId) {
                            setPrimaryTenantId(tenant.id);
                          }
                        }
                      }}
                    >
                      {tenant.name}
                      {isPrimary && " (Principal)"}
                    </button>
                  );
                })}
              </div>
              {tenantIds.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>Selecciona al menos un canal</div>
              )}
            </div>
          </section>
      </div>
    </AppModal>
  );
}
