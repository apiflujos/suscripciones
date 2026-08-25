import { describe, expect, it } from "vitest";
import { normalizeNotificationsConfig, notificationsConfigSchema } from "../notificationsConfig";

/**
 * B1 de la auditoría: la plantilla del recordatorio previo mapeaba la variable 3
 * a {{payment.paidAt}}. Un recordatorio sale antes de que exista el pago, así que
 * ese campo viene nulo siempre; Meta cuenta los parámetros, ve que falta uno y
 * rechaza el envío entero. Entre el 28-jul y el 20-ago no salió un solo
 * recordatorio de cobro.
 */

function buildConfig(args: {
  trigger: "SUBSCRIPTION_DUE" | "PAYMENT_APPROVED";
  body: Record<string, string>;
}) {
  return notificationsConfigSchema.parse({
    version: 1,
    templates: [
      {
        id: "tpl_reminder_due_link",
        name: "Recordatorio antes del vencimiento",
        channel: "CHATWOOT",
        chatwootType: "EXPIRY_WARNING",
        chatwootTemplate: {
          name: "recordatorio_de_fecha_de_pago",
          language: "es",
          processed_params: { body: args.body }
        }
      }
    ],
    rules: [
      {
        id: "rule_reminder_due_link",
        name: "Recordatorio antes del vencimiento",
        enabled: true,
        trigger: args.trigger,
        templateId: "tpl_reminder_due_link"
      }
    ]
  });
}

function bodyOf(cfg: ReturnType<typeof normalizeNotificationsConfig>) {
  const params = cfg.templates[0]?.chatwootTemplate?.processed_params as
    | { body?: Record<string, string> }
    | undefined;
  return params?.body;
}

describe("normalizeNotificationsConfig — fecha del recordatorio de cobro (B1)", () => {
  it("cambia la fecha de pago por la de vencimiento en un recordatorio", () => {
    const cfg = normalizeNotificationsConfig(
      buildConfig({
        trigger: "SUBSCRIPTION_DUE",
        body: {
          "1": "{{customer.name}}",
          "2": "{{plan.name}}",
          "3": "{{payment.paidAt}}"
        }
      })
    );

    expect(bodyOf(cfg)).toEqual({
      "1": "{{customer.name}}",
      "2": "{{plan.name}}",
      "3": "{{subscription.nextBillingDate}}"
    });
  });

  it("también cambia la fecha de fallo, igual de vacía antes del vencimiento", () => {
    const cfg = normalizeNotificationsConfig(
      buildConfig({
        trigger: "SUBSCRIPTION_DUE",
        body: { "1": "{{customer.name}}", "2": "{{payment.failedAt}}" }
      })
    );

    expect(bodyOf(cfg)?.["2"]).toBe("{{subscription.nextBillingDate}}");
  });

  it("no toca las plantillas que no son recordatorios: ahí sí hubo un pago", () => {
    const cfg = normalizeNotificationsConfig(
      buildConfig({
        trigger: "PAYMENT_APPROVED",
        body: { "1": "{{customer.name}}", "2": "{{payment.paidAt}}" }
      })
    );

    expect(bodyOf(cfg)?.["2"]).toBe("{{payment.paidAt}}");
  });

  it("deja intactas las variables que sí se rellenan", () => {
    const body = {
      "1": "{{customer.name}}",
      "2": "{{plan.name}}",
      "3": "{{subscription.collectionCycleLabel}}"
    };
    const cfg = normalizeNotificationsConfig(buildConfig({ trigger: "SUBSCRIPTION_DUE", body }));

    expect(bodyOf(cfg)).toEqual(body);
  });

  it("es idempotente: normalizar lo ya normalizado no cambia nada", () => {
    const once = normalizeNotificationsConfig(
      buildConfig({
        trigger: "SUBSCRIPTION_DUE",
        body: { "1": "{{customer.name}}", "3": "{{payment.paidAt}}" }
      })
    );
    const twice = normalizeNotificationsConfig(once);

    expect(bodyOf(twice)).toEqual(bodyOf(once));
  });
});
