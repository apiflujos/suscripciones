import { getCsrfToken } from "../../lib/csrf";
import { normalizeErrorParam } from "../../lib/errorParam";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { listAdminUsers } from "../../admin/_services/adminUsers";
import { listTenants } from "../../admin/_services/tenants";
import { UsersPanel } from "../UsersPanel";

export default async function SettingsUsersPage({
  searchParams
}: {
  searchParams?: Promise<{
    error?: string;
    created?: string;
    updated?: string;
    deleted?: string;
    passwordUpdated?: string;
  }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = normalizeErrorParam(sp.error);
  const created = String(sp.created || "").trim() === "1";
  const updated = String(sp.updated || "").trim() === "1";
  const deleted = String(sp.deleted || "").trim() === "1";
  const passwordUpdated = String(sp.passwordUpdated || "").trim() === "1";

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const usersRes = await listAdminUsers(session);
  const users: any[] = usersRes.ok ? usersRes.items || [] : [];
  const tenants = (await listTenants()).filter((t: any) => t?.active !== false);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const defaultTenantId = String(session?.tenantId || "").trim();

  return (
    <UsersPanel
      users={users}
      csrfToken={csrfToken}
      error={error}
      created={created}
      updated={updated}
      deleted={deleted}
      passwordUpdated={passwordUpdated}
      tenants={tenants}
      isSuperAdmin={isSuperAdmin}
      defaultTenantId={defaultTenantId}
      currentUserEmail={String(session?.email || "").trim().toLowerCase()}
      currentUserRole={String(session?.role || "").trim()}
      returnTo="/settings/users"
    />
  );
}
