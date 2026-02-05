import { createPaymentLink } from "../subscriptions/actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token: process.env.API_ADMIN_TOKEN || ""
  };
}

async function fetchAdmin(path: string) {
  const { apiBase, token } = getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

function fmtMoney(cents: any, currency = "COP") {
  const v = Number(cents);
  if (!Number.isFinite(v)) return "—";
  const pesos = Math.trunc(v / 100);
  if (currency !== "COP") return `${pesos} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

function fmtEvery(intervalUnit: any, intervalCount: any) {
  const unit = String(intervalUnit || "").toUpperCase();
  const count = Number(intervalCount || 1);
  const c = Number.isFinite(count) && count > 0 ? count : 1;
  if (unit === "DAY") return c === 1 ? "cada día" : `cada ${c} días`;
  if (unit === "WEEK") return c === 1 ? "cada semana" : `cada ${c} semanas`;
  if (unit === "MONTH") return c === 1 ? "cada mes" : `cada ${c} meses`;
  return `cada ${c} (personalizado)`;
}

export default async function BillingPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Planes y Suscripciones</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const created = typeof searchParams?.created === "string" ? searchParams.created : "";
  const checkoutUrl = typeof searchParams?.checkoutUrl === "string" ? searchParams.checkoutUrl : "";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";

  const subs = await fetchAdmin("/admin/subscriptions");
  const subItems = (subs.json?.items ?? []) as any[];

  const active = subItems.filter((s) => String(s.status || "") !== "CANCELED");
  const planes = active.filter((s) => String(s.plan?.metadata?.collectionMode || "MANUAL_LINK") !== "AUTO_DEBIT");
  const suscripciones = active.filter((s) => String(s.plan?.metadata?.collectionMode || "MANUAL_LINK") === "AUTO_DEBIT");

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
      {checkoutUrl ? (
        <div className="card cardPad">
          Checkout:{" "}
          <a href={checkoutUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            abrir link
          </a>
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
            <h3>Planes y Suscripciones</h3>
            <a className="btn btnPrimary" href="/products">
              Crear nuevo
            </a>
          </div>
          <div className="field-hint">Aquí solo se muestran los planes/suscripciones activos.</div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="panel module">
              <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h3>Planes</h3>
                <span className="settings-group-title">{planes.length} activos</span>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {planes.slice(0, 50).map((s) => (
                  <div key={s.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{s.plan?.name ?? "Plan"}</strong>
                      <span className="field-hint">{fmtMoney(s.plan?.priceInCents, s.plan?.currency)}</span>
                      <span className="field-hint">{fmtEvery(s.plan?.intervalUnit, s.plan?.intervalCount)}</span>
                      <span className="field-hint">{s.status}</span>
                      <form action={createPaymentLink} style={{ marginLeft: "auto" }}>
                        <input type="hidden" name="subscriptionId" value={s.id} />
                        <button className="ghost" type="submit">
                          Generar link
                        </button>
                      </form>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      contacto: {s.customer?.email || s.customer?.name || s.customerId} · corte:{" "}
                      {s.currentPeriodEndAt ? new Date(s.currentPeriodEndAt).toLocaleString() : "—"}
                    </div>
                  </div>
                ))}
                {planes.length === 0 ? <div className="field-hint">Sin planes activos.</div> : null}
              </div>
            </div>

            <div className="panel module">
              <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h3>Suscripciones</h3>
                <span className="settings-group-title">{suscripciones.length} activas</span>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {suscripciones.slice(0, 50).map((s) => (
                  <div key={s.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{s.plan?.name ?? "Suscripción"}</strong>
                      <span className="field-hint">{fmtMoney(s.plan?.priceInCents, s.plan?.currency)}</span>
                      <span className="field-hint">{fmtEvery(s.plan?.intervalUnit, s.plan?.intervalCount)}</span>
                      <span className="field-hint">{s.status}</span>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      contacto: {s.customer?.email || s.customer?.name || s.customerId} · cobro:{" "}
                      {s.currentPeriodEndAt ? new Date(s.currentPeriodEndAt).toLocaleString() : "—"}
                    </div>
                  </div>
                ))}
                {suscripciones.length === 0 ? <div className="field-hint">Sin suscripciones activas.</div> : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
