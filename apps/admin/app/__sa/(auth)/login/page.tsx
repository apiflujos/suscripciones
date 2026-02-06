import Link from "next/link";
import { saLogin } from "./actions";

export default async function SaLoginPage({ searchParams }: { searchParams?: { error?: string; loggedOut?: string } }) {
  const error = String(searchParams?.error || "").trim();
  const loggedOut = String(searchParams?.loggedOut || "").trim() === "1";

  return (
    <main style={{ maxWidth: 520 }}>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Super Admin</h1>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Acceso restringido por sesión.</div>
      </div>

      {loggedOut ? <div className="card cardPad">Sesión cerrada.</div> : null}
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <form action={saLogin} className="panel module" style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div className="field">
          <label>Email</label>
          <input name="email" className="input" placeholder="comercial@apiflujos.com" autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input name="password" className="input" type="password" autoComplete="current-password" />
        </div>
        <button className="primary" type="submit">
          Entrar
        </button>
      </form>

      <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
        <Link href="/" prefetch={false} style={{ textDecoration: "underline" }}>
          Volver al Admin
        </Link>
      </div>
    </main>
  );
}

