import { RetryJobType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isPermanentMessagingError } from "../permanentErrors";

const reminder = (message: string) =>
  isPermanentMessagingError({ type: RetryJobType.SUBSCRIPTION_REMINDER, message });

describe("isPermanentMessagingError — qué no vale la pena reintentar", () => {
  it("corta la plantilla mal configurada, que fallaría igual las 10 veces", () => {
    expect(reminder("missing_template_params:body:3")).toBe(true);
  });

  it("corta los datos que faltan del cliente", () => {
    expect(reminder("customer_phone_required")).toBe(true);
    expect(reminder("missing_customer_fields")).toBe(true);
    expect(reminder("whatsapp_inbox_required")).toBe(true);
  });

  it("corta el teléfono repetido: Chatwoot responde 422 y seguirá respondiendo 422", () => {
    const err =
      'Chatwoot update contact failed: 422 {"message":"Phone number has already been taken","attributes":["phone_number"]}';
    expect(reminder(err)).toBe(true);
  });

  it("corta el formato de teléfono que Chatwoot no acepta", () => {
    const err = 'Chatwoot create conversation failed: 422 {"message":"Source invalid source id for whatsapp inbox."}';
    expect(reminder(err)).toBe(true);
  });

  it("corta los códigos con los que Meta dice que no va a entregar", () => {
    // Insistir con estos es lo que deteriora la reputación del número.
    expect(reminder('send failed {"code":131049,"title":"Not delivered"}')).toBe(true);
    expect(reminder("send failed (131026) Message undeliverable")).toBe(true);
  });

  it("no confunde un id que contenga esos dígitos con un código de Meta", () => {
    // Descartar un aviso recuperable por un id parecido sería peor que el bucle.
    expect(reminder('failed {"conversation_id":9131049123}')).toBe(false);
    expect(reminder("failed for +57131026771")).toBe(false);
  });

  it("sigue reintentando lo que sí se arregla solo", () => {
    expect(reminder("Chatwoot send template failed: 500 {}")).toBe(false);
    expect(reminder("Chatwoot send template failed: 502 {}")).toBe(false);
    expect(reminder("Chatwoot send template failed: 429 {}")).toBe(false); // límite de peticiones
    expect(reminder("Chatwoot send template failed: 408 {}")).toBe(false); // tiempo agotado
    expect(reminder("fetch failed")).toBe(false);
    expect(reminder("ECONNRESET")).toBe(false);
  });

  it("no descarta los fallos del sistema: si no, una avería borra toda la cartera", () => {
    // El token vencido o la cuenta mal configurada se arreglan solos en cuanto
    // alguien los corrige; los avisos tienen que seguir vivos hasta entonces.
    expect(reminder("Chatwoot send template failed: 401 {}")).toBe(false);
    expect(reminder("Chatwoot send template failed: 403 {}")).toBe(false);
    expect(reminder('Chatwoot send template failed: 404 {"message":"Resource could not be found"}')).toBe(false);
  });

  it("ante la duda reintenta: perder un aviso es peor que gastar un intento", () => {
    expect(reminder("")).toBe(false);
    expect(reminder("algo raro pasó")).toBe(false);
    expect(isPermanentMessagingError({ type: RetryJobType.SUBSCRIPTION_REMINDER, message: null })).toBe(false);
  });

  it("no toca el cobro: ahí un reintento no le cuesta reputación a nadie", () => {
    const err = "Wompi charge failed: 422 {}";
    expect(isPermanentMessagingError({ type: RetryJobType.PAYMENT_RETRY, message: err })).toBe(false);
    expect(isPermanentMessagingError({ type: RetryJobType.PROCESS_WOMPI_EVENT, message: err })).toBe(false);
  });

  it("aplica a los tres tipos de envío al cliente", () => {
    const err = "missing_template_params:body:3";
    expect(isPermanentMessagingError({ type: RetryJobType.SEND_CHATWOOT_MESSAGE, message: err })).toBe(true);
    expect(isPermanentMessagingError({ type: RetryJobType.SUBSCRIPTION_REMINDER, message: err })).toBe(true);
    expect(isPermanentMessagingError({ type: RetryJobType.SEND_CAMPAIGN, message: err })).toBe(true);
  });
});
