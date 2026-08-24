// Normaliza un teléfono a E.164 con '+'. Los celulares colombianos de 10 dígitos
// que empiezan por 3 reciben el indicativo 57. Devuelve undefined si el resultado
// no es un teléfono válido (7-15 dígitos).
export function normalizePhoneE164(raw: unknown): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return undefined;

  const digits = value.replace(/\D/g, "");
  if (!digits) return undefined;

  let e164 = "";
  if (value.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (value.startsWith("00")) {
    e164 = `+${digits.slice(2)}`;
  } else if (digits.length >= 11 && digits.length <= 15) {
    e164 = `+${digits}`;
  } else {
    const inferredCode = digits.length === 10 && digits.startsWith("3") ? "57" : "";
    if (!inferredCode) return undefined;
    e164 = `+${inferredCode}${digits}`;
  }

  const len = e164.replace(/\D/g, "");
  if (len.length < 7 || len.length > 15) return undefined;
  return e164;
}
