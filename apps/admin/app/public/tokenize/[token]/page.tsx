import { normalizeErrorParam } from "../../../lib/errorParam";
import { fetchWompiAcceptanceLinks } from "../../../lib/wompiMerchant";
import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";

export const dynamic = "force-dynamic";

async function fetchPublicToken(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, status: 500, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function PublicTokenizePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = (await searchParams) ?? {};
  const tokenRes = await fetchPublicToken(token);
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const template = tokenRes.ok ? tokenRes.json?.template || null : null;
  const layout = (template?.layout || {}) as any;
  const title = template?.publicTitle || config?.subscriptionTitle || "Activa tu suscripción";
  const subtitle = "";
  const baseDescription =
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Usamos Wompi para tokenizar tu tarjeta. No se realizan cargos en este paso.";
  const description = ["Guarda tu método de pago en un paso seguro.", baseDescription]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  const tokenErrorMessage = String(config?.tokenizationErrorMessage || "").trim();
  const contactEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const logoUrl = template?.logoUrl || config?.logoUrl || "";
  const fontFamily = String(layout?.fontFamily || "").trim();
  const primaryColor = String(layout?.primaryColor || "").trim();
  const layoutSupportEmail = String(layout?.supportEmail || "").trim();
  const layoutSupportUrl = String(layout?.supportUrl || "").trim();
  const supportHref =
    (layoutSupportEmail ? `mailto:${layoutSupportEmail}` : layoutSupportUrl) ||
    (contactEmail ? `mailto:${contactEmail}` : supportUrl) ||
    "";
  const supportLabel =
    layoutSupportEmail ||
    layoutSupportUrl.replace(/^https?:\/\//, "") ||
    contactEmail ||
    supportUrl.replace(/^https?:\/\//, "") ||
    "";

  const publicKey = (() => {
    const raw = String(config?.wompiPublicKey || "").trim();
    if (!raw || raw.toLowerCase() === "undefined" || raw.toLowerCase() === "null") return "";
    return raw;
  })();
  const apiBaseUrl = (() => {
    const configured = String(config?.wompiApiBaseUrl || "").trim();
    if (configured) return configured;
    const activeEnv = String(config?.wompiActiveEnv || "PRODUCTION").toUpperCase();
    return activeEnv === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
  })();
  const acceptanceLinks = publicKey ? await fetchWompiAcceptanceLinks({ apiBaseUrl, publicKey }) : null;
  const inlineScript = `(() => {
  const script = document.currentScript;
  if (!script) return;
  const form = script.closest("form");
  if (!form) return;
  const terms = form.querySelector('[data-accept="terms"]');
  const personal = form.querySelector('[data-accept="personal"]');
  const hint = form.querySelector('[data-accept-hint]');
  const hiddenTerms = form.querySelector('input[name="accept_terms"]');
  const hiddenPersonal = form.querySelector('input[name="accept_personal_data"]');
  const update = () => {
    const termsOk = terms ? terms.checked : true;
    const personalOk = personal ? personal.checked : true;
    if (hiddenTerms) hiddenTerms.value = termsOk ? "1" : "0";
    if (hiddenPersonal) hiddenPersonal.value = personalOk ? "1" : "0";
    const button = form.querySelector(".waybox-button, button[type='submit'], button");
    if (!button) return;
    const lock = !(termsOk && personalOk);
    button.disabled = lock;
    button.setAttribute("aria-disabled", lock ? "true" : "false");
    button.style.pointerEvents = lock ? "none" : "";
    button.style.opacity = lock ? "0.6" : "";
    if (lock) button.setAttribute("data-locked", "true");
    else button.removeAttribute("data-locked");
    if (hint) hint.style.display = lock ? "" : "none";
  };
  update();
  if (terms) terms.addEventListener("change", update);
  if (personal) personal.addEventListener("change", update);
  const observer = new MutationObserver(update);
  observer.observe(form, { childList: true, subtree: true });
})();`;

  if (!tokenRes.ok) {
    const msg = "Este link no existe o ya no es válido. Solicita uno nuevo.";
    console.info("public_tokenize_error", {
      status: tokenRes.status,
      token,
      message: msg
    });
    return (
      <PublicErrorPage
        title={title}
        message={msg}
        logoUrl={logoUrl}
        trustText={PUBLIC_COPY.trustTokenize}
        supportHref={supportHref || undefined}
        supportLabel={supportLabel || undefined}
      />
    );
  }

  return (
    <PublicCheckoutLayout
      title={title}
      subtitle={subtitle}
      description={description}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustTokenize}
      securityBullets={[
        "Tus datos de tarjeta se tokenizan con Wompi.",
        "Conexión cifrada (HTTPS/TLS).",
        "No hay cargos en este paso."
      ]}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
    >
      {normalizeErrorParam(sp.error) ? (
        <PublicAlert>
          {tokenErrorMessage || "Ocurrió un error al guardar tu método de pago."} {PUBLIC_COPY.errorGenericHelp}
        </PublicAlert>
      ) : null}

      {!publicKey ? (
        <PublicAlert>Servicio temporalmente no disponible. Solicita un nuevo link o intenta más tarde.</PublicAlert>
      ) : !acceptanceLinks ? (
        <PublicAlert>No pudimos cargar los terminos de Wompi. Intenta mas tarde.</PublicAlert>
      ) : (
        <form method="POST" action={`/public/tokenize/${encodeURIComponent(token)}/process`} style={{ display: "grid", gap: 10 }}>
          <div className="field" style={{ display: "grid", gap: 6 }}>
            {acceptanceLinks.termsUrl ? (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" data-accept="terms" aria-required="true" />
                <span style={{ fontSize: 14 }}>
                  Acepto los terminos y condiciones de Wompi.{" "}
                  <a href={acceptanceLinks.termsUrl} target="_blank" rel="noreferrer">
                    Ver terminos
                  </a>
                  .
                </span>
              </label>
            ) : null}
            {acceptanceLinks.personalDataUrl ? (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" data-accept="personal" aria-required="true" />
                <span style={{ fontSize: 14 }}>
                  Autorizo el tratamiento de mis datos personales.{" "}
                  <a href={acceptanceLinks.personalDataUrl} target="_blank" rel="noreferrer">
                    Ver autorizacion
                  </a>
                  .
                </span>
              </label>
            ) : null}
            <div className="field-hint" data-accept-hint>
              Debes aceptar para continuar.
            </div>
          </div>
          <input type="hidden" name="accept_terms" value="0" />
          <input type="hidden" name="accept_personal_data" value="0" />
          <script
            src="https://checkout.wompi.co/widget.js"
            data-render="button"
            data-widget-operation="tokenize"
            data-public-key={publicKey}
            data-wompi-widget="tokenize"
          />
          <script dangerouslySetInnerHTML={{ __html: inlineScript }} />
        </form>
      )}
    </PublicCheckoutLayout>
  );
}
