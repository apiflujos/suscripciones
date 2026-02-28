import Link from "next/link";
import { cookies, headers } from "next/headers";
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

  const h = headers();
  const pathname = h.get("x-app-pathname") || "";
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <nav className="toolbar" aria-label="Super Admin tabs">
        <Link className={`btn ${isActive("/sa/tenants") ? "is-active" : ""}`} href="/sa/tenants" prefetch={false} aria-current={isActive("/sa/tenants") ? "page" : undefined}>
          Tenants
        </Link>
        <Link className={`btn ${isActive("/sa/modules") ? "is-active" : ""}`} href="/sa/modules" prefetch={false} aria-current={isActive("/sa/modules") ? "page" : undefined}>
          Módulos
        </Link>
        <Link className={`btn ${isActive("/sa/users") ? "is-active" : ""}`} href="/sa/users" prefetch={false} aria-current={isActive("/sa/users") ? "page" : undefined}>
          Usuarios
        </Link>
        <Link className={`btn ${isActive("/sa/limits") ? "is-active" : ""}`} href="/sa/limits" prefetch={false} aria-current={isActive("/sa/limits") ? "page" : undefined}>
          Servicios
        </Link>
        <Link className={`btn ${isActive("/sa/plans") ? "is-active" : ""}`} href="/sa/plans" prefetch={false} aria-current={isActive("/sa/plans") ? "page" : undefined}>
          Planes
        </Link>
        <Link className={`btn ${isActive("/sa/usage") ? "is-active" : ""}`} href="/sa/usage" prefetch={false} aria-current={isActive("/sa/usage") ? "page" : undefined}>
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
