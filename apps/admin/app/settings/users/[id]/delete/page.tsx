import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../../lib/session";
import { listAdminUsers } from "../../../../admin/_services/adminUsers";
import { PendingButton } from "../../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../../ui/PageShell";
import { getCsrfToken } from "../../../../lib/csrf";
import { resolveReturnTo } from "../../../../lib/returnTo";
import { deleteUser } from "../../actions";

export const dynamic = "force-dynamic";

/** Confirmar la eliminación de un usuario: segundo paso dentro de una página (antes, window.confirm). */
export default async function DeleteUserPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/settings?tab=usuarios");
  const c = await cookies();
  const session = await verifyAdminSessionToken(c.get(ADMIN_SESSION_COOKIE)?.value || "");
  const res = await listAdminUsers(session);
  const user = res.ok ? ((res.items || []) as any[]).find((u) => String(u.id) === id) : null;
  if (!user) notFound();
  const csrfToken = await getCsrfToken();
  const isSelf = String(user.email || "").trim().toLowerCase() === String(session?.email || "").trim().toLowerCase();
  const canManage = session?.role === "SUPER_ADMIN" || user.role !== "SUPER_ADMIN";
  const blocked = isSelf || !canManage;

  return (
    <PageShell
      title="Eliminar usuario"
      subtitle={user.email}
      crumbs={[{ label: "Ajustes", href: "/settings" }, { label: "Usuarios", href: returnTo }, { label: user.email }]}
      backHref={returnTo}
    >
      <form action={deleteUser} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="userId" value={String(user.id)} />
        <PageSection
          title={`¿Eliminar el usuario ${user.email}?`}
          description="Eliminará el acceso del usuario y sus asignaciones de tenant. Esta acción no se puede deshacer."
        >
          {blocked ? (
            <p className="field-hint ui-alert-warn">
              {isSelf ? "No puedes eliminar tu propio usuario desde esta pantalla." : "Solo un super admin puede eliminar este usuario."}
            </p>
          ) : null}
        </PageSection>
        <FormActions cancelHref={returnTo} cancelLabel="No, volver">
          <PendingButton className="ghost btn-compact btn-red btn-noicon" type="submit" pendingText="Eliminando..." disabled={blocked}>
            Sí, eliminar usuario
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
