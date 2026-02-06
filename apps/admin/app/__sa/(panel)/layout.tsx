import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SA_COOKIE, saAdminFetch } from "../saApi";
import { saLogout } from "../(auth)/login/actions";

export default async function SaLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SA_COOKIE)?.value || "";
  if (!token) redirect("/__sa/login");

  const me = await saAdminFetch("/admin/sa/me", { method: "GET" });
  if (!me.ok) {
    cookies().delete(SA_COOKIE);
    redirect("/__sa/login?error=session_expired");
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div className="settings-group-title">/__sa</div>
          <h1 className="pageTitle" style={{ margin: 0 }}>
            Super Admin
          </h1>
        </div>
      </div>

      <nav className="toolbar" aria-label="Super Admin tabs">
        <Link className="btn" href="/__sa/tenants" prefetch={false}>
          Tenants
        </Link>
        <Link className="btn" href="/__sa/modules" prefetch={false}>
          Módulos
        </Link>
        <Link className="btn" href="/__sa/limits" prefetch={false}>
          Servicios
        </Link>
        <Link className="btn" href="/__sa/plans" prefetch={false}>
          Planes
        </Link>
        <Link className="btn" href="/__sa/usage" prefetch={false}>
          Consumos
        </Link>
      </nav>

      {children}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <form action={saLogout}>
          <button type="submit" className="ghost">
            Salir
          </button>
        </form>
      </div>
    </div>
  );
}
