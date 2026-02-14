import { saAdminFetch } from "../../saApi";
import { createPlan, setPlanServiceLimit } from "./actions";
import { getCsrfToken } from "../../../lib/csrf";

function fmtMoneyCop(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(0);
  return new Intl.NumberFormat("es-CO").format(Number(v));
}

export default async function SaPlansPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = String(sp.error || "").trim();

  const plansRes = await saAdminFetch("/admin/sa/plans", { method: "GET" });
  const limitsRes = await saAdminFetch("/admin/sa/limits", { method: "GET" });

  const plans: any[] = plansRes.ok ? plansRes.json?.items || [] : [];
  const services: any[] = limitsRes.ok ? (limitsRes.json?.items || []).filter((x: any) => x.active) : [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3 style={{ display: "flex", gap: 10, alignItems: "center" }}>
            Planes
            <span className="pill">{plans.length}</span>
          </h3>
        </div>
        <div className="settings-group-body">
          <form action={createPlan} className="panel module" style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            <div className="grid2" style={{ gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Key</label>
                <input name="key" className="input" placeholder="master" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Nombre</label>
                <input name="name" className="input" placeholder="Master" />
              </div>
            </div>
            <div className="grid2" style={{ gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Tipo</label>
                <select name="kind" className="select" defaultValue="MASTER">
                  <option value="MASTER">Master</option>
                  <option value="PRO">Pro</option>
                  <option value="ON_DEMAND">On Demand</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Precio mensual (cents)</label>
                <input name="monthlyPriceInCents" className="input" type="number" defaultValue={0} min={0} />
              </div>
            </div>
            <button className="primary" type="submit">
              Crear plan
            </button>
          </form>

          {!plansRes.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando planes: {plansRes.json?.error || `HTTP ${plansRes.status}`}
            </div>
          ) : null}

          {!limitsRes.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando servicios: {limitsRes.json?.error || `HTTP ${limitsRes.status}`}
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            {plans.map((p) => {
              const limitsByKey = new Map<string, any>();
              for (const l of p.services || []) limitsByKey.set(l.serviceKey, l);

              return (
                <details key={p.id} className="card cardPad">
                  <summary className="detailsSummary" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 900 }}>{p.name}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        <code>{p.key}</code> · {p.kind} · ${fmtMoneyCop(p.monthlyPriceInCents)} COP / mes
                      </div>
                    </div>
                    <span className={`pill ${p.active ? "" : "pillDanger"}`}>{p.active ? "Activo" : "Inactivo"}</span>
                  </summary>

                  <div className="detailsBody" style={{ display: "grid", gap: 10 }}>
                    <div className="field-hint">
                      Master: ilimitado y no cobra. On Demand: cobra por evento (unit price). Pro: límites + excedentes (no bloquea).
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {services.map((s) => {
                        const row = limitsByKey.get(s.key);
                        const isUnlimited = row?.isUnlimited ?? (p.kind === "MASTER" || p.kind === "ON_DEMAND");
                        const maxValue = row?.maxValue ?? "";
                        const unitPriceInCents = row?.unitPriceInCents ?? "";

                        return (
                          <form key={s.key} action={setPlanServiceLimit} className="panel module" style={{ display: "grid", gap: 8 }}>
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <input type="hidden" name="planId" value={p.id} />
                            <input type="hidden" name="serviceKey" value={s.key} />
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ display: "grid", gap: 2 }}>
                                <div style={{ fontWeight: 800 }}>{s.name}</div>
                                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                                  <code>{s.key}</code> · {s.periodType}
                                </div>
                              </div>
                              <button className="ghost" type="submit">
                                Guardar
                              </button>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr", gap: 10, alignItems: "end" } as any}>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input name="isUnlimited" value="1" type="checkbox" defaultChecked={!!isUnlimited} />
                                <span>Ilimitado</span>
                              </label>
                              <div className="field" style={{ margin: 0 }}>
                                <label>Max (solo Pro)</label>
                                <input name="maxValue" className="input" placeholder="vacío = ilimitado" defaultValue={maxValue} />
                              </div>
                              <div className="field" style={{ margin: 0 }}>
                                <label>Unit price (cents)</label>
                                <input name="unitPriceInCents" className="input" placeholder="0" defaultValue={unitPriceInCents} />
                              </div>
                            </div>
                          </form>
                        );
                      })}
                      {!services.length ? <div className="card cardPad">No hay servicios activos. Crea services en “Servicios”.</div> : null}
                    </div>
                  </div>
                </details>
              );
            })}

            {!plans.length ? <div className="card cardPad">No hay planes todavía.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
