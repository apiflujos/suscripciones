import { fetchAdminCached } from "../lib/adminApi";
import { createCampaign, runCampaign } from "./actions";

export default async function CampaignsPage({ searchParams }: { searchParams?: { error?: string; created?: string; running?: string } }) {
  const listsRes = await fetchAdminCached("/admin/comms/smart-lists", { ttlMs: 0 });
  const lists = Array.isArray(listsRes?.json?.items) ? listsRes.json.items : [];
  const campaignsRes = await fetchAdminCached("/admin/comms/campaigns", { ttlMs: 0 });
  const items = Array.isArray(campaignsRes?.json?.items) ? campaignsRes.json.items : [];

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Campañas</h1>
          <p className="muted">Envía mensajes masivos a contactos filtrados por Listas Inteligentes.</p>
        </div>
      </div>

      {searchParams?.error ? <div className="panel module">Error: {searchParams.error}</div> : null}
      {searchParams?.created ? <div className="panel module">Campaña creada.</div> : null}
      {searchParams?.running ? <div className="panel module">Campaña en cola.</div> : null}

      <div className="panel module" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Nueva campaña</h3>
        <form action={createCampaign} style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label>Nombre</label>
            <input className="input" name="name" required />
          </div>
          <div className="field">
            <label>Lista inteligente</label>
            <select className="select" name="smartListId" required>
              <option value="">Selecciona una lista</option>
              {lists.map((l: any) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Mensaje</label>
            <textarea className="input" name="content" rows={4} required />
          </div>
          <div className="field">
            <label>Template params (JSON opcional)</label>
            <textarea className="input" name="templateParams" rows={3} placeholder='{"name":"Juan","amount":"$49.000"}' />
          </div>
          <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="primary" type="submit">Crear</button>
          </div>
        </form>
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? <div className="muted">No hay campañas aún.</div> : null}
          {items.map((c: any) => (
            <div key={c.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Estado: {c.status} · Enviados: {c.sentCount} · Fallidos: {c.failedCount}
                  </div>
                </div>
                <form action={runCampaign}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="ghost" type="submit">Enviar</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
