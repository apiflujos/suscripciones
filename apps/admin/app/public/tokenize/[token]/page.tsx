import { WompiTokenizeWidget } from "../../../customers/[id]/payment-method/WompiTokenizeWidget";
import { fetchAdminCached, getAdminApiConfig } from "../../../lib/adminApi";

export const dynamic = "force-dynamic";

async function fetchPublicToken(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
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
  const { token: adminToken } = getAdminApiConfig();
  const settingsRes = adminToken ? await fetchAdminCached("/admin/settings", { ttlMs: 1500 }) : { ok: false, json: null };
  const settings = settingsRes.ok ? settingsRes.json : null;

  const title = settings?.publicCheckout?.title || "Activa tu suscripción";
  const subtitle = settings?.publicCheckout?.subtitle || "Guarda tu método de pago en un paso seguro.";
  const description =
    settings?.publicCheckout?.description ||
    "Usamos Wompi para tokenizar tu tarjeta. No se realizan cargos en este paso.";
  const contactEmail = settings?.publicCheckout?.contactEmail || "";

  const publicKey = (() => {
    const activeEnv = String(settings?.wompi?.activeEnv || "PRODUCTION").toUpperCase();
    const wompiEnv =
      activeEnv === "SANDBOX" ? settings?.wompi?.sandbox : settings?.wompi?.production;
    return String(wompiEnv?.publicKey || "").trim();
  })();

  if (!tokenRes.ok) {
    const msg =
      tokenRes.status === 410
        ? "Este link ya fue usado o está vencido."
        : "El link no es válido.";
    return (
      <main className="page" style={{ maxWidth: 680 }}>
        <div className="card cardPad">
          <h1 style={{ marginTop: 0 }}>{title}</h1>
          <p>{msg}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 680 }}>
      <div className="card cardPad" style={{ display: "grid", gap: 12 }}>
        <div>
          <h1 style={{ marginTop: 0 }}>{title}</h1>
          <p style={{ marginTop: 6 }}>{subtitle}</p>
          <p className="field-hint">{description}</p>
        </div>

        {sp.error ? (
          <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
            Error: {sp.error}
          </div>
        ) : null}

        {!publicKey ? (
          <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
            Servicio temporalmente no disponible.
          </div>
        ) : (
          <form method="POST" action={`/public/tokenize/${encodeURIComponent(token)}/process`} style={{ display: "grid", gap: 10 }}>
            <WompiTokenizeWidget publicKey={publicKey} />
          </form>
        )}

        {contactEmail ? (
          <div className="field-hint">
            ¿Necesitas ayuda? Escríbenos a {contactEmail}.
          </div>
        ) : null}
      </div>
    </main>
  );
}
