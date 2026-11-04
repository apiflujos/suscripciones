import { CredentialProvider } from "@prisma/client";
import { getCredential } from "./credentials";

export type BrasiliaEnv = "QUALITY" | "PRODUCTION";

/** URL de calidad de Brasilia (FivePostal, generación de guías). Es el valor por defecto del ambiente de calidad. */
export const BRASILIA_QUALITY_URL =
  "https://calidad.api.expreso.brasilia.fivesoft.com.co/fivepostal/api/v1.0/fivepostal/tag/v3";

/** Seguro incluido por pieza (COP). Sobre este valor se cobra BRASILIA_INSURANCE_RATE del valor asegurado. */
export const BRASILIA_INCLUDED_INSURANCE_COP = 1_100_000;
export const BRASILIA_INSURANCE_RATE = 0.003;

export function normalizeBrasiliaEnv(value: unknown): BrasiliaEnv {
  return String(value || "").trim().toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "QUALITY";
}

export type BrasiliaConfig = {
  env: BrasiliaEnv;
  qualityUrl: string;
  productionUrl: string;
  /** URL del ambiente activo ("" si producción aún no está configurada). */
  url: string;
  token: string;
};

export async function getBrasiliaConfig(): Promise<BrasiliaConfig> {
  const [env, qualityUrl, productionUrl, token] = await Promise.all([
    getCredential(CredentialProvider.BRASILIA, "ACTIVE_ENV"),
    getCredential(CredentialProvider.BRASILIA, "API_URL_QUALITY"),
    getCredential(CredentialProvider.BRASILIA, "API_URL_PRODUCTION"),
    getCredential(CredentialProvider.BRASILIA, "API_TOKEN")
  ]);
  const activeEnv = normalizeBrasiliaEnv(env);
  const quality = (qualityUrl || "").trim() || BRASILIA_QUALITY_URL;
  const production = (productionUrl || "").trim();
  return {
    env: activeEnv,
    qualityUrl: quality,
    productionUrl: production,
    url: activeEnv === "PRODUCTION" ? production : quality,
    token: (token || "").trim()
  };
}

/** Prima de seguro adicional por pieza: 0,3% del valor asegurado si supera el seguro incluido, si no 0. */
export function brasiliaInsuranceSurcharge(insuredValueCop: number): number {
  if (!Number.isFinite(insuredValueCop) || insuredValueCop <= BRASILIA_INCLUDED_INSURANCE_COP) return 0;
  return Math.round(insuredValueCop * BRASILIA_INSURANCE_RATE);
}
