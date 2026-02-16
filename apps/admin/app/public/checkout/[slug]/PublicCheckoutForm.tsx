"use client";

import { useMemo, useState } from "react";

type Template = {
  slug: string;
  kind: "PLAN" | "SUBSCRIPTION";
  allowPlanSelect: boolean;
  requireShipping?: boolean;
  requireAddress?: boolean;
  branding?: any;
  planId?: string | null;
};

type Plan = {
  id: string;
  name: string;
  priceInCents: number;
  currency: string;
  intervalUnit: string;
  intervalCount: number;
  imageUrl?: string | null;
  sku?: string | null;
};

type Config = {
  baseUrl?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  contactEmail?: string;
};

export function PublicCheckoutForm({
  template,
  plans,
  config
}: {
  template: Template;
  plans: Plan[];
  config: Config;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const brand = (template.branding || {}) as any;
  const title = brand.title || config.title || "Completa tus datos";
  const subtitle = brand.subtitle || config.subtitle || "Continuemos con el proceso";
  const description = brand.description || config.description || "";
  const contactEmail = brand.contactEmail || config.contactEmail || "";

  const plansOptions = useMemo(() => plans, [plans]);

  function formatCopFromCents(cents: number) {
    const pesos = Math.trunc(Number(cents || 0) / 100);
    if (!Number.isFinite(pesos)) return "";
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    if (template.allowPlanSelect && !String(formData.get("planId") || "").trim()) {
      setError("Selecciona un producto.");
      setLoading(false);
      return;
    }
    const payload = {
      customer: {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        phone: String(formData.get("phone") || "").trim() || undefined,
        document: String(formData.get("document") || "").trim() || undefined,
        documentNumber: String(formData.get("documentNumber") || "").trim() || undefined,
        address: template.requireAddress || template.requireShipping
          ? {
              line1: String(formData.get("addressLine1") || "").trim() || undefined,
              line2: String(formData.get("addressLine2") || "").trim() || undefined,
              city: String(formData.get("addressCity") || "").trim() || undefined,
              state: String(formData.get("addressState") || "").trim() || undefined,
              postalCode: String(formData.get("addressPostal") || "").trim() || undefined,
              country: String(formData.get("addressCountry") || "").trim() || undefined
            }
          : undefined
      },
      ...(template.allowPlanSelect ? { planId: String(formData.get("planId") || "").trim() } : {})
    } as any;

    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").trim();
      const endpoint = template.kind === "PLAN" ? "plan" : "subscription";
      const res = await fetch(`${apiBase}/public/checkout/${template.slug}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || "request_failed");
        setLoading(false);
        return;
      }
      if (template.kind === "PLAN") {
        const url = json?.checkoutUrl;
        if (url) {
          window.location.href = url;
          return;
        }
        setError("link_no_disponible");
      } else {
        const url = json?.tokenizationUrl;
        if (url) {
          window.location.href = url;
          return;
        }
        setError("tokenizacion_no_disponible");
      }
    } catch (err: any) {
      setError(err?.message ? String(err.message) : "request_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="publicCheckoutForm" onSubmit={onSubmit}>
      <div>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p style={{ marginTop: 6 }}>{subtitle}</p>
        {description ? <p className="field-hint">{description}</p> : null}
      </div>

      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}

      <div className="field">
        <label>Nombre completo</label>
        <input className="input" name="name" required />
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" name="email" type="email" required />
      </div>
      <div className="field">
        <label>Teléfono</label>
        <input className="input" name="phone" />
      </div>
      <div className="field">
        <label>Tipo de documento</label>
        <input className="input" name="document" placeholder="CC" />
      </div>
      <div className="field">
        <label>Número de documento</label>
        <input className="input" name="documentNumber" />
      </div>

      {template.allowPlanSelect ? (
        <div className="field">
          <label>Producto</label>
          <input type="hidden" name="planId" value={selectedPlanId} />
          <div className="publicProductGrid">
            {plansOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`publicProductCard ${selectedPlanId === p.id ? "is-active" : ""}`}
                onClick={() => setSelectedPlanId(p.id)}
                aria-pressed={selectedPlanId === p.id}
              >
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <div className="publicProductThumb">📦</div>}
                <div className="publicProductInfo">
                  <div className="publicProductName">{p.name}</div>
                  {p.sku ? <div className="publicProductSku">SKU: {p.sku}</div> : null}
                  <div className="publicProductPrice">{formatCopFromCents(p.priceInCents)}</div>
                </div>
              </button>
            ))}
          </div>
          {!selectedPlanId ? <div className="field-hint" style={{ color: "var(--danger)" }}>Selecciona un producto.</div> : null}
        </div>
      ) : null}

      {template.requireAddress || template.requireShipping ? (
        <div className="publicCheckoutAddress">
          <div className="field">
            <label>Dirección</label>
            <input className="input" name="addressLine1" />
          </div>
          <div className="field">
            <label>Complemento</label>
            <input className="input" name="addressLine2" />
          </div>
          <div className="field">
            <label>Ciudad</label>
            <input className="input" name="addressCity" />
          </div>
          <div className="field">
            <label>Departamento</label>
            <input className="input" name="addressState" />
          </div>
          <div className="field">
            <label>Código postal</label>
            <input className="input" name="addressPostal" />
          </div>
          <div className="field">
            <label>País</label>
            <input className="input" name="addressCountry" defaultValue="CO" />
          </div>
        </div>
      ) : null}

      <button className="primary" type="submit" disabled={loading}>
        {loading ? "Procesando..." : template.kind === "PLAN" ? "Ir a pagar" : "Tokenizar método"}
      </button>

      {contactEmail ? (
        <div className="field-hint">¿Necesitas ayuda? Escríbenos a {contactEmail}.</div>
      ) : null}
    </form>
  );
}
