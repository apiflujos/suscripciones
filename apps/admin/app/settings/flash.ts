import { normalizeErrorParam } from "../lib/errorParam";

type Labels = Record<string, { ok: string; fail: string }>;

/**
 * Resultado de la última acción de ajustes. Las server actions de settings/actions.ts
 * redirigen con `?a=<acción>&status=ok|fail&error=…`; aquí se convierte en el aviso
 * que muestra una página (PageShell `notice`).
 */
export function settingsNotice(
  sp: Record<string, string | string[] | undefined>,
  labels: Labels
): { tone: "ok" | "error"; text: string } | null {
  const action = String(Array.isArray(sp.a) ? sp.a[0] : sp.a || "");
  const status = String(Array.isArray(sp.status) ? sp.status[0] : sp.status || "");
  const label = labels[action];
  if (!label) return null;
  if (status === "ok") return { tone: "ok", text: label.ok };
  if (status === "fail") {
    const err = normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined);
    return { tone: "error", text: `${label.fail}: ${err || "unknown_error"}` };
  }
  return null;
}
