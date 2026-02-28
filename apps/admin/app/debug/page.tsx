import { getAdminApiConfig } from "../lib/adminApi";

export const dynamic = "force-dynamic";

async function computeDiag(apiBase: string, token: string) {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${apiBase}/health`, { cache: "no-store" });
    const ms = Date.now() - startedAt;
    return {
      apiBase,
      hasAdminToken: !!token,
      adminTokenLength: token.length,
      health: { ok: res.ok, status: res.status, ms }
    };
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    return {
      apiBase,
      hasAdminToken: !!token,
      adminTokenLength: token.length,
      health: { ok: false, error: String(err?.message || err), ms }
    };
  }
}

export default async function DebugPage() {
  const { apiBase, token } = getAdminApiConfig();
  const diag = await computeDiag(apiBase, token);

  return (
    <main className="page">
      <div className="panel module" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        <div className="pageTitle">Diagnóstico</div>
        <div className="pageSub">Estado interno del Admin.</div>
        <div style={{ marginTop: 10 }}>apiBase (server config): {apiBase}</div>
        <div>internal override: {process.env.ADMIN_INTERNAL_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || "—"}</div>
        <div style={{ marginTop: 12 }}>Computed diag:</div>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(diag, null, 2)}</pre>
        <div style={{ marginTop: 12, color: "var(--text-faint)" }}>
          Si el health falla aquí, el admin no puede llegar al API desde Render.
        </div>
      </div>
    </main>
  );
}
