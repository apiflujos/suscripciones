import { headers } from "next/headers";
import { getPublicBaseUrlFromEnv } from "@suscripciones/core/services/publicBase";
import { logger } from "@suscripciones/core/lib/logger";

export async function getRequestBase() {
  const headerStore = await headers();
  const forwardedProto = headerStore.get("x-forwarded-proto") || "https";
  const forwardedHost = headerStore.get("x-forwarded-host") || headerStore.get("host");
  if (!forwardedHost) return "";
  return `${forwardedProto}://${forwardedHost}`;
}

export async function getPublicApiBases() {
  const requestBase = await getRequestBase();
  const publicBase = getPublicBaseUrlFromEnv();
  return [requestBase, publicBase, process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "", process.env.NEXT_PUBLIC_API_BASE_URL || ""];
}

export async function fetchPublicJsonAcrossBases(path: string, bases: string[]) {
  const uniqueBases = Array.from(new Set(bases.map((base) => String(base || "").trim()).filter(Boolean)));
  if (!uniqueBases.length) return { ok: false, status: 500, json: { error: "missing_public_base_url" } };

  for (const apiBase of uniqueBases) {
    try {
      const res = await fetch(`${apiBase}${path}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok) return { ok: true, status: res.status, json, apiBase };
    } catch (err: any) {
      logger.warn({ err, apiBase, path }, "Fallo consultando recurso público en base candidata");
    }
  }

  const lastBase = uniqueBases[uniqueBases.length - 1];
  try {
    const res = await fetch(`${lastBase}${path}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json, apiBase: lastBase };
  } catch (err: any) {
    logger.error({ err, apiBase: lastBase, path }, "Fallo definitivo consultando recurso público");
    return { ok: false, status: 0, json: { error: "fetch_failed" } };
  }
}
