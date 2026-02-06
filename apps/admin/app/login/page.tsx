import { adminLogin } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams?: { error?: string; next?: string; loggedOut?: string } }) {
  const error = String(searchParams?.error || "").trim();
  const next = String(searchParams?.next || "").trim();
  const loggedOut = String(searchParams?.loggedOut || "").trim() === "1";

  return (
    <main style={{ width: "min(520px, 100%)" }}>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Inicia sesión para acceder al panel.</div>
      </div>

      {loggedOut ? <div className="card cardPad">Sesión cerrada.</div> : null}
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <form action={adminLogin} className="panel module" style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label>Usuario</label>
          <input name="user" className="input" placeholder="admin" autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input name="pass" className="input" type="password" autoComplete="current-password" />
        </div>
        <button className="primary" type="submit">
          Entrar
        </button>
      </form>
    </main>
  );
}

