"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";

export function LoginForm({
  action,
  next,
  csrfToken
}: {
  action: (formData: FormData) => void;
  next: string;
  csrfToken: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="loginForm">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="csrf" value={csrfToken} />
      <div className="field">
        <label>Usuario</label>
        <input name="email" className="input loginInput" placeholder="admin@apiflujos.com" autoComplete="username" required />
      </div>
      <div className="field">
        <label>Contraseña</label>
        <div className="loginPasswordWrap">
          <input
            name="password"
            className="input loginInput"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button type="button" className="loginToggle" onClick={() => setShow((v) => !v)}>
            {show ? "Ocultar" : "Ver"}
          </button>
        </div>
      </div>
      <label className="loginRemember">
        <input type="checkbox" name="remember" value="1" />
        <span>Recordarme</span>
      </label>
      <PendingButton className="primary loginPrimary" type="submit" pendingText="Entrando...">
        Entrar
      </PendingButton>
    </form>
  );
}
