import { BodegasSelector } from "./BodegasSelector";

export const dynamic = "force-dynamic";

export default async function BodegasPage() {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h1 className="pageTitle">Bodegas para stock</h1>
        <p className="pageSub">Selecciona en qué bodegas se consulta y sincroniza inventario.</p>
      </div>
      <BodegasSelector />
    </div>
  );
}

