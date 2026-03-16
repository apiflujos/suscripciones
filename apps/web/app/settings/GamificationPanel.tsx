import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

export function GamificationPanel({
  csrfToken,
  config,
  view,
  trending,
  actions
}: {
  csrfToken: string;
  config: any;
  view: "compact" | "full";
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
  const isCompact = view !== "full";

  const tip = (accepts: string, impact: string) => `Acepta: ${accepts}\nImpacto: ${impact}`;
  const labelWithTip = (text: string, tip: string) => (
    <span className="label-row">
      <span className="label">{text}</span>
      <HelpTip text={tip} />
    </span>
  );

  const basePreset = {
    followup: { minutes: 15, cooldownMinutes: 120, maxAttempts: 3, penaltyNoResponse: 25 },
    decay: { inactivityDays: 30, perDay: 2, maxPenalty: 180 },
    weights: {
      paymentApproved: { status: 120, lifetime: 100, reward: 40, moneyScale: 10000 },
      paymentFailed: { status: -60, lifetime: 0, reward: 0 },
      subscriptionStarted: { status: 60, lifetime: 40, reward: 10 },
      subscriptionRenewed: { status: 70, lifetime: 50, reward: 15 },
      subscriptionCanceled: { status: -120, lifetime: 0, reward: 0 },
      subscriptionPastDue: { status: -80, lifetime: 0, reward: 0 },
      chatwootMessageIn: { status: 12, lifetime: 6, reward: 2 },
      dataEmailAdded: { status: 10, lifetime: 10, reward: 0 },
      dataPhoneAdded: { status: 10, lifetime: 10, reward: 0 },
      dataIdAdded: { status: 15, lifetime: 15, reward: 0 }
    },
    penalties: { pastDue: 90, canceled: 120 }
  };

  const presetMap = {
    balanced: basePreset,
    conservative: {
      ...basePreset,
      weights: {
        ...basePreset.weights,
        paymentApproved: { status: 100, lifetime: 80, reward: 30, moneyScale: 12000 },
        paymentFailed: { status: -70, lifetime: 0, reward: 0 },
        subscriptionStarted: { status: 50, lifetime: 30, reward: 8 },
        subscriptionRenewed: { status: 55, lifetime: 40, reward: 10 },
        subscriptionCanceled: { status: -140, lifetime: 0, reward: 0 },
        subscriptionPastDue: { status: -95, lifetime: 0, reward: 0 },
        chatwootMessageIn: { status: 8, lifetime: 4, reward: 2 },
        dataEmailAdded: { status: 8, lifetime: 8, reward: 0 },
        dataPhoneAdded: { status: 8, lifetime: 8, reward: 0 },
        dataIdAdded: { status: 12, lifetime: 12, reward: 0 }
      },
      penalties: { pastDue: 110, canceled: 140 }
    },
    aggressive: {
      ...basePreset,
      weights: {
        ...basePreset.weights,
        paymentApproved: { status: 150, lifetime: 130, reward: 60, moneyScale: 8000 },
        paymentFailed: { status: -50, lifetime: 0, reward: 0 },
        subscriptionStarted: { status: 80, lifetime: 60, reward: 15 },
        subscriptionRenewed: { status: 90, lifetime: 70, reward: 20 },
        subscriptionCanceled: { status: -90, lifetime: 0, reward: 0 },
        subscriptionPastDue: { status: -60, lifetime: 0, reward: 0 },
        chatwootMessageIn: { status: 16, lifetime: 10, reward: 4 },
        dataEmailAdded: { status: 14, lifetime: 14, reward: 0 },
        dataPhoneAdded: { status: 14, lifetime: 14, reward: 0 },
        dataIdAdded: { status: 20, lifetime: 20, reward: 0 }
      },
      penalties: { pastDue: 70, canceled: 90 }
    }
  };

  const normalizePreset = (input: any) => {
    const src = input || {};
    const num = (v: any, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
    return {
      followup: {
        minutes: num(src?.followup?.minutes, basePreset.followup.minutes),
        cooldownMinutes: num(src?.followup?.cooldownMinutes, basePreset.followup.cooldownMinutes),
        maxAttempts: num(src?.followup?.maxAttempts, basePreset.followup.maxAttempts),
        penaltyNoResponse: num(src?.followup?.penaltyNoResponse, basePreset.followup.penaltyNoResponse)
      },
      decay: {
        inactivityDays: num(src?.decay?.inactivityDays, basePreset.decay.inactivityDays),
        perDay: num(src?.decay?.perDay, basePreset.decay.perDay),
        maxPenalty: num(src?.decay?.maxPenalty, basePreset.decay.maxPenalty)
      },
      weights: {
        paymentApproved: {
          status: num(src?.weights?.paymentApproved?.status, basePreset.weights.paymentApproved.status),
          lifetime: num(src?.weights?.paymentApproved?.lifetime, basePreset.weights.paymentApproved.lifetime),
          reward: num(src?.weights?.paymentApproved?.reward, basePreset.weights.paymentApproved.reward),
          moneyScale: num(src?.weights?.paymentApproved?.moneyScale, basePreset.weights.paymentApproved.moneyScale)
        },
        paymentFailed: {
          status: num(src?.weights?.paymentFailed?.status, basePreset.weights.paymentFailed.status),
          lifetime: num(src?.weights?.paymentFailed?.lifetime, basePreset.weights.paymentFailed.lifetime),
          reward: num(src?.weights?.paymentFailed?.reward, basePreset.weights.paymentFailed.reward)
        },
        subscriptionStarted: {
          status: num(src?.weights?.subscriptionStarted?.status, basePreset.weights.subscriptionStarted.status),
          lifetime: num(src?.weights?.subscriptionStarted?.lifetime, basePreset.weights.subscriptionStarted.lifetime),
          reward: num(src?.weights?.subscriptionStarted?.reward, basePreset.weights.subscriptionStarted.reward)
        },
        subscriptionRenewed: {
          status: num(src?.weights?.subscriptionRenewed?.status, basePreset.weights.subscriptionRenewed.status),
          lifetime: num(src?.weights?.subscriptionRenewed?.lifetime, basePreset.weights.subscriptionRenewed.lifetime),
          reward: num(src?.weights?.subscriptionRenewed?.reward, basePreset.weights.subscriptionRenewed.reward)
        },
        subscriptionCanceled: {
          status: num(src?.weights?.subscriptionCanceled?.status, basePreset.weights.subscriptionCanceled.status),
          lifetime: num(src?.weights?.subscriptionCanceled?.lifetime, basePreset.weights.subscriptionCanceled.lifetime),
          reward: num(src?.weights?.subscriptionCanceled?.reward, basePreset.weights.subscriptionCanceled.reward)
        },
        subscriptionPastDue: {
          status: num(src?.weights?.subscriptionPastDue?.status, basePreset.weights.subscriptionPastDue.status),
          lifetime: num(src?.weights?.subscriptionPastDue?.lifetime, basePreset.weights.subscriptionPastDue.lifetime),
          reward: num(src?.weights?.subscriptionPastDue?.reward, basePreset.weights.subscriptionPastDue.reward)
        },
        chatwootMessageIn: {
          status: num(src?.weights?.chatwootMessageIn?.status, basePreset.weights.chatwootMessageIn.status),
          lifetime: num(src?.weights?.chatwootMessageIn?.lifetime, basePreset.weights.chatwootMessageIn.lifetime),
          reward: num(src?.weights?.chatwootMessageIn?.reward, basePreset.weights.chatwootMessageIn.reward)
        },
        dataEmailAdded: {
          status: num(src?.weights?.dataEmailAdded?.status, basePreset.weights.dataEmailAdded.status),
          lifetime: num(src?.weights?.dataEmailAdded?.lifetime, basePreset.weights.dataEmailAdded.lifetime),
          reward: num(src?.weights?.dataEmailAdded?.reward, basePreset.weights.dataEmailAdded.reward)
        },
        dataPhoneAdded: {
          status: num(src?.weights?.dataPhoneAdded?.status, basePreset.weights.dataPhoneAdded.status),
          lifetime: num(src?.weights?.dataPhoneAdded?.lifetime, basePreset.weights.dataPhoneAdded.lifetime),
          reward: num(src?.weights?.dataPhoneAdded?.reward, basePreset.weights.dataPhoneAdded.reward)
        },
        dataIdAdded: {
          status: num(src?.weights?.dataIdAdded?.status, basePreset.weights.dataIdAdded.status),
          lifetime: num(src?.weights?.dataIdAdded?.lifetime, basePreset.weights.dataIdAdded.lifetime),
          reward: num(src?.weights?.dataIdAdded?.reward, basePreset.weights.dataIdAdded.reward)
        }
      },
      penalties: {
        pastDue: num(src?.penalties?.pastDue, basePreset.penalties.pastDue),
        canceled: num(src?.penalties?.canceled, basePreset.penalties.canceled)
      }
    };
  };

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
        <div className={`card cardPad gamification-panel ${isCompact ? "is-compact" : "is-full"}`}>
          <form action={actions.updateGamificationConfig} className="gamification-form">
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="returnTo" value="/settings?tab=gamificacion" />
            <div className="gamification-layout">
              <div className="gamification-stack">
                <div className="gamification-section">
                  <div className="section-title">Entrenadores y degradación</div>
                  <div className="gamification-grid gamification-grid-4">
                    <label className="field compact">
                      {labelWithTip(
                        "Follow-up (min)",
                        tip("entero ≥ 1", "Minutos desde el último mensaje saliente sin respuesta para enviar retoma automática.")
                      )}
                      <input className="input input-compact" type="number" name="followupMinutes" defaultValue={followup.minutes ?? 15} min={1} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Cooldown (min)",
                        tip("entero ≥ 1", "Tiempo mínimo entre retomas al mismo contacto.")
                      )}
                      <input className="input input-compact" type="number" name="followupCooldown" defaultValue={followup.cooldownMinutes ?? 120} min={1} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Máx. retomas",
                        tip("entero ≥ 1", "Número máximo de retomas antes de parar y penalizar.")
                      )}
                      <input className="input input-compact" type="number" name="followupMaxAttempts" defaultValue={followup.maxAttempts ?? 3} min={1} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Penalidad no resp.",
                        tip("entero ≥ 0", "Puntos que se descuentan al alcanzar el máximo de retomas.")
                      )}
                      <input className="input input-compact" type="number" name="followupPenalty" defaultValue={followup.penaltyNoResponse ?? 25} min={0} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Inactividad (días)",
                        tip("entero ≥ 1", "Días sin actividad antes de empezar degradación.")
                      )}
                      <input className="input input-compact" type="number" name="decayDays" defaultValue={decay.inactivityDays ?? 30} min={1} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Degradación/día",
                        tip("entero ≥ 0", "Puntos que se descuentan por día después de la inactividad.")
                      )}
                      <input className="input input-compact" type="number" name="decayPerDay" defaultValue={decay.perDay ?? 2} min={0} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Penalidad máx.",
                        tip("entero ≥ 0", "Tope de descuento total por inactividad.")
                      )}
                      <input className="input input-compact" type="number" name="decayMaxPenalty" defaultValue={decay.maxPenalty ?? 180} min={0} />
                    </label>
                  </div>
                </div>

                <div className="gamification-section">
                  <div className="section-title">Penalidades base</div>
                  <div className="gamification-grid gamification-grid-3">
                    <label className="field compact">
                      {labelWithTip(
                        "En mora",
                        tip("entero ≥ 0", "Penalidad base aplicada si la suscripción está en mora.")
                      )}
                      <input className="input input-compact" type="number" name="penaltyPastDue" defaultValue={penalties.pastDue ?? 90} min={0} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Cancelación",
                        tip("entero ≥ 0", "Penalidad base aplicada si la suscripción está cancelada.")
                      )}
                      <input className="input input-compact" type="number" name="penaltyCanceled" defaultValue={penalties.canceled ?? 120} min={0} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="gamification-stack">
                <div className="gamification-section">
                  <div className="section-title">Pesos de eventos</div>
                  <div className="gamification-group">
                    <div className="gamification-group-header">
                      <span>Pagos</span>
                      <HelpTip text="Impacto de pagos y escala monetaria." />
                    </div>
                    <div className="gamification-grid gamification-grid-4">
                    <label className="field compact">
                      {labelWithTip(
                        "Pago OK · Status",
                        tip("entero (positivo recomendado)", "Ajusta el score actual cuando un pago es aprobado.")
                      )}
                      <input className="input input-compact" type="number" name="weightPaymentApprovedStatus" defaultValue={wPayment.status ?? 120} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Pago OK · Lifetime",
                        tip("entero ≥ 0", "Suma a puntos históricos cuando un pago es aprobado.")
                      )}
                      <input className="input input-compact" type="number" name="weightPaymentApprovedLifetime" defaultValue={wPayment.lifetime ?? 100} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Pago OK · Reward",
                        tip("entero ≥ 0", "Suma al saldo de recompensas del contacto.")
                      )}
                      <input className="input input-compact" type="number" name="weightPaymentApprovedReward" defaultValue={wPayment.reward ?? 40} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Money scale",
                        tip("entero ≥ 1", "Escala monetaria: 1 punto por cada X centavos del monto.")
                      )}
                      <input className="input input-compact" type="number" name="weightPaymentApprovedMoneyScale" defaultValue={wPayment.moneyScale ?? 10000} min={1} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Pago fallido",
                        tip("entero (negativo recomendado)", "Descuenta del score actual cuando un pago falla.")
                      )}
                      <input className="input input-compact" type="number" name="weightPaymentFailedStatus" defaultValue={wPaymentFail.status ?? -60} />
                    </label>
                    </div>
                  </div>

                  <div className="gamification-group">
                    <div className="gamification-group-header">
                      <span>Suscripciones</span>
                      <HelpTip text="Inicio, renovación y penalizaciones por estado." />
                    </div>
                    <div className="gamification-grid gamification-grid-4">
                    <label className="field compact">
                      {labelWithTip(
                        "Inicio · Status",
                        tip("entero", "Ajusta el score actual cuando inicia una suscripción.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubStartStatus" defaultValue={wSubStart.status ?? 60} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Inicio · Lifetime",
                        tip("entero ≥ 0", "Suma a puntos históricos al iniciar una suscripción.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubStartLifetime" defaultValue={wSubStart.lifetime ?? 40} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Inicio · Reward",
                        tip("entero ≥ 0", "Suma al saldo de recompensas al iniciar.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubStartReward" defaultValue={wSubStart.reward ?? 10} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Renovación · Status",
                        tip("entero", "Ajusta el score actual cuando se renueva.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubRenewStatus" defaultValue={wSubRenew.status ?? 70} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Renovación · Lifetime",
                        tip("entero ≥ 0", "Suma a puntos históricos al renovar.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubRenewLifetime" defaultValue={wSubRenew.lifetime ?? 50} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Renovación · Reward",
                        tip("entero ≥ 0", "Suma al saldo de recompensas al renovar.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubRenewReward" defaultValue={wSubRenew.reward ?? 15} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Cancelación",
                        tip("entero (negativo recomendado)", "Descuento al score cuando se cancela una suscripción.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubCancelStatus" defaultValue={wSubCancel.status ?? -120} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "En mora",
                        tip("entero (negativo recomendado)", "Descuento al score cuando la suscripción entra en mora.")
                      )}
                      <input className="input input-compact" type="number" name="weightSubPastStatus" defaultValue={wSubPast.status ?? -80} />
                    </label>
                    </div>
                  </div>

                  <div className="gamification-group">
                    <div className="gamification-group-header">
                      <span>Interacción (Chatwoot)</span>
                      <HelpTip text="Mensajes entrantes del cliente." />
                    </div>
                    <div className="gamification-grid gamification-grid-3">
                    <label className="field compact">
                      {labelWithTip(
                        "Status",
                        tip("entero ≥ 0", "Puntos al score actual por mensaje entrante.")
                      )}
                      <input className="input input-compact" type="number" name="weightChatwootStatus" defaultValue={wChatwoot.status ?? 12} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Lifetime",
                        tip("entero ≥ 0", "Puntos históricos por mensaje entrante.")
                      )}
                      <input className="input input-compact" type="number" name="weightChatwootLifetime" defaultValue={wChatwoot.lifetime ?? 6} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Reward",
                        tip("entero ≥ 0", "Puntos de recompensa por mensaje entrante.")
                      )}
                      <input className="input input-compact" type="number" name="weightChatwootReward" defaultValue={wChatwoot.reward ?? 2} />
                    </label>
                    </div>
                  </div>

                  <div className="gamification-group">
                    <div className="gamification-group-header">
                      <span>Datos del cliente</span>
                      <HelpTip text="Completar datos mejora reputación." />
                    </div>
                    <div className="gamification-grid gamification-grid-3">
                    <label className="field compact">
                      {labelWithTip(
                        "Email",
                        tip("entero ≥ 0", "Puntos al completar email por primera vez.")
                      )}
                      <input className="input input-compact" type="number" name="weightEmailStatus" defaultValue={wEmail.status ?? 10} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Teléfono",
                        tip("entero ≥ 0", "Puntos al completar teléfono por primera vez.")
                      )}
                      <input className="input input-compact" type="number" name="weightPhoneStatus" defaultValue={wPhone.status ?? 10} />
                    </label>
                    <label className="field compact">
                      {labelWithTip(
                        "Documento",
                        tip("entero ≥ 0", "Puntos al completar documento por primera vez.")
                      )}
                      <input className="input input-compact" type="number" name="weightIdStatus" defaultValue={wId.status ?? 15} />
                    </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="gamification-actions">
              <PendingButton className="btn" type="submit" pendingText="Guardando...">Guardar</PendingButton>
              <span className="field-hint">Aplica globalmente. Los canales pueden sumar reglas adicionales.</span>
              <div className="gamification-presets">
                <select className="select select-compact" name="preset" defaultValue="">
                  <option value="">Preset rápido</option>
                  <option value="balanced">Equilibrado</option>
                  <option value="conservative">Conservador</option>
                  <option value="aggressive">Agresivo</option>
                </select>
                <button className="ghost btn-compact" type="submit" name="applyPreset" value="1">
                  Aplicar preset
                </button>
                <button className="ghost btn-compact" type="submit" name="resetDefaults" value="1">
                  Restaurar defaults
                </button>
              </div>
            </div>
          </form>

          <div className="field-divider" />

          <details className="card cardPad gamification-trends">
            <summary className="detailsSummary">
              <span>Tendencias (Top 3)</span>
              <span className="muted">Ver detalle</span>
            </summary>
            <div className="detailsBody">
              <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
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
          </details>
        </div>
      </div>
    </section>
  );
}
