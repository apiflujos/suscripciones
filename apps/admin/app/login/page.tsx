import { adminLogin } from "./actions";
import { getAdminApiConfig } from "../lib/adminApi";
import { LoginForm } from "./LoginForm";
import { getCsrfToken } from "../lib/csrf";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; next?: string; loggedOut?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = String(sp.error || "").trim();
  const next = String(sp.next || "").trim();
  const loggedOut = String(sp.loggedOut || "").trim() === "1";

  const { apiBase } = getAdminApiConfig();

  const errorMessage =
    error === "missing_admin_token"
      ? "Falta configurar el token del Admin (ADMIN_API_TOKEN)."
      : error === "api_unreachable"
        ? `No se pudo conectar al API (${apiBase}). Revisa NEXT_PUBLIC_API_BASE_URL, que el API esté arriba y que Render no apunte a localhost.`
        : error === "admin_api_expected_not_configured"
          ? "En el API falta configurar ADMIN_API_TOKEN."
          : error === "admin_api_token_mismatch"
            ? "El token del Admin (ADMIN_API_TOKEN) no coincide con el ADMIN_API_TOKEN del API."
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
  const showError = !!error && error !== "invalid_body";

  return (
    <main className="authMain">
      <div className="authCard loginCard">
        <div className="authCardInner loginCardInner">
          <div className="loginHeader">
            <div className="authBrand" aria-label="Marca">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-horizontal.png" alt="ApiFlujos" className="authLogo" />
            </div>
            <div className="loginBot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/avatar.png" alt="" />
            </div>
          </div>

          <div className="authHeader loginHeaderText">
            <h1 className="authTitle">Bienvenido</h1>
            <div className="authSubtitle">Ingresa para ver los pedidos y la trazabilidad.</div>
          </div>

          {loggedOut ? <div className="authAlert">Sesión cerrada.</div> : null}
          {showError ? <div className="authAlert is-danger">Error: {errorMessage}</div> : null}

          <LoginForm action={adminLogin} next={next} csrfToken={csrfToken} />
        </div>
      </div>
    </main>
  );
}
