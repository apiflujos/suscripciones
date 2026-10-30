import { cookies } from "next/headers";
import { listSmartViews } from "@suscripciones/core/services/smartViews";
import { PageShell } from "../../ui/PageShell";
import { getCsrfToken } from "../../lib/csrf";
import { normalizeErrorParam } from "../../lib/errorParam";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { createCampaign } from "../actions";
import { NewCampaignForm } from "../NewCampaignForm";
import "../campaigns.css";

export const dynamic = "force-dynamic";

/** Nueva campaña. Era un modal de 900 px sobre la lista de campañas. */
export default async function NewCampaignPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/campaigns");
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");
  const csrfToken = await getCsrfToken();
  const c = await cookies();
  const session = await verifyAdminSessionToken(c.get(ADMIN_SESSION_COOKIE)?.value || "");
  const tenantId = session?.tenantId || null;
  let lists: any[] = [];
  if (tenantId) {
    try {
      lists = await listSmartViews("customers", tenantId, session?.email || null);
    } catch {
      lists = [];
    }
  }
  const views = lists
    .filter((v: any) => {
      const name = String(v?.name || "").toLowerCase();
      return !(name.startsWith("gamificación") || name.startsWith("ranking") || name.startsWith("estado"));
    })
    .map((v: any) => ({ id: String(v.id), name: String(v.name), visibility: v.visibility, type: v.type }));

  return (
    <PageShell
      title="Nueva campaña"
      subtitle="Elige la audiencia y la plantilla de WhatsApp. Guardar no envía nada: el envío se confirma aparte."
      crumbs={[{ label: "Campañas", href: returnTo }, { label: "Nueva campaña" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      <NewCampaignForm
        csrfToken={csrfToken}
        returnTo={returnTo}
        errorTo={withReturnTo("/campaigns/new", returnTo)}
        views={views}
        tenantId={tenantId}
        action={createCampaign}
      />
    </PageShell>
  );
}
