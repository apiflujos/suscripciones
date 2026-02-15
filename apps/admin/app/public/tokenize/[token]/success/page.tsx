import { fetchAdminCached, getAdminApiConfig } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

export default async function PublicTokenizeSuccessPage() {
  const { token } = getAdminApiConfig();
  const settingsRes = token ? await fetchAdminCached("/admin/settings", { ttlMs: 1500 }) : { ok: false, json: null };
  const settings = settingsRes.ok ? settingsRes.json : null;

  const title = settings?.publicCheckout?.title || "Gracias";
  const subtitle = settings?.publicCheckout?.subtitle || "Tu método de pago quedó guardado.";
  const description =
    settings?.publicCheckout?.description ||
    "Desde ahora podremos procesar tu suscripción de forma automática.";
  const contactEmail = settings?.publicCheckout?.contactEmail || "";

  return (
    <main className="page" style={{ maxWidth: 680 }}>
      <div className="card cardPad" style={{ display: "grid", gap: 12 }}>
        <div>
          <h1 style={{ marginTop: 0 }}>{title}</h1>
          <p style={{ marginTop: 6 }}>{subtitle}</p>
          <p className="field-hint">{description}</p>
        </div>
        {contactEmail ? (
          <div className="field-hint">
            ¿Necesitas ayuda? Escríbenos a {contactEmail}.
          </div>
        ) : null}
      </div>
    </main>
  );
}
