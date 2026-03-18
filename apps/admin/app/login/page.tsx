import { adminLogin } from "./actions";
import { LoginForm } from "./LoginForm";
import { getCsrfToken } from "../lib/csrf";
import { normalizeErrorParam } from "../lib/errorParam";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; next?: string; loggedOut?: string }>;
}) {
  const sessionToken = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = sessionToken ? await verifyAdminSessionToken(sessionToken) : null;

  if (session) {
    const sp = (await searchParams) ?? {};
    const next = String(sp.next || "").trim();
    redirect(next || "/");
  }

  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = normalizeErrorParam(sp.error);
  const next = String(sp.next || "").trim();
  const loggedOut = String(sp.loggedOut || "").trim() === "1";

  const errorMessage =
    error === "no_admin_users"
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
              <img src="/brand/logo_horizontal.svg" alt="Logo" className="authLogo" style={{ display: 'block' }} data-theme-logo="horizontal" />
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
