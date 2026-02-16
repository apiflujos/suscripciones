"use client";

import { useEffect, useMemo, useState } from "react";
import { FIELD_PRESETS } from "../../../public-checkout/fieldOptions";
import { PHONE_COUNTRIES } from "../../../public-checkout/phoneCountries";

type Template = {
  slug: string;
  kind: "PLAN" | "SUBSCRIPTION";
  allowPlanSelect: boolean;
  requireShipping?: boolean;
  requireAddress?: boolean;
  branding?: any;
  planId?: string | null;
  layout?: any;
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

type FieldSection = {
  id: string;
  type: string;
  enabled?: boolean;
  props?: Record<string, any>;
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
  useEffect(() => {
    if (!template.allowPlanSelect) return;
    if (selectedPlanId) return;
    if (plansOptions.length) setSelectedPlanId(plansOptions[0].id);
  }, [template.allowPlanSelect, plansOptions, selectedPlanId]);

  const fallbackSections: FieldSection[] = [
    { id: "header", type: "header", enabled: true, props: {} },
    { id: "products", type: "products", enabled: true, props: {} },
    ...FIELD_PRESETS.map((preset) => ({
      id: `field-${preset.key}`,
      type: "field",
      enabled: true,
      props: preset
    })),
    { id: "cta", type: "cta", enabled: true, props: {} },
    { id: "footer", type: "footer", enabled: true, props: {} }
  ];

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
    const nameFromForm = String(formData.get("name") || "").trim();
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phoneCountry = String(formData.get("phoneCountry") || "").trim();
    const phoneRaw = String(formData.get("phone") || "").trim();
    const dialCode = phoneCountry.replace(/[^\d]/g, "");
    const phoneDigits = phoneRaw.replace(/[^\d]/g, "");
    const phone = phoneDigits ? `+${dialCode}${phoneDigits}` : "";
    const document = String(formData.get("documentType") || "").trim();
    const documentNumber = String(formData.get("documentNumber") || "").trim();
    const addressLine1 = String(formData.get("addressLine1") || "").trim();
    const addressCity = String(formData.get("addressCity") || "").trim();
    const addressState = String(formData.get("addressState") || "").trim();
    const paymentReference = String(formData.get("paymentReference") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    const payload = {
      customer: {
        name: nameFromForm || [firstName, lastName].filter(Boolean).join(" ").trim(),
        email,
        phone: phone || undefined,
        document: document || undefined,
        documentNumber: documentNumber || undefined,
        metadata: {
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(phoneCountry ? { phoneCountry } : {}),
          ...(paymentReference ? { paymentReference } : {}),
          ...(notes ? { notes } : {})
        },
        address: addressLine1 || addressCity || addressState
          ? {
              line1: addressLine1 || undefined,
              city: addressCity || undefined,
              state: addressState || undefined,
              country: "CO"
            }
          : undefined
      },
      ...(template.allowPlanSelect ? { planId: String(formData.get("planId") || "").trim() } : {})
    } as any;

    if (!payload.customer.name) {
      setError("Completa el nombre.");
      setLoading(false);
      return;
    }
    if (!payload.customer.email) {
      setError("Completa el email.");
      setLoading(false);
      return;
    }

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

  function renderProductsBlock(titleOverride?: string) {
    if (template.allowPlanSelect) {
      return (
        <div className="field">
          {titleOverride ? <label>{titleOverride}</label> : <label>Producto</label>}
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
      );
    }
    const fixedPlan = plansOptions[0];
    if (!fixedPlan) return null;
    return (
      <div className="field">
        {titleOverride ? <label>{titleOverride}</label> : <label>Producto</label>}
        <div className="publicProductGrid">
          <div className="publicProductCard is-active" aria-pressed="true">
            {fixedPlan.imageUrl ? <img src={fixedPlan.imageUrl} alt={fixedPlan.name} /> : <div className="publicProductThumb">📦</div>}
            <div className="publicProductInfo">
              <div className="publicProductName">{fixedPlan.name}</div>
              {fixedPlan.sku ? <div className="publicProductSku">SKU: {fixedPlan.sku}</div> : null}
              <div className="publicProductPrice">{formatCopFromCents(fixedPlan.priceInCents)}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderFieldSection(section: FieldSection) {
    const props = section.props || {};
    const label = props.label || "";
    const required = Boolean(props.required);
    const input = props.input || "text";
    const key = props.key || "";
    if (!key) return null;

    if (key === "phone") {
      return (
        <div className="field">
          <label>{label || "Teléfono"}</label>
          <div className="phone-row">
            <select className="select phone-country" name="phoneCountry" defaultValue="+57" required={required}>
              {PHONE_COUNTRIES.map((c) => (
                <option key={`${c.iso2}-${c.dialCode}`} value={`+${c.dialCode}`}>
                  {c.label}
                </option>
              ))}
            </select>
            <input className="input" name="phone" inputMode="tel" placeholder="300 000 0000" required={required} />
          </div>
        </div>
      );
    }

    if (input === "select") {
      return (
        <div className="field">
          <label>{label}</label>
          <select className="select" name={key === "idType" ? "documentType" : key === "department" ? "addressState" : key} required={required}>
            <option value="">Selecciona...</option>
            {(props.options || []).map((opt: any) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (input === "textarea") {
      return (
        <div className="field">
          <label>{label}</label>
          <textarea className="input" name={key} rows={3} />
        </div>
      );
    }

    const name =
      key === "address"
        ? "addressLine1"
        : key === "city"
          ? "addressCity"
          : key === "idNumber"
            ? "documentNumber"
            : key;
    const type = input === "email" ? "email" : "text";

    return (
      <div className="field">
        <label>{label}</label>
        <input className="input" name={name} type={type} required={required} />
      </div>
    );
  }

  function renderHeaderBlock(props: any) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>{props?.title || title}</h1>
        <p style={{ marginTop: 6 }}>{props?.subtitle || subtitle}</p>
        {description ? <p className="field-hint">{description}</p> : null}
      </div>
    );
  }

  function renderFooterBlock(props: any) {
    return (
      <div className="field-hint">
        {props?.text || contactEmail ? `¿Necesitas ayuda? Escríbenos a ${contactEmail}.` : ""}
      </div>
    );
  }

  const layoutSections: FieldSection[] = Array.isArray(template.layout?.sections)
    ? (template.layout.sections as FieldSection[])
    : fallbackSections;
  const ctaLabel = useMemo(() => {
    const cta = layoutSections.find((section: FieldSection) => section.type === "cta");
    const label = cta?.props?.label;
    return label || (template.kind === "PLAN" ? "Pagar" : "Guardar y pagar");
  }, [layoutSections, template.kind]);

  return (
    <form className="publicCheckoutForm" onSubmit={onSubmit}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}

      {layoutSections.map((section: any) => {
        if (section?.enabled === false) return null;
        if (section?.type === "header") return <div key={section.id}>{renderHeaderBlock(section.props)}</div>;
        if (section?.type === "products") return <div key={section.id}>{renderProductsBlock(section.props?.title)}</div>;
        if (section?.type === "field") return <div key={section.id}>{renderFieldSection(section)}</div>;
        if (section?.type === "form") {
          return (
            <div key={section.id}>
              {FIELD_PRESETS.map((preset) => renderFieldSection({ id: preset.key, type: "field", enabled: true, props: preset }))}
            </div>
          );
        }
        if (section?.type === "cta") {
          return (
            <button key={section.id} className="primary" type="submit" disabled={loading}>
              {loading ? "Procesando..." : ctaLabel}
            </button>
          );
        }
        if (section?.type === "footer") return <div key={section.id}>{renderFooterBlock(section.props)}</div>;
        return null;
      })}
      {template.requireAddress || template.requireShipping ? (
        <div className="field-hint" style={{ marginTop: 6 }}>
          El envío/dirección se solicita directamente en Wompi.
        </div>
      ) : null}
    </form>
  );
}
