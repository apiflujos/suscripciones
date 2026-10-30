import type { Crumb } from "../ui/PageShell";
import { normalizeErrorParam } from "../lib/errorParam";
import { resolveReturnTo, withReturnTo } from "../lib/returnTo";
import { loadBillingRow, type BillingRowPageData } from "./loadBillingRow";

type RouteParams = Promise<{ id: string }>;
type RouteSearch = Promise<Record<string, string | string[] | undefined>> | undefined;

export type SubscriptionPageContext = BillingRowPageData & {
  id: string;
  sp: Record<string, string | string[] | undefined>;
  /** Adónde vuelve "Volver"/"Cancelar" y qué recibe la acción al terminar. */
  returnTo: string;
  /** Detalle de esta suscripción, conservando el retorno a la lista. */
  detailHref: string;
  error: string;
  crumbs: (title: string) => Crumb[];
  subtitle: string;
};

/**
 * Lo común de toda página dedicada de una suscripción: parámetros, retorno,
 * datos de la fila, migas de pan y subtítulo. Cada página solo pone su formulario.
 *
 * `returnTo` lo manda quien enlaza (la lista, el detalle…). Si no viene, se vuelve
 * al detalle de la suscripción.
 */
export async function loadSubscriptionPage(params: RouteParams, searchParams: RouteSearch): Promise<SubscriptionPageContext> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const data = await loadBillingRow(id);
  const listReturn = resolveReturnTo(sp.returnTo, "/billing");
  const detailHref = `/billing/${encodeURIComponent(id)}`;
  const returnTo = resolveReturnTo(sp.returnTo, detailHref);
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");
  return {
    ...data,
    id,
    sp,
    returnTo,
    detailHref: withReturnTo(detailHref, listReturn),
    error,
    subtitle: `${data.row.customerName} · ${data.row.productName || data.row.planName}`,
    crumbs: (title: string) => [
      { label: "Suscripciones", href: "/billing" },
      { label: data.row.customerName, href: withReturnTo(detailHref, listReturn) },
      { label: title }
    ]
  };
}

export function money(cents: number, currency = "COP") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);
}
