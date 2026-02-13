import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { createSmartList, previewSmartList, syncSmartList } from "./actions";
import { SmartListBuilder } from "./SmartListBuilder";

type Preview = { count: number; sample: Array<{ id: string; name?: string; email?: string; phone?: string }> } | null;

async function fetchPreview(id: string): Promise<Preview> {
  const { apiBase, token } = getAdminApiConfig();
  if (!token) return null;
  const res = await fetch(`${apiBase}/admin/comms/smart-lists/${encodeURIComponent(id)}/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
    cache: "no-store"
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export default async function SmartListsPage({
  searchParams
}: {
  searchParams?: { preview?: string; error?: string; created?: string; synced?: string; preset?: string; name?: string; description?: string; rules?: string };
}) {
  const page = typeof searchParams?.page === "string" ? Number(searchParams.page) : 1;
  const take = 100;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const listsRes = await fetchAdminCached(`/admin/comms/smart-lists?take=${take}&skip=${skip}`, { ttlMs: 0 });
  const items = Array.isArray(listsRes?.json?.items) ? listsRes.json.items : [];
  const previewId = String(searchParams?.preview || "").trim();
  const preview = previewId ? await fetchPreview(previewId) : null;
  const preset = String(searchParams?.preset || "").trim();
  const prefillName = String(searchParams?.name || "").trim();
  const prefillDescription = String(searchParams?.description || "").trim();
  const rulesRaw = String(searchParams?.rules || "").trim();
  let initialRules: any = null;
  if (rulesRaw) {
    try {
      initialRules = JSON.parse(rulesRaw);
    } catch {
      initialRules = null;
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Listas Inteligentes</h1>
          <p className="muted">Segmenta por reglas y envía campañas masivas desde la Central de Comunicaciones Apiflujos.</p>
        </div>
      </div>

      {searchParams?.error ? <div className="panel module">Error: {searchParams.error}</div> : null}
      {searchParams?.created ? <div className="panel module">Lista creada.</div> : null}
      {searchParams?.synced ? <div className="panel module">Sync: {searchParams.synced}</div> : null}

      <div className="panel module" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Nueva lista</h3>
        <form action={createSmartList} style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Nombre</span>
              <HelpTip text="Nombre visible en la Central y en campañas." />
            </label>
            <input className="input" name="name" defaultValue={prefillName} required />
          </div>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Descripción</span>
              <HelpTip text="Nota interna para saber qué segmento representa." />
            </label>
            <input className="input" name="description" defaultValue={prefillDescription} />
          </div>
          <SmartListBuilder preset={preset || undefined} initialRules={initialRules || undefined} />
          <label className="checkbox" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="enabled" value="1" defaultChecked />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span>Habilitada</span>
              <HelpTip text="Si está desactivada no se usa para campañas." />
            </span>
          </label>
          <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="primary" type="submit">Crear</button>
          </div>
        </form>
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Listas</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? <div className="muted">No hay listas aún.</div> : null}
          {items.map((item: any) => (
            <div key={item.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>{item.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Label: {item.chatwootLabel} · {item.enabled ? "Activa" : "Inactiva"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a className="ghost" href={`/smart-lists/${item.id}`}>Ver contactos</a>
                  <form action={previewSmartList}>
                    <input type="hidden" name="id" value={item.id} />
                    <button className="ghost" type="submit">Preview</button>
                  </form>
                  <form action={syncSmartList}>
                    <input type="hidden" name="id" value={item.id} />
                    <button className="ghost" type="submit">Sincronizar</button>
                  </form>
                </div>
              </div>
              {previewId === item.id && preview ? (
                <div style={{ marginTop: 8 }}>
                  <div className="muted">Coincidencias: {preview.count}</div>
                  {preview.sample?.length ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {preview.sample.map((c) => `${c.name || "—"} (${c.email || c.phone || "sin contacto"})`).join(" · ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
          <a
            className="ghost"
            href={`/smart-lists?${new URLSearchParams({ ...(searchParams?.preview ? { preview: String(searchParams.preview) } : {}), page: String(Math.max(1, (Number(page) || 1) - 1)) })}`}
            aria-disabled={Number(page) <= 1}
          >
            Anterior
          </a>
          <a
            className="ghost"
            href={`/smart-lists?${new URLSearchParams({ ...(searchParams?.preview ? { preview: String(searchParams.preview) } : {}), page: String((Number(page) || 1) + 1) })}`}
            aria-disabled={items.length < take}
          >
            Siguiente
          </a>
        </div>
      </div>
    </div>
  );
}
