import { fetchAdminCached } from "../../lib/adminApi";
import Link from "next/link";

async function fetchMembers(id: string, page = 1) {
  const take = 200;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  return fetchAdminCached(`/admin/comms/smart-lists/${encodeURIComponent(id)}/members?active=1&take=${take}&skip=${skip}`, { ttlMs: 0 });
}

export default async function SmartListDetail({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: Promise<{ page?: string }>;
}) {
  const id = params.id;
  const sp = (await searchParams) ?? {};
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const listRes = await fetchAdminCached(`/admin/comms/smart-lists/${encodeURIComponent(id)}`, { ttlMs: 0 });
  const list = listRes.ok ? listRes.json?.smartList : null;

  const membersRes = await fetchMembers(id, page);
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
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
          <a className="ghost" href={`/smart-lists/${id}?page=${Math.max(1, (Number(page) || 1) - 1)}`} aria-disabled={Number(page) <= 1}>
            Anterior
          </a>
          <a className="ghost" href={`/smart-lists/${id}?page=${(Number(page) || 1) + 1}`} aria-disabled={items.length < 200}>
            Siguiente
          </a>
        </div>
      </div>
    </div>
  );
}
