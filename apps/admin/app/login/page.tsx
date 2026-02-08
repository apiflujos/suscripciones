import { adminLogin, bootstrapSuperAdmin } from "./actions";
import { getAdminApiConfig } from "../lib/adminApi";

export default async function LoginPage({ searchParams }: { searchParams?: { error?: string; next?: string; loggedOut?: string } }) {
  const error = String(searchParams?.error || "").trim();
  const next = String(searchParams?.next || "").trim();
  const loggedOut = String(searchParams?.loggedOut || "").trim() === "1";

  const { apiBase } = getAdminApiConfig();

  const errorMessage =
    error === "missing_admin_token"
      ? "Falta configurar el token del Admin (API_ADMIN_TOKEN) y el token del API (ADMIN_API_TOKEN)."
      : error === "api_unreachable"
        ? `No se pudo conectar al API (${apiBase}). Revisa NEXT_PUBLIC_API_BASE_URL, que el API esté arriba y que Render no apunte a localhost.`
        : error === "admin_api_expected_not_configured"
          ? "En el API falta configurar ADMIN_API_TOKEN (o API_ADMIN_TOKEN)."
          : error === "admin_api_token_mismatch"
            ? "El token del Admin (API_ADMIN_TOKEN) no coincide con el ADMIN_API_TOKEN del API."
            : error === "no_admin_users"
              ? "No hay usuarios creados todavía. Inicializa el primer Super Admin (abajo) y luego crea más usuarios en /sa/users."
              : error === "no_super_admin_user"
                ? "No existe ningún Super Admin todavía. Inicialízalo (abajo)."
                : error === "already_bootstrapped"
                  ? "Ya existe un Super Admin. Inicia sesión normalmente."
                  : error === "email_already_exists"
                    ? "Ese email ya existe. Inicia sesión o usa otro email."
                    : error === "missing_sa_token"
                      ? "No se pudo crear la sesión de Super Admin."
            : error === "unauthorized"
              ? "Credenciales inválidas o usuario no existe."
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

          <details className="authAlert" open={error === "no_admin_users" || error === "no_super_admin_user"}>
            <summary style={{ cursor: "pointer" }}>Inicializar Super Admin (solo primera vez)</summary>
            <div style={{ marginTop: 8 }}>
              <form action={bootstrapSuperAdmin} className="authForm">
                <input type="hidden" name="next" value="/sa" />
                <div className="field">
                  <label>Email</label>
                  <input name="email" className="input" placeholder="superadmin@empresa.com" autoComplete="username" required />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input name="password" className="input" type="password" autoComplete="new-password" required />
                  <div className="field-hint">Mínimo 8 caracteres.</div>
                </div>
                <button className="primary" type="submit">
                  Crear Super Admin
                </button>
              </form>
            </div>
          </details>

          <div className="authFootnote">Si no tienes acceso, valida NEXT_PUBLIC_API_BASE_URL y que el token del panel coincida con el del API.</div>
        </div>
      </div>
    </main>
  );
}
