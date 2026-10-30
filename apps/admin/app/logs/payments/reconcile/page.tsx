import { PageShell } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { resolveReturnTo } from "../../../lib/returnTo";
import { requireSuperAdmin } from "../../loadPayment";
import { ReconcileForm } from "../../ReconcileForm";

export const dynamic = "force-dynamic";

/** Reconciliar un pago de Wompi escribiendo sus identificadores (antes, modal de la cabecera de Pagos). */
export default async function ReconcileManualPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/payments");
  const csrfToken = await getCsrfToken();
  return (
    <PageShell
      title="Reconciliar pago Wompi"
      subtitle="Consulta el pago en Wompi y actualiza su estado en el sistema."
      crumbs={[{ label: "Pagos", href: returnTo }, { label: "Reconciliar pago" }]}
      backHref={returnTo}
    >
      <ReconcileForm csrfToken={csrfToken} returnTo={returnTo} />
    </PageShell>
  );
}
