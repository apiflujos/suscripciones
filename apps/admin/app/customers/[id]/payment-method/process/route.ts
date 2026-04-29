import { NextResponse } from "next/server";
import { createWompiPaymentSource } from "../../../../admin/_services/customers";
import { logger } from "@suscripciones/core/lib/logger";

function detectToken(formData: FormData): string {
  const direct =
    String(formData.get("token") || "").trim() ||
    String(formData.get("wompi_token") || "").trim() ||
    String(formData.get("id") || "").trim();
  if (direct) return direct;

  for (const [, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    if (v.startsWith("tok_") || v.startsWith("nequi_") || v.startsWith("pse_")) return v;
  }
  return "";
}

function tokenToType(token: string): "CARD" | "NEQUI" | "PSE" {
  if (token.startsWith("nequi_")) return "NEQUI";
  if (token.startsWith("pse_")) return "PSE";
  return "CARD";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const formData = await req.formData().catch((err: any) => {
    logger.warn({ err, customerId: id }, "Formulario invalido en customer payment-method process");
    return null;
  });
  if (!formData) return NextResponse.redirect(new URL(`/customers/${id}/payment-method?error=invalid_form`, req.url));
  const returnToRaw = String(formData.get("returnTo") || "").trim();
  const returnTo =
    returnToRaw.startsWith("/billing") ||
    returnToRaw.startsWith("/customers") ||
    returnToRaw.startsWith("/subscriptions") ||
    returnToRaw.startsWith("/settings")
      ? returnToRaw
      : "";
  const returnToQuery = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
  const acceptTerms = String(formData.get("accept_terms") || "").trim();
  const acceptPersonal = String(formData.get("accept_personal_data") || "").trim();
  if (acceptTerms !== "1" || acceptPersonal !== "1") {
    return NextResponse.redirect(new URL(`/customers/${id}/payment-method?error=missing_acceptance${returnToQuery}`, req.url));
  }

  const wompiToken = detectToken(formData);
  if (!wompiToken) return NextResponse.redirect(new URL(`/customers/${id}/payment-method?error=missing_token${returnToQuery}`, req.url));

  const type = tokenToType(wompiToken);

  try {
    const res = await createWompiPaymentSource({ customerId: id, type, token: wompiToken });
    if (!res.ok) {
      const error = res.error ? String(res.error) : "No se pudo registrar el método de pago.";
      return NextResponse.redirect(new URL(`/customers/${id}/payment-method?error=${encodeURIComponent(error)}${returnToQuery}`, req.url));
    }
    return NextResponse.redirect(new URL(`/customers/${id}/payment-method/success${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, req.url));
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "request_failed";
    return NextResponse.redirect(new URL(`/customers/${id}/payment-method?error=${encodeURIComponent(msg)}${returnToQuery}`, req.url));
  }
}
