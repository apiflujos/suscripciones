import { getAutoDebitConfig, type AutoDebitConfig } from "./runtimeConfig";

type SubscriptionAutomationLike = {
  metadata?: unknown;
  graceDays?: number | null;
  maxRetries?: number | null;
};

/**
 * Las reglas de cobro tienen una sola fuente: lo que se configura en Ajustes.
 *
 * Antes mandaban `Subscription.maxRetries` (nace en 3 por el esquema y los seeds),
 * `graceDays` y `metadata.billingOverrides`, que ninguna pantalla permite ver ni
 * editar: Ajustes decía una cosa y el cobro hacía otra.
 */
export async function resolveEffectiveSubscriptionAutomationConfig(
  _subscription?: SubscriptionAutomationLike | null
): Promise<AutoDebitConfig> {
  return getAutoDebitConfig();
}

export async function resolveEffectiveSubscriptionAutomationConfigById(_subscriptionId: string): Promise<AutoDebitConfig> {
  return getAutoDebitConfig();
}
