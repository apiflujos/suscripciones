import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SA_COOKIE, saAdminFetch } from "../saApi";

export default async function SaLayout({ children }: { children: React.ReactNode }) {
  const c = await cookies();
  const token = c.get(SA_COOKIE)?.value || "";
  if (!token) redirect("/login?next=%2Fsa");

  const me = await saAdminFetch("/admin/sa/me", { method: "GET" });
  if (!me.ok) {
    redirect("/login?error=forbidden&next=%2Fsa");
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ display: "grid", gap: 2 }}>
          <div className="settings-group-title">/sa</div>
          <h1 className="pageTitle" style={{ margin: 0 }}>
            Super Admin
          </h1>
        </div>
      </div>

      <nav className="toolbar" aria-label="Super Admin tabs">
        <Link className="btn" href="/sa/tenants" prefetch={false}>
          Tenants
        </Link>
        <Link className="btn" href="/sa/modules" prefetch={false}>
          Módulos
        </Link>
        <Link className="btn" href="/sa/users" prefetch={false}>
          Usuarios
        </Link>
        <Link className="btn" href="/sa/limits" prefetch={false}>
          Servicios
        </Link>
        <Link className="btn" href="/sa/plans" prefetch={false}>
          Planes
        </Link>
        <Link className="btn" href="/sa/usage" prefetch={false}>
          Consumos
        </Link>
      </nav>

      {children}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Link href="/logout" prefetch={false} className="ghost">
          Salir
        </Link>
      </div>
    </div>
  );
}
