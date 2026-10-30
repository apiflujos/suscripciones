import { PageSection, PageShell } from "../../../ui/PageShell";
import "../../customers.css";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { fetchWompiAcceptanceLinks } from "../../../lib/wompiMerchant";
import { WompiTokenizeWidget } from "./WompiTokenizeWidget";
import { getAdminSettings } from "../../../admin/_services/settings";
import { getCustomerById } from "../../../admin/_services/customers";
import { hasActiveCustomerPaymentSource } from "@suscripciones/core/lib/customerMetadata";

export const dynamic = "force-dynamic";

export default async function CustomerPaymentMethodPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; returnTo?: string }>;
}) {
  const p = await params;
  const sp = (await searchParams) ?? {};
  const returnToRaw = String(sp.returnTo || "").trim();
  const returnTo =
    returnToRaw.startsWith("/billing") ||
    returnToRaw.startsWith("/customers") ||
    returnToRaw.startsWith("/subscriptions") ||
    returnToRaw.startsWith("/settings")
      ? returnToRaw
      : "";
  const [settings, customer] = await Promise.all([getAdminSettings(), getCustomerById(p.id)]);
  const activeEnv = String((settings as any)?.wompi?.activeEnv || "PRODUCTION").toUpperCase();
  const wompiEnv = activeEnv === "SANDBOX" ? (settings as any)?.wompi?.sandbox : (settings as any)?.wompi?.production;
  const publicKey = (() => {
    const raw = String(wompiEnv?.publicKey || "").trim();
    if (!raw || raw.toLowerCase() === "undefined" || raw.toLowerCase() === "null") return "";
    return raw;
  })();
  const apiBaseUrl =
    String(wompiEnv?.apiBaseUrl || "").trim() ||
    (activeEnv === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://api.wompi.co/v1");
  const acceptanceLinks = publicKey ? await fetchWompiAcceptanceLinks({ apiBaseUrl, publicKey }) : null;

  if (!customer) {
    return (
      <PageShell title="Contacto no encontrado" backHref={returnTo || "/customers"} backLabel="Volver">
        <PageSection>Contacto no encontrado.</PageSection>
      </PageShell>
    );
  }

  const hasToken = hasActiveCustomerPaymentSource(customer?.metadata);
  const label = customer.name || customer.email || customer.id;
  const errorText = normalizeErrorParam(sp.error);
  const backHref = returnTo || `/customers/${customer.id}`;

  return (
    <PageShell
      title="Método de pago (débito automático)"
      subtitle={label}
      crumbs={[{ label: "Contactos", href: "/customers" }, { label, href: `/customers/${customer.id}` }, { label: "Método de pago" }]}
      backHref={backHref}
      width="wide"
      notice={errorText ? { tone: "error", text: `Error: ${errorText}` } : null}
    >
      <PageSection
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{customer.email || customer.name || customer.id}</span>
            {hasToken ? <span className="pill pill-ok">Tokenizada</span> : <span className="pill pill-bad">Sin token</span>}
          </span>
        }
        description="Guarda un método de pago para poder cobrar suscripciones automáticamente. Requisito: configurar `Public key` en Credenciales > Wompi."
      >
        {!publicKey ? (
          <div className="customers-alert is-error">Falta `Public key` de Wompi en Configuración.</div>
        ) : !acceptanceLinks ? (
          <div className="customers-alert is-error">No pudimos cargar los términos de Wompi. Intenta más tarde.</div>
        ) : !customer.email ? (
          <div className="customers-alert is-error">Este contacto no tiene email. Wompi requiere `customer_email`.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="field-hint">
              Al guardar tarjeta, Wompi devolverá un `token` que se registrará como `paymentSourceId` en este contacto.
            </div>
            <form method="POST" action={`/customers/${customer.id}/payment-method/process`} style={{ display: "grid", gap: 10 }}>
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <WompiTokenizeWidget publicKey={publicKey} acceptance={acceptanceLinks} />
            </form>
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
