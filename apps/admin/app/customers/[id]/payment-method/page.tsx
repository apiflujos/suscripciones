import Link from "next/link";
import { WompiTokenizeWidget } from "./WompiTokenizeWidget";
import { fetchAdminCached, getAdminApiConfig } from "../../../lib/adminApi";
import { HelpTip } from "../../../ui/HelpTip";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchAdmin(path: string) {
  return fetchAdminCached(path, { ttlMs: 1500 });
}

export default async function CustomerPaymentMethodPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Método de pago</h1>
        <p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`) en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const [settings, customers] = await Promise.all([fetchAdmin("/admin/settings"), fetchAdmin("/admin/customers")]);
  const publicKey = String(settings.json?.wompi?.publicKey || "").trim();
  const items = (customers.json?.items ?? []) as any[];
  const customer = items.find((c) => c.id === params.id);

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

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {searchParams.error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Método de pago (tokenización)</h3>
              <HelpTip text="Guarda un método de pago para poder cobrar suscripciones automáticamente." />
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div className="panel module">
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3>{customer.email || customer.name || customer.id}</h3>
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
            ) : !customer.email ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                Este contacto no tiene email. Wompi requiere `customer_email`.
              </div>
            ) : (
              <form method="POST" action={`/customers/${customer.id}/payment-method/process`} style={{ display: "grid", gap: 10 }}>
                <div className="field-hint">
                  Al tokenizar, Wompi devolverá un `token` que se registrará como `paymentSourceId` en este contacto.
                </div>
                <WompiTokenizeWidget publicKey={publicKey} />
              </form>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
