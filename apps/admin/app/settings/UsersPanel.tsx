"use client";

import { changeUserPassword, createUser, deleteUser, updateUser } from "./users/actions";
import { PendingButton } from "../ui/PendingButton";

export function UsersPanel({
  users,
  csrfToken,
  error,
  created,
  updated,
  deleted,
  passwordUpdated,
  tenants,
  isSuperAdmin,
  defaultTenantId,
  currentUserEmail,
  currentUserRole,
  returnTo
}: {
  users: any[];
  csrfToken: string;
  error?: string | null;
  created?: boolean;
  updated?: boolean;
  deleted?: boolean;
  passwordUpdated?: boolean;
  tenants: Array<{ id: string; name: string }>;
  isSuperAdmin: boolean;
  defaultTenantId: string;
  currentUserEmail: string;
  currentUserRole: string;
  returnTo: string;
}) {
  return (
    <div className="ui-stack-lg">
      {created ? <div className="card cardPad pill-green ui-alert-success">Usuario creado exitosamente.</div> : null}
      {updated ? <div className="card cardPad pill-green ui-alert-success">Usuario actualizado.</div> : null}
      {passwordUpdated ? <div className="card cardPad pill-green ui-alert-success">Contraseña actualizada.</div> : null}
      {deleted ? <div className="card cardPad pill-green ui-alert-success">Usuario eliminado.</div> : null}
      {error ? (
        <div className="card cardPad ui-alert-danger">
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Nuevo Usuario</h3>
            <p className="field-hint">Los administradores tienen acceso total. Los asesores solo pueden ver datos y gestionar cobros.</p>
          </div>
        </div>
        <div className="settings-group-body">
          <form action={createUser} className="panel module ui-form-grid-lg">
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="returnTo" value={returnTo} />

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
                  <option value="AGENT">Asesor</option>
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
              <PendingButton className="primary btn-compact" type="submit" pendingText="Creando...">
                Crear Usuario
              </PendingButton>
            </div>
          </form>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Usuarios Registrados</h3>
            <p className="field-hint">Cada usuario se puede abrir para ver detalle, editarlo, cambiar contraseña o eliminarlo.</p>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="stack">
            {users.map((u) => {
              const isCurrentUser = String(u.email || "").trim().toLowerCase() === currentUserEmail;
              const assignedTenantIds = Array.isArray(u.tenantIds) ? u.tenantIds.map((item: string) => String(item)) : [];
              const canManageRow = currentUserRole === "SUPER_ADMIN" || u.role !== "SUPER_ADMIN";
              return (
                <details key={u.id} className="card cardPad">
                  <summary
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      cursor: "pointer",
                      listStyle: "none",
                      alignItems: "flex-start"
                    }}
                  >
                    <div>
                      <div className="ui-user-email">{u.email}</div>
                      <div className="field-hint">
                        {u.role === "SUPER_ADMIN" ? "Super Admin" : u.role === "ADMIN" ? "Administrador" : "Asesor"} · {u.active ? "Activo" : "Inactivo"}
                      </div>
                      <div className="field-hint">
                        ID: <code>{u.id}</code>
                      </div>
                      <div className="field-hint">
                        Creado: {new Date(u.createdAt).toLocaleString()} · Actualizado:{" "}
                        {u.updatedAt ? new Date(u.updatedAt).toLocaleString() : "—"}
                      </div>
                      {u?.tenantNames?.length ? <div className="field-hint">Canales: {u.tenantNames.join(", ")}</div> : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className={`pill ${u.role === "ADMIN" || u.role === "SUPER_ADMIN" ? "pill-blue" : "pill-muted"}`}>
                        {u.role}
                      </span>
                      <span className={`pill ${u.active ? "" : "pillDanger"}`}>{u.active ? "Activo" : "Inactivo"}</span>
                    </div>
                  </summary>

                  <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
                    <form action={updateUser} className="panel module ui-form-grid-lg">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="userId" value={u.id} />
                      {!canManageRow ? <input type="hidden" name="role" value={u.role} /> : null}

                      <div className="ui-grid-2">
                        <div className="field">
                          <label>Correo Electrónico</label>
                          <input name="email" className="input" defaultValue={u.email} autoComplete="off" required disabled={!canManageRow} />
                        </div>

                        <div className="field">
                          <label>Rol</label>
                          <select
                            className="select"
                            name="role"
                            defaultValue={u.role}
                            disabled={!canManageRow}
                          >
                            {currentUserRole === "SUPER_ADMIN" ? <option value="SUPER_ADMIN">Super Admin</option> : null}
                            <option value="ADMIN">Administrador</option>
                            <option value="AGENT">Asesor</option>
                          </select>
                        </div>
                      </div>

                      <div className="field ui-field-end">
                        <label className="ui-inline-check">
                          <input name="active" value="1" type="checkbox" defaultChecked={Boolean(u.active)} disabled={!canManageRow} />
                          <span>Activo</span>
                        </label>
                        {!canManageRow ? <div className="field-hint">Solo un super admin puede modificar este usuario.</div> : null}
                        {isCurrentUser ? <div className="field-hint">Tu propio acceso no se puede desactivar ni cambiar de rol desde aquí.</div> : null}
                      </div>

                      <div className="field">
                        <label>Canales / Tenants</label>
                        {isSuperAdmin ? (
                          <div className="ui-stack-sm">
                            {(tenants || []).map((t) => (
                              <label key={`${u.id}-${t.id}`} className="ui-inline-check">
                                <input
                                  type="checkbox"
                                  name="tenantIds"
                                  value={t.id}
                                  defaultChecked={assignedTenantIds.includes(t.id)}
                                  disabled={!canManageRow}
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
                        <PendingButton className="primary btn-compact" type="submit" pendingText="Guardando..." disabled={!canManageRow}>
                          Guardar cambios
                        </PendingButton>
                      </div>
                    </form>

                    <form action={changeUserPassword} className="panel module ui-form-grid-lg">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="userId" value={u.id} />
                      <div className="field">
                        <label>Nueva Contraseña</label>
                        <input
                          name="password"
                          className="input"
                          type="password"
                          minLength={8}
                          autoComplete="new-password"
                          required
                          disabled={!canManageRow}
                        />
                        <div className="field-hint">Mínimo 8 caracteres.</div>
                      </div>
                      <div className="module-footer">
                        <PendingButton className="primary btn-compact" type="submit" pendingText="Actualizando..." disabled={!canManageRow}>
                          Cambiar contraseña
                        </PendingButton>
                      </div>
                    </form>

                    <form
                      action={deleteUser}
                      className="panel module"
                      onSubmit={(event) => {
                        if (!window.confirm(`Vas a eliminar el usuario ${u.email}. Esta acción no se puede deshacer.`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="userId" value={u.id} />
                      <div className="field-hint" style={{ marginBottom: 12 }}>
                        Eliminará el acceso del usuario y sus asignaciones de tenant.
                      </div>
                      <PendingButton className="btn-compact" type="submit" pendingText="Eliminando..." disabled={!canManageRow || isCurrentUser}>
                        Eliminar usuario
                      </PendingButton>
                      {isCurrentUser ? (
                        <div className="field-hint" style={{ marginTop: 8 }}>
                          No puedes eliminar tu propio usuario desde esta pantalla.
                        </div>
                      ) : null}
                    </form>
                  </div>
                </details>
              );
            })}
            {!users.length ? <div className="card cardPad">No hay usuarios adicionales.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
