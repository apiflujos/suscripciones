"use client";

import { createUser } from "./users/actions";
import { PendingButton } from "../ui/PendingButton";

export function UsersPanel({
  users,
  csrfToken,
  error,
  created,
  tenants,
  isSuperAdmin,
  defaultTenantId
}: {
  users: any[];
  csrfToken: string;
  error?: string | null;
  created?: boolean;
  tenants: Array<{ id: string; name: string }>;
  isSuperAdmin: boolean;
  defaultTenantId: string;
}) {
  return (
    <div className="ui-stack-lg">
      {created ? <div className="card cardPad pill-green ui-alert-success">Usuario creado exitosamente.</div> : null}
      {error ? (
        <div className="card cardPad ui-alert-danger">
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Nuevo Usuario</h3>
          <p className="field-hint">Los administradores tienen acceso total. Los asesores solo pueden ver datos y gestionar cobros.</p>
        </div>
        <div className="settings-group-body">
          <form action={createUser} className="panel module ui-form-grid-lg">
            <input type="hidden" name="csrf" value={csrfToken} />
            
            <div className="ui-grid-2">
              <div className="field">
                <label>Correo Electrónico</label>
                <input name="email" className="input" placeholder="usuario@empresa.com" autoComplete="off" required />
              </div>

              <div className="field">
                <label>Contraseña</label>
                <input name="password" className="input" type="password" autoComplete="new-password" required />
              </div>
            </div>

            <div className="ui-grid-2">
              <div className="field">
                <label>Rol</label>
                <select className="select" name="role" defaultValue="AGENT">
                  <option value="ADMIN">Administrador</option>
                  <option value="AGENT">Asesor (Asesor)</option>
                </select>
              </div>

              <div className="field ui-field-end">
                <label className="ui-inline-check">
                  <input name="active" value="1" type="checkbox" defaultChecked />
                  <span>Activo</span>
                </label>
              </div>
            </div>

            <div className="field">
              <label>Canales / Tenants</label>
              {isSuperAdmin ? (
                <div className="ui-stack-sm">
                  {(tenants || []).map((t) => (
                    <label key={t.id} className="ui-inline-check">
                      <input
                        type="checkbox"
                        name="tenantIds"
                        value={t.id}
                        defaultChecked={Boolean(defaultTenantId && String(t.id) === defaultTenantId)}
                      />
                      <span>{t.name}</span>
                    </label>
                  ))}
                  {!tenants.length ? <div className="field-hint">No hay tenants activos.</div> : null}
                </div>
              ) : (
                <div className="field-hint">
                  {defaultTenantId
                    ? `Asignado a: ${tenants.find((t) => String(t.id) === defaultTenantId)?.name || "Tenant actual"}`
                    : "No hay tenant asociado a tu sesión."}
                  {defaultTenantId ? <input type="hidden" name="tenantIds" value={defaultTenantId} /> : null}
                </div>
              )}
            </div>

            <div className="module-footer">
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
              <div key={u.id} className="card cardPad ui-user-row">
                <div>
                  <div className="ui-user-email">{u.email}</div>
                  <div className="field-hint">
                    {u.role === "ADMIN" ? "Administrador" : "Asesor"} · {u.active ? "Activo" : "Inactivo"}
                  </div>
                  {u?.tenantNames?.length ? (
                    <div className="field-hint">Canales: {u.tenantNames.join(", ")}</div>
                  ) : null}
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
