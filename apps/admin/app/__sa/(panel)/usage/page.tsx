import { saAdminFetch } from "../../saApi";
import { consumeTest, resetCounters } from "./actions";
import { getCsrfToken } from "../../../lib/csrf";

function monthKeyUtc(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function fmtMoneyCop(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(0);
  return new Intl.NumberFormat("es-CO").format(Number(v));
}

export default async function SaUsagePage({
  searchParams
}: {
  searchParams?: { tenantId?: string; periodKey?: string; error?: string; reset?: string };
}) {
  const csrfToken = await getCsrfToken();
  const error = String(searchParams?.error || "").trim();
  const tenantId = String(searchParams?.tenantId || "").trim();
  const periodKey = String(searchParams?.periodKey || "").trim() || monthKeyUtc(new Date());

  const tenantsRes = await saAdminFetch("/admin/sa/tenants", { method: "GET" });
  const tenants: any[] = tenantsRes.ok ? tenantsRes.json?.items || [] : [];

  const usageRes = tenantId
    ? await saAdminFetch(`/admin/sa/usage?tenantId=${encodeURIComponent(tenantId)}&periodKey=${encodeURIComponent(periodKey)}`, { method: "GET" })
    : null;

  const items: any[] = usageRes && usageRes.ok ? usageRes.json?.items || [] : [];
  const totals = usageRes && usageRes.ok ? usageRes.json?.totals || {} : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Consumos</h3>
        </div>
        <div className="settings-group-body">
          <form method="get" className="panel module" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0, minWidth: 260 }}>
              <label>Tenant</label>
              <select className="select" name="tenantId" defaultValue={tenantId}>
                <option value="">Selecciona…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Mes (UTC)</label>
              <input className="input" type="month" name="periodKey" defaultValue={periodKey} />
            </div>
            <button className="primary" type="submit" style={{ height: 38 }}>
              Ver
            </button>
          </form>

          {tenantId && usageRes && !usageRes.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando consumo: {usageRes.json?.error || `HTTP ${usageRes.status}`}
            </div>
          ) : null}

          {tenantId && usageRes && usageRes.ok ? (
            <>
              <div className="grid4">
                <div className="card cardPad">
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Periodo</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{periodKey}</div>
                </div>
                <div className="card cardPad">
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Cobros (cents)</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{totals ? `$${fmtMoneyCop(totals.billedInCents || 0)} COP` : "—"}</div>
                </div>
              </div>

              <form action={resetCounters} className="panel module" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="periodKey" value={periodKey} />
                <button className="ghost" type="submit">
                  Resetear contadores (no borra histórico)
                </button>
              </form>

              <div style={{ display: "grid", gap: 10 }}>
                {items.map((it) => (
                  <div key={it.key} className="card cardPad" style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>{it.name}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        <code>{it.key}</code> · {it.periodType}
                      </div>
                    </div>
                    <div className="grid4">
                      <div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>Consumo</div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{it.usageTotal}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>Cobrado (qty)</div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{it.billedQuantity}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>Cobrado</div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>${fmtMoneyCop(it.billedInCents || 0)} COP</div>
                      </div>
                    </div>
                  </div>
                ))}
                {!items.length ? <div className="card cardPad">No hay consumo registrado en este periodo.</div> : null}
              </div>

              <details className="card cardPad" style={{ marginTop: 10 }}>
                <summary className="detailsSummary">Consumir (prueba)</summary>
                <div className="detailsBody">
                  <form action={consumeTest} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="periodKey" value={periodKey} />
                    <div className="field" style={{ margin: 0, minWidth: 260 }}>
                      <label>Service key</label>
                      <input className="input" name="serviceKey" placeholder="api_calls" />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Amount</label>
                      <input className="input" type="number" name="amount" defaultValue={1} min={1} />
                    </div>
                    <div className="field" style={{ margin: 0, minWidth: 180 }}>
                      <label>Source</label>
                      <input className="input" name="source" placeholder="manual_test" />
                    </div>
                    <button className="primary" type="submit" style={{ height: 38 }}>
                      Consumir
                    </button>
                  </form>
                </div>
              </details>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
