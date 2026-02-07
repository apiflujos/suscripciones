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
    <main style={{ padding: 24, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1 style={{ marginTop: 0 }}>Debug</h1>
      <div>apiBase (server config): {apiBase}</div>
      <div>internal override: {process.env.ADMIN_INTERNAL_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || "—"}</div>
      <div style={{ marginTop: 12 }}>Computed diag:</div>
      <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(diag, null, 2)}</pre>
      <div style={{ marginTop: 12, color: "#666" }}>
        Si el health falla aquí, el admin no puede llegar al API desde Render.
      </div>
    </main>
  );
}
