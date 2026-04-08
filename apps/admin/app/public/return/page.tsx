import { PublicCheckoutLayout } from "../_components/PublicCheckoutLayout";
import { PublicAlert } from "../_components/PublicAlert";
import { fetchPublicJsonAcrossBases, getPublicApiBases } from "../_components/publicRuntime";

export const dynamic = "force-dynamic";

function resolveReturnState(searchParams: Record<string, string | undefined>) {
  const status = String(searchParams.status || searchParams.payment_status || "").trim().toUpperCase();
  const error = String(searchParams.error || searchParams.reason || "").trim();
  if (error || ["ERROR", "DECLINED", "FAILED", "VOIDED"].includes(status)) {
    return {
      tone: "error" as const,
      title: "No pudimos confirmar el pago",
      subtitle: "Puedes intentarlo de nuevo o pedir ayuda.",
      description: error || "Wompi reportó un problema procesando la transacción."
    };
  }
  if (["APPROVED", "PAID", "SUCCESS"].includes(status)) {
    return {
      tone: "success" as const,
      title: "Pago recibido",
      subtitle: "Tu pago fue registrado correctamente.",
      description: "Si todo está en orden, no necesitas hacer nada más."
    };
  }
  return {
    tone: "info" as const,
    title: "Estamos verificando tu pago",
    subtitle: "La confirmación puede tardar unos minutos.",
    description: "Si ya pagaste, puedes cerrar esta ventana. Te avisaremos cuando el proceso termine."
  };
}

export default async function PublicReturnPage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string; payment_status?: string; error?: string; reason?: string; id?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const apiBases = await getPublicApiBases();
  const configRes = await fetchPublicJsonAcrossBases("/public/checkout-config", apiBases);
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const state = resolveReturnState(sp);
  const logoUrl = config?.logoUrl || "";
  const contactEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const supportHref = contactEmail ? `mailto:${contactEmail}` : supportUrl;
  const supportLabel = contactEmail || supportUrl.replace(/^https?:\/\//, "");
  const returnHref = String(config?.tokenizationReturnUrl || config?.publicReturnUrl || "").trim() || "/";

  return (
    <PublicCheckoutLayout
      title={state.title}
      subtitle={state.subtitle}
      description={state.description}
      logoUrl={logoUrl}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      maxWidth={680}
      variant="single"
    >
      <div className="publicErrorStack">
        {sp.id ? <PublicAlert>Referencia Wompi: {String(sp.id).trim()}</PublicAlert> : null}
        <a className="primary btn-compact btn-noicon" href={returnHref} style={{ width: "fit-content" }} referrerPolicy="no-referrer">
          Volver
        </a>
        {supportHref ? (
          <a className="ghost btn-compact btn-noicon" href={supportHref} style={{ width: "fit-content" }} referrerPolicy="no-referrer">
            Contactar soporte
          </a>
        ) : null}
      </div>
    </PublicCheckoutLayout>
  );
}
