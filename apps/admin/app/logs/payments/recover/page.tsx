import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { PendingButton } from "../../../ui/PendingButton";
import { getCsrfToken } from "../../../lib/csrf";
import { resolveReturnTo } from "../../../lib/returnTo";
import { recoverWompiTransactions } from "@suscripciones/core/services/wompiRecovery";
import { recoverWompiPayments } from "../../actions";
import { requireSuperAdmin } from "../../loadPayment";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(Date.now() - n * 86_400_000));
const money = (cents: number | null, currency: string | null) =>
  cents == null ? "—" : new Intl.NumberFormat("es-CO", { style: "currency", currency: currency || "COP", maximumFractionDigits: 0 }).format(cents / 100);
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(iso)) : "—";

/**
 * Recupera de Wompi los pagos cuyo webhook nunca llegó (una caída): los registra
 * como si hubieran llegado y encola el reenvío a Shopify de los que son de Shopify.
 */
export default async function RecoverWompiPaymentsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/payments");
  const csrfToken = await getCsrfToken();

  const fromDay = one(sp.from) || daysAgo(3);
  const untilDay = one(sp.until) || today();
  const done = one(sp.done) === "1";
  const searched = Boolean(one(sp.from) && one(sp.until)) && !done;
  const preview = searched ? await recoverWompiTransactions({ fromDay, untilDay, apply: false }) : null;
  const pending = preview?.items.filter((i) => i.outcome === "pendiente") ?? [];

  const notice = done
    ? {
        tone: Number(one(sp.fail)) || one(sp.err) ? ("error" as const) : ("ok" as const),
        text: `${one(sp.ok) || 0} pagos recuperados · ${one(sp.had) || 0} ya los teníamos · ${one(sp.fail) || 0} con error${one(sp.err) ? `: ${one(sp.err)}` : ""}`
      }
    : preview?.error
      ? { tone: "error" as const, text: preview.error }
      : null;

  return (
    <PageShell
      title="Recuperar pagos de Wompi"
      subtitle="Trae los pagos aprobados que no nos llegaron y reenvía a Shopify los que son de Shopify."
      crumbs={[{ label: "Pagos", href: returnTo }, { label: "Recuperar de Wompi" }]}
      backHref={returnTo}
      notice={notice}
    >
      <PageSection
        title="1. Buscar lo que falta"
        description="Elige el rango de la caída (hora de Bogotá). Se consultan en Wompi los pagos aprobados y se marcan los que ya tenemos."
      >
        <form method="get" className="page-shell-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field">
            <label htmlFor="from">Desde</label>
            <input id="from" className="input" type="date" name="from" defaultValue={fromDay} required />
          </div>
          <div className="field">
            <label htmlFor="until">Hasta</label>
            <input id="until" className="input" type="date" name="until" defaultValue={untilDay} required />
          </div>
          <button className="ghost btn-compact btn-noicon" type="submit">Ver qué falta</button>
        </form>
      </PageSection>

      {preview && !preview.error ? (
        <form action={recoverWompiPayments} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="from" value={fromDay} />
          <input type="hidden" name="until" value={untilDay} />
          <PageSection
            title={`Pagos aprobados en Wompi (${preview.items.length}) · faltan ${pending.length}`}
            description="Los de Shopify se reenviarán a Shopify al recuperarlos. Los que ya tenemos no se tocan."
          >
            {preview.items.length === 0 ? (
              <p style={{ margin: 0 }}>Wompi no devolvió pagos aprobados en ese rango.</p>
            ) : (
              <div className="field" style={{ display: "grid", gap: 8 }}>
                {preview.items.map((item) => (
                  <div key={item.id} style={{ display: "grid", gap: 2, opacity: item.outcome === "ya_recibido" ? 0.6 : 1 }}>
                    <strong>
                      {when(item.createdAt)} · {money(item.amountInCents, item.currency)}
                      {item.shopify ? " · Shopify" : ""}
                    </strong>
                    <span className="muted" style={{ overflowWrap: "anywhere" }}>
                      {item.reference || "sin referencia"} · {item.id} · {item.outcome === "ya_recibido" ? "ya lo teníamos" : "falta"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </PageSection>
          <FormActions cancelHref={returnTo}>
            <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Recuperando..." disabled={pending.length === 0}>
              Recuperar {pending.length} {pending.length === 1 ? "pago" : "pagos"} y reenviar a Shopify
            </PendingButton>
          </FormActions>
        </form>
      ) : null}

      <form action={recoverWompiPayments} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <PageSection
          title="2. O pega los IDs de transacción"
          description="Si prefieres, copia los IDs desde el panel de Wompi (uno por línea). Los que ya tenemos se omiten."
        >
          <div className="field">
            <label htmlFor="ids">IDs de transacción</label>
            <textarea id="ids" className="input" name="ids" rows={5} placeholder={"11xxxx-1793xxxxxx-xxxxx\n11xxxx-1793xxxxxx-xxxxx"} />
          </div>
        </PageSection>
        <FormActions cancelHref={returnTo}>
          <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Recuperando...">
            Recuperar estos IDs
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
