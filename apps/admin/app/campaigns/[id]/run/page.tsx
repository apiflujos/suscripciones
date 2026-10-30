import { notFound } from "next/navigation";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { PendingButton } from "../../../ui/PendingButton";
import { getCsrfToken } from "../../../lib/csrf";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { resolveReturnTo, withReturnTo } from "../../../lib/returnTo";
import { getCampaignById } from "../../../admin/_services/campaigns";
import { runCampaign } from "../../actions";
import "../../campaigns.css";

export const dynamic = "force-dynamic";

/**
 * Enviar campaña: revisión y confirmación en una página (antes un modal de 560 px que
 * enviaba el formulario de la fila). El envío solo ocurre al pulsar el botón final.
 */
export default async function RunCampaignPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/campaigns");
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");
  const found = await getCampaignById(id);
  if (!found.ok) notFound();
  const campaign: any = found.campaign;
  const csrfToken = await getCsrfToken();

  const tp = (campaign.templateParams && typeof campaign.templateParams === "object" ? campaign.templateParams : null) as any;
  const tplName = String(tp?.name || "").trim();
  const tplLang = String(tp?.language || "").trim();
  const processed = tp?.processed_params || {};
  const bodyParams: Array<{ value: string }> = Array.isArray(processed.body) ? processed.body : [];
  const headerParams: Array<{ value: string }> = Array.isArray(processed.header) ? processed.header : [];
  const buttonParams: Array<{ value: string }> = Array.isArray(processed.buttons) ? processed.buttons : [];
  const running = campaign.status === "RUNNING";
  const resend = Number(campaign.sentCount || 0) > 0;
  const title = resend ? "Reenviar campaña" : "Enviar campaña";

  return (
    <PageShell
      title={title}
      subtitle={String(campaign.name || "")}
      crumbs={[{ label: "Campañas", href: returnTo }, { label: String(campaign.name || "Campaña") }, { label: title }]}
      backHref={returnTo}
      notice={
        error
          ? { tone: "error", text: error }
          : running
            ? { tone: "info", text: "Esta campaña ya se está enviando. Espera a que termine para volver a enviarla." }
            : null
      }
    >
      <form action={runCampaign} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="id" value={campaign.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="errorTo" value={withReturnTo(`/campaigns/${encodeURIComponent(campaign.id)}/run`, returnTo)} />

        <PageSection
          title="Revisa antes de enviar"
          description="Al confirmar, la campaña se pone en cola y se envía a toda la audiencia del filtro."
        >
          <div className="cp-summary">
            <dl>
              <div>
                <dt>Campaña</dt>
                <dd style={{ fontWeight: 600 }}>{campaign.name || "—"}</dd>
              </div>
              <div>
                <dt>Plantilla WhatsApp</dt>
                <dd>{tplName ? `${tplName}${tplLang ? ` (${tplLang})` : ""}` : "—"}</dd>
              </div>
              {campaign.content ? (
                <div>
                  <dt>Contenido</dt>
                  <dd className="muted" style={{ fontSize: 13 }}>{campaign.content}</dd>
                </div>
              ) : null}
              {bodyParams.length || headerParams.length || buttonParams.length ? (
                <div>
                  <dt>Variables</dt>
                  <dd className="muted" style={{ fontSize: 12 }}>
                    {[
                      bodyParams.length ? `Mensaje: ${bodyParams.map((p) => p.value).join(" | ")}` : "",
                      headerParams.length ? `Encabezado: ${headerParams.map((p) => p.value).join(" | ")}` : "",
                      buttonParams.length ? `Botones: ${buttonParams.map((p) => p.value).join(" | ")}` : ""
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Envíos hasta ahora</dt>
                <dd>
                  Enviados: {campaign.sentCount ?? 0} · Fallidos: {campaign.failedCount ?? 0}
                </dd>
              </div>
            </dl>
          </div>
        </PageSection>

        <FormActions cancelHref={returnTo}>
          <PendingButton className="primary btn-compact" type="submit" pendingText="Enviando..." disabled={running}>
            {title}
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
