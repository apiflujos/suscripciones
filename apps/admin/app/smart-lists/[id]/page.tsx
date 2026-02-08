import { fetchAdminCached } from "../../lib/adminApi";
import Link from "next/link";

async function fetchMembers(id: string) {
  return fetchAdminCached(`/admin/comms/smart-lists/${encodeURIComponent(id)}/members?active=1&take=200`, { ttlMs: 0 });
}

export default async function SmartListDetail({ params }: { params: { id: string } }) {
  const id = params.id;
  const listRes = await fetchAdminCached(`/admin/comms/smart-lists/${encodeURIComponent(id)}`, { ttlMs: 0 });
  const list = listRes.ok ? listRes.json?.smartList : null;

  const membersRes = await fetchMembers(id);
  const items = Array.isArray(membersRes?.json?.items) ? membersRes.json.items : [];

  if (!list) {
    return (
      <div className="page">
        <h1>Lista no encontrada</h1>
        <Link href="/smart-lists" className="ghost">Volver</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>{list.name}</h1>
          <p className="muted">Label: {list.chatwootLabel}</p>
        </div>
        <Link href="/smart-lists" className="ghost">Volver</Link>
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Contactos (activos)</h3>
        {items.length === 0 ? <div className="muted">Sin contactos.</div> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((m: any) => (
            <div key={m.id} className="panel" style={{ padding: 10 }}>
              <strong>{m.customer?.name || "Sin nombre"}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {m.customer?.email || "—"} · {m.customer?.phone || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
