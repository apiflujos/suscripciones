import Link from "next/link";
import { createPaymentLink } from "./actions";

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

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams: { created?: string; link?: string; checkoutUrl?: string; error?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Suscripciones</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const [subs] = await Promise.all([fetchAdmin("/admin/subscriptions")]);
  const items = (subs.json?.items ?? []) as any[];

  function fmt(value: any) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  const order = ["PAST_DUE", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELED"];
  const grouped = items.reduce<Record<string, any[]>>((acc, s) => {
    const key = String(s.status || "UNKNOWN");
    acc[key] = acc[key] || [];
    acc[key].push(s);
    return acc;
  }, {});
  const groupKeys = [...order.filter((k) => grouped[k]?.length), ...Object.keys(grouped).filter((k) => !order.includes(k))];

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {searchParams.error}
        </div>
      ) : null}
      {searchParams.created ? <div className="card cardPad">Suscripción creada.</div> : null}
      {searchParams.link ? <div className="card cardPad">Link creado.</div> : null}
      {searchParams.checkoutUrl ? (
        <div className="card cardPad">
          Checkout:{" "}
          <a href={searchParams.checkoutUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            abrir link
          </a>
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Suscripciones</h3>
          <div className="field-hint">Listado y generación de links de pago.</div>
        </div>

        <div className="settings-group-body">
          <div className="panel module">
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3>Listado</h3>
              <span className="settings-group-title" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Link className="btn btnPrimary" href="/subscriptions/new">
                  Nueva suscripción
                </Link>
                <Link className="btn" href="/plans">
                  Planes
                </Link>
              </span>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {groupKeys.map((key) => (
                <div key={key} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <strong style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 12, color: "var(--muted)" }}>
                      {key}
                    </strong>
                    <span className="field-hint">{grouped[key].length}</span>
                  </div>

                  {grouped[key].map((s) => (
                    <div key={s.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <strong>{s.plan?.name ?? "Suscripción"}</strong>
                        <span className="field-hint">
                          {s.plan?.priceInCents ?? "—"} {s.plan?.currency ?? ""} / {s.plan?.intervalCount ?? "—"}{" "}
                          {s.plan?.intervalUnit ?? ""}
                          {s.plan?.metadata?.collectionMode ? ` · ${s.plan.metadata.collectionMode}` : ""}
                        </span>
                        <span className="field-hint">ciclo: {s.currentCycle}</span>
                        <form action={createPaymentLink} style={{ marginLeft: "auto" }}>
                          <input type="hidden" name="subscriptionId" value={s.id} />
                          <button className="ghost" type="submit">
                            Generar link
                          </button>
                        </form>
                      </div>
                      <div style={{ marginTop: 8, color: "var(--text)" }}>
                        cliente: {s.customer?.email || s.customer?.name || s.customerId}
                      </div>
                      <div className="field-hint" style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12 }}>
                        <span>activación: {fmt(s.startAt)}</span>
                        <span>próximo cobro (corte): {fmt(s.currentPeriodEndAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {items.length === 0 ? <div className="field-hint">Sin suscripciones.</div> : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
