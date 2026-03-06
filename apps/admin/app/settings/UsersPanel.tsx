"use client";

import { createUser } from "./users/actions";
import { PendingButton } from "../ui/PendingButton";

export function UsersPanel({
  users,
  csrfToken,
  error,
  created
}: {
  users: any[];
  csrfToken: string;
  error?: string | null;
  created?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {created ? <div className="card cardPad pill-green" style={{ color: "white" }}>Usuario creado exitosamente.</div> : null}
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Nuevo Usuario</h3>
          <p className="field-hint">Los administradores tienen acceso total. Los asesores solo pueden ver datos y gestionar cobros.</p>
        </div>
        <div className="settings-group-body">
          <form action={createUser} className="panel module" style={{ display: "grid", gap: 16 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label>Correo Electrónico</label>
                <input name="email" className="input" placeholder="usuario@empresa.com" autoComplete="off" required />
              </div>

              <div className="field">
                <label>Contraseña</label>
                <input name="password" className="input" type="password" autoComplete="new-password" required />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label>Rol</label>
                <select className="select" name="role" defaultValue="AGENT">
                  <option value="ADMIN">Administrador</option>
                  <option value="AGENT">Asesor (Asesor)</option>
                </select>
              </div>

              <div className="field" style={{ display: "flex", alignItems: "end" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", height: 38 }}>
                  <input name="active" value="1" type="checkbox" defaultChecked />
                  <span>Activo</span>
                </label>
              </div>
            </div>

            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              <PendingButton className="primary" type="submit" pendingText="Creando...">
                Crear Usuario
              </PendingButton>
            </div>
          </form>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Usuarios Registrados</h3>
        </div>
        <div className="settings-group-body">
          <div className="stack">
            {users.map((u) => (
              <div key={u.id} className="card cardPad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{u.email}</div>
                  <div className="field-hint">
                    {u.role === "ADMIN" ? "Administrador" : "Asesor"} · {u.active ? "Activo" : "Inactivo"}
                  </div>
                </div>
                <span className={`pill ${u.role === "ADMIN" ? "pill-blue" : "pill-muted"}`}>
                  {u.role}
                </span>
              </div>
            ))}
            {!users.length ? <div className="card cardPad">No hay usuarios adicionales.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
