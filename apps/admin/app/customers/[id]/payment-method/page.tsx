import Link from "next/link";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { fetchWompiAcceptanceLinks } from "../../../lib/wompiMerchant";
import { HelpTip } from "../../../ui/HelpTip";
import { WompiTokenizeWidget } from "./WompiTokenizeWidget";
import { getAdminSettings } from "../../../admin/_services/settings";
import { getCustomerById } from "../../../admin/_services/customers";
import { extractCustomerPaymentSourceId, readCustomerMetadata } from "../../../../../packages/core/src/lib/customerMetadata";

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
      <main className="page" style={{ maxWidth: 980 }}>
        <div className="card cardPad">Contacto no encontrado.</div>
        <Link className="btn" href="/customers">
          Volver
        </Link>
      </main>
    );
  }

  const hasToken = (() => {
    const meta = readCustomerMetadata(customer?.metadata);
    if (Number.isFinite(extractCustomerPaymentSourceId(meta))) return true;
    const sources = meta.wompi?.paymentSources;
    return Array.isArray(sources) && sources.length > 0;
  })();

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      {normalizeErrorParam(sp.error) ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {normalizeErrorParam(sp.error)}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Método de pago (débito automático)</h3>
              <HelpTip text="Guarda un método de pago para poder cobrar suscripciones automáticamente." />
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div className="panel module">
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{customer.email || customer.name || customer.id}</span>
                {hasToken ? (
                  <span className="pill pill-ok">Tokenizada</span>
                ) : (
                  <span className="pill pill-bad">Sin token</span>
                )}
              </h3>
              <span className="settings-group-title">
                <Link href="/customers" style={{ textDecoration: "underline" }}>
                  Volver
                </Link>
              </span>
            </div>

            <div className="field-hint" style={{ marginBottom: 10 }}>
              Requisito: configurar `Public key` en Credenciales &gt; Wompi.
            </div>

            {!publicKey ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                Falta `Public key` de Wompi en Configuración.
              </div>
            ) : !acceptanceLinks ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                No pudimos cargar los terminos de Wompi. Intenta mas tarde.
              </div>
            ) : !customer.email ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                Este contacto no tiene email. Wompi requiere `customer_email`.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field-hint">
                  Al guardar tarjeta, Wompi devolverá un `token` que se registrará como `paymentSourceId` en este contacto.
                </div>
                <form
                  method="POST"
                  action={`/customers/${customer.id}/payment-method/process`}
                  style={{ display: "grid", gap: 10 }}
                >
                  {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                  <WompiTokenizeWidget publicKey={publicKey} acceptance={acceptanceLinks} />
                </form>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
