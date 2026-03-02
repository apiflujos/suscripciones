import { PendingButton } from "../ui/PendingButton";

export function GamificationPanel({
  csrfToken,
  config,
  trending,
  actions
}: {
  csrfToken: string;
  config: any;
  trending: {
    customers24h: any[];
    customers7d: any[];
    customers30d: any[];
    products24h: any[];
    products7d: any[];
    products30d: any[];
  };
  actions: {
    updateGamificationConfig: (formData: FormData) => void;
  };
}) {
  const followup = config?.followup || {};
  const decay = config?.decay || {};
  const weights = config?.weights || {};
  const penalties = config?.penalties || {};
  const wPayment = weights?.paymentApproved || {};
  const wPaymentFail = weights?.paymentFailed || {};
  const wSubStart = weights?.subscriptionStarted || {};
  const wSubRenew = weights?.subscriptionRenewed || {};
  const wSubCancel = weights?.subscriptionCanceled || {};
  const wSubPast = weights?.subscriptionPastDue || {};
  const wChatwoot = weights?.chatwootMessageIn || {};
  const wEmail = weights?.dataEmailAdded || {};
  const wPhone = weights?.dataPhoneAdded || {};
  const wId = weights?.dataIdAdded || {};

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="panelHeaderRow">
          <div style={{ display: "grid", gap: 4 }}>
            <h3>Gamificación</h3>
            <div className="field-hint">Umbrales, degradación y entrenadores de datos.</div>
          </div>
        </div>
      </div>
      <div className="settings-group-body">
        <div className="card cardPad gamification-panel">
          <form action={actions.updateGamificationConfig} className="gamification-form">
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="returnTo" value="/settings?tab=gamificacion" />
            <div className="gamification-layout">
              <div className="gamification-stack">
                <div className="gamification-section">
                  <div className="section-title">Entrenadores y degradación</div>
                  <div className="gamification-grid gamification-grid-4">
                    <label className="field compact">
                      <span className="label">Follow-up (min)</span>
                      <input className="input input-compact" type="number" name="followupMinutes" defaultValue={followup.minutes ?? 15} min={1} />
                    </label>
                    <label className="field compact">
                      <span className="label">Cooldown (min)</span>
                      <input className="input input-compact" type="number" name="followupCooldown" defaultValue={followup.cooldownMinutes ?? 120} min={1} />
                    </label>
                    <label className="field compact">
                      <span className="label">Máx. retomas</span>
                      <input className="input input-compact" type="number" name="followupMaxAttempts" defaultValue={followup.maxAttempts ?? 3} min={1} />
                    </label>
                    <label className="field compact">
                      <span className="label">Penalidad no resp.</span>
                      <input className="input input-compact" type="number" name="followupPenalty" defaultValue={followup.penaltyNoResponse ?? 25} min={0} />
                    </label>
                    <label className="field compact">
                      <span className="label">Inactividad (días)</span>
                      <input className="input input-compact" type="number" name="decayDays" defaultValue={decay.inactivityDays ?? 30} min={1} />
                    </label>
                    <label className="field compact">
                      <span className="label">Degradación/día</span>
                      <input className="input input-compact" type="number" name="decayPerDay" defaultValue={decay.perDay ?? 2} min={0} />
                    </label>
                    <label className="field compact">
                      <span className="label">Penalidad máx.</span>
                      <input className="input input-compact" type="number" name="decayMaxPenalty" defaultValue={decay.maxPenalty ?? 180} min={0} />
                    </label>
                  </div>
                </div>

                <div className="gamification-section">
                  <div className="section-title">Penalidades base</div>
                  <div className="gamification-grid gamification-grid-3">
                    <label className="field compact">
                      <span className="label">En mora</span>
                      <input className="input input-compact" type="number" name="penaltyPastDue" defaultValue={penalties.pastDue ?? 90} min={0} />
                    </label>
                    <label className="field compact">
                      <span className="label">Cancelación</span>
                      <input className="input input-compact" type="number" name="penaltyCanceled" defaultValue={penalties.canceled ?? 120} min={0} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="gamification-stack">
                <div className="gamification-section">
                  <div className="section-title">Pesos de eventos</div>
                  <div className="gamification-grid gamification-grid-4">
                    <label className="field compact">
                      <span className="label">Pago OK · Status</span>
                      <input className="input input-compact" type="number" name="weightPaymentApprovedStatus" defaultValue={wPayment.status ?? 120} />
                    </label>
                    <label className="field compact">
                      <span className="label">Pago OK · Lifetime</span>
                      <input className="input input-compact" type="number" name="weightPaymentApprovedLifetime" defaultValue={wPayment.lifetime ?? 100} />
                    </label>
                    <label className="field compact">
                      <span className="label">Pago OK · Reward</span>
                      <input className="input input-compact" type="number" name="weightPaymentApprovedReward" defaultValue={wPayment.reward ?? 40} />
                    </label>
                    <label className="field compact">
                      <span className="label">Money scale</span>
                      <input className="input input-compact" type="number" name="weightPaymentApprovedMoneyScale" defaultValue={wPayment.moneyScale ?? 10000} min={1} />
                    </label>
                    <label className="field compact">
                      <span className="label">Pago fallido</span>
                      <input className="input input-compact" type="number" name="weightPaymentFailedStatus" defaultValue={wPaymentFail.status ?? -60} />
                    </label>
                    <label className="field compact">
                      <span className="label">Sub. inicio · Status</span>
                      <input className="input input-compact" type="number" name="weightSubStartStatus" defaultValue={wSubStart.status ?? 60} />
                    </label>
                    <label className="field compact">
                      <span className="label">Sub. inicio · Lifetime</span>
                      <input className="input input-compact" type="number" name="weightSubStartLifetime" defaultValue={wSubStart.lifetime ?? 40} />
                    </label>
                    <label className="field compact">
                      <span className="label">Sub. inicio · Reward</span>
                      <input className="input input-compact" type="number" name="weightSubStartReward" defaultValue={wSubStart.reward ?? 10} />
                    </label>
                    <label className="field compact">
                      <span className="label">Renovación · Status</span>
                      <input className="input input-compact" type="number" name="weightSubRenewStatus" defaultValue={wSubRenew.status ?? 70} />
                    </label>
                    <label className="field compact">
                      <span className="label">Renovación · Lifetime</span>
                      <input className="input input-compact" type="number" name="weightSubRenewLifetime" defaultValue={wSubRenew.lifetime ?? 50} />
                    </label>
                    <label className="field compact">
                      <span className="label">Renovación · Reward</span>
                      <input className="input input-compact" type="number" name="weightSubRenewReward" defaultValue={wSubRenew.reward ?? 15} />
                    </label>
                    <label className="field compact">
                      <span className="label">Cancelación</span>
                      <input className="input input-compact" type="number" name="weightSubCancelStatus" defaultValue={wSubCancel.status ?? -120} />
                    </label>
                    <label className="field compact">
                      <span className="label">En mora</span>
                      <input className="input input-compact" type="number" name="weightSubPastStatus" defaultValue={wSubPast.status ?? -80} />
                    </label>
                    <label className="field compact">
                      <span className="label">Chatwoot · Status</span>
                      <input className="input input-compact" type="number" name="weightChatwootStatus" defaultValue={wChatwoot.status ?? 12} />
                    </label>
                    <label className="field compact">
                      <span className="label">Chatwoot · Lifetime</span>
                      <input className="input input-compact" type="number" name="weightChatwootLifetime" defaultValue={wChatwoot.lifetime ?? 6} />
                    </label>
                    <label className="field compact">
                      <span className="label">Chatwoot · Reward</span>
                      <input className="input input-compact" type="number" name="weightChatwootReward" defaultValue={wChatwoot.reward ?? 2} />
                    </label>
                    <label className="field compact">
                      <span className="label">Email agregado</span>
                      <input className="input input-compact" type="number" name="weightEmailStatus" defaultValue={wEmail.status ?? 10} />
                    </label>
                    <label className="field compact">
                      <span className="label">Teléfono agregado</span>
                      <input className="input input-compact" type="number" name="weightPhoneStatus" defaultValue={wPhone.status ?? 10} />
                    </label>
                    <label className="field compact">
                      <span className="label">Documento agregado</span>
                      <input className="input input-compact" type="number" name="weightIdStatus" defaultValue={wId.status ?? 15} />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="gamification-actions">
              <PendingButton className="btn" type="submit" pendingText="Guardando...">Guardar</PendingButton>
              <span className="field-hint">Aplica globalmente. Los canales pueden sumar reglas adicionales.</span>
            </div>
          </form>

          <div className="field-divider" />

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Tendencias (Top 3)</div>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              <div className="card cardPad">
                <div className="muted">Contactos 24h</div>
                <ul className="mini-list">
                  {trending.customers24h.map((item, idx) => (
                    <li key={`c24-${item.id}-${idx}`}>{item.name} · {item.score}</li>
                  ))}
                  {trending.customers24h.length === 0 ? <li className="muted">Sin datos</li> : null}
                </ul>
              </div>
              <div className="card cardPad">
                <div className="muted">Contactos 7d</div>
                <ul className="mini-list">
                  {trending.customers7d.map((item, idx) => (
                    <li key={`c7-${item.id}-${idx}`}>{item.name} · {item.score}</li>
                  ))}
                  {trending.customers7d.length === 0 ? <li className="muted">Sin datos</li> : null}
                </ul>
              </div>
              <div className="card cardPad">
                <div className="muted">Contactos 30d</div>
                <ul className="mini-list">
                  {trending.customers30d.map((item, idx) => (
                    <li key={`c30-${item.id}-${idx}`}>{item.name} · {item.score}</li>
                  ))}
                  {trending.customers30d.length === 0 ? <li className="muted">Sin datos</li> : null}
                </ul>
              </div>
              <div className="card cardPad">
                <div className="muted">Productos 24h</div>
                <ul className="mini-list">
                  {trending.products24h.map((item, idx) => (
                    <li key={`p24-${item.id}-${idx}`}>{item.name} · {item.score}</li>
                  ))}
                  {trending.products24h.length === 0 ? <li className="muted">Sin datos</li> : null}
                </ul>
              </div>
              <div className="card cardPad">
                <div className="muted">Productos 7d</div>
                <ul className="mini-list">
                  {trending.products7d.map((item, idx) => (
                    <li key={`p7-${item.id}-${idx}`}>{item.name} · {item.score}</li>
                  ))}
                  {trending.products7d.length === 0 ? <li className="muted">Sin datos</li> : null}
                </ul>
              </div>
              <div className="card cardPad">
                <div className="muted">Productos 30d</div>
                <ul className="mini-list">
                  {trending.products30d.map((item, idx) => (
                    <li key={`p30-${item.id}-${idx}`}>{item.name} · {item.score}</li>
                  ))}
                  {trending.products30d.length === 0 ? <li className="muted">Sin datos</li> : null}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
