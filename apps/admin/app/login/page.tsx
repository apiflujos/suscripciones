import { adminLogin } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams?: { error?: string; next?: string; loggedOut?: string } }) {
  const error = String(searchParams?.error || "").trim();
  const next = String(searchParams?.next || "").trim();
  const loggedOut = String(searchParams?.loggedOut || "").trim() === "1";

  const errorMessage =
    error === "missing_admin_token"
      ? "Falta configurar el token del Admin (API_ADMIN_TOKEN) y el token del API (ADMIN_API_TOKEN)."
      : error === "super_admin_not_configured"
        ? "Super Admin no está configurado. Define SUPER_ADMIN_EMAIL y SUPER_ADMIN_PASSWORD en el API, o crea un usuario en la tabla sa_users."
        : error;

  return (
    <main className="authMain">
      <div className="authCard card">
        <div className="authCardInner">
          <div className="authBrand" aria-label="Marca">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-horizontal.png" alt="ApiFlujos" className="authLogo" />
          </div>

          <div className="authHeader">
            <h1 className="authTitle">Iniciar sesión</h1>
            <div className="authSubtitle">Inicia sesión para acceder al panel.</div>
          </div>

          {loggedOut ? <div className="authAlert">Sesión cerrada.</div> : null}
          {error ? <div className="authAlert is-danger">Error: {errorMessage}</div> : null}

          <form action={adminLogin} className="authForm">
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label>Email</label>
              <input name="email" className="input" placeholder="tu@email.com" autoComplete="username" />
            </div>
            <div className="field">
              <label>Password</label>
              <input name="password" className="input" type="password" autoComplete="current-password" />
            </div>
            <label className="authRemember">
              <input type="checkbox" name="remember" value="1" />
              <span>Recordarme</span>
            </label>
            <button className="primary" type="submit">
              Entrar
            </button>
          </form>

          <div className="authFootnote">Si no tienes acceso, valida el token del panel y las credenciales en el API.</div>
        </div>
      </div>
    </main>
  );
}
