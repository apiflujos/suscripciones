import { CredentialProvider } from "@prisma/client";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getCredential } from "@suscripciones/core/services/credentials";
import { WompiClient } from "@suscripciones/core/providers/wompi/client";
import { wompiTestSchema, ActiveEnv } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = wompiTestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
  const publicKeyInput = String(parsed.data.publicKey || "").trim();
  const apiBaseInput = String(parsed.data.apiBaseUrl || "").trim();

  const publicKey =
    publicKeyInput ||
    (await getCredential(CredentialProvider.WOMPI, `PUBLIC_KEY_${env}`)) ||
    (await getCredential(CredentialProvider.WOMPI, "PUBLIC_KEY")) ||
    "";
  const apiBaseUrl =
    apiBaseInput ||
    (await getCredential(CredentialProvider.WOMPI, `API_BASE_URL_${env}`)) ||
    (await getCredential(CredentialProvider.WOMPI, "API_BASE_URL")) ||
    (env === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://api.wompi.co/v1");

  if (!publicKey) {
    return Response.json({ error: "wompi_public_key_not_configured", message: "La llave pública no está configurada" }, { status: 400 });
  }

  try {
    const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl: "https://checkout.wompi.co/l/" });
    const merchantInfo = await wompi.getMerchant(publicKey);
    if (!merchantInfo || typeof merchantInfo !== "object") {
      throw new Error("Respuesta inválida de Wompi");
    }

    return Response.json({
      ok: true,
      message: `Conexión exitosa con ${env === "SANDBOX" ? "Sandbox" : "Producción"}`,
      environment: env
    });
  } catch (err: any) {
    const errorMsg = String(err?.message || err);
    let userMessage = errorMsg;
    if (errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
      userMessage = "Llave pública inválida o expirada";
    } else if (errorMsg.includes("403")) {
      userMessage = "Acceso denegado - verifica tus credenciales";
    } else if (errorMsg.includes("ENOTFOUND") || errorMsg.includes("network")) {
      userMessage = "No se pudo conectar con Wompi - verifica tu conexión a internet";
    } else if (env === "SANDBOX" && errorMsg.includes("404")) {
      userMessage = "Endpoint de Sandbox no encontrado - verifica la URL base";
    }
    return Response.json({ error: "wompi_test_failed", message: userMessage }, { status: 400 });
  }
}
