import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";

export const dynamic = "force-dynamic";

async function fetchCart(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, status: 500, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/api/public/cart/${encodeURIComponent(token)}`, { cache: "no-store" });
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

function formatMoney(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

function formatInterval(unit: string, count: number) {
  const n = Number(count || 1);
  const u = String(unit || "MONTH").toUpperCase();
  if (u === "DAY") return n === 1 ? "cada día" : `cada ${n} días`;
  if (u === "WEEK") return n === 1 ? "cada semana" : `cada ${n} semanas`;
  if (u === "MONTH") return n === 1 ? "cada mes" : `cada ${n} meses`;
  return n === 1 ? "periódico" : `cada ${n} periodos`;
}

export default async function PublicCartPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = searchParams ? await searchParams : {};
  const cartRes = await fetchCart(token);
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const template = cartRes.ok ? cartRes.json?.template || null : null;
  const tenant = cartRes.ok ? cartRes.json?.tenant || null : null;
  const layout = (template?.layout || {}) as any;
  const title = template?.publicTitle || config?.planTitle || "Selecciona tu plan";
  const description = template?.publicDescription || config?.planDescription || "";
  const logoUrl = (() => {
    const candidates = [template?.logoUrl, tenant?.logoUrl, config?.logoUrl];
    for (const candidate of candidates) {
      const raw = String(candidate || "").trim();
      if (raw && raw.toLowerCase() !== "undefined" && raw.toLowerCase() !== "null") return raw;
    }
    return "";
  })();
  const primaryColor = String(layout?.primaryColor || "").trim();
  const fontFamily = String(layout?.fontFamily || "").trim();
  const supportEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const layoutSupportEmail = String(layout?.supportEmail || "").trim();
  const layoutSupportUrl = String(layout?.supportUrl || "").trim();
  const supportHref = (layoutSupportEmail ? `mailto:${layoutSupportEmail}` : layoutSupportUrl) || (supportEmail ? `mailto:${supportEmail}` : supportUrl) || "";
  const supportLabel =
    layoutSupportEmail ||
    layoutSupportUrl.replace(/^https?:\/\//, "") ||
    supportEmail ||
    supportUrl.replace(/^https?:\/\//, "") ||
    "";

  if (!cartRes.ok) {
    const msg = cartRes.status === 410 ? PUBLIC_COPY.errorExpiredLink : PUBLIC_COPY.errorInvalidLink;
    return (
      <PublicErrorPage
        title={title}
        message={msg}
        logoUrl={logoUrl}
        trustText={PUBLIC_COPY.trustPayment}
        tenantName={tenant?.name || ""}
        supportHref={supportHref || undefined}
        supportLabel={supportLabel || undefined}
      />
    );
  }

  const customer = cartRes.json?.customer || {};
  const products = Array.isArray(cartRes.json?.products) ? cartRes.json.products : [];
  const errorMsg = String(sp?.error || "").trim();

  return (
    <PublicCheckoutLayout
      title={title}
      description={description}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustPayment}
      tenantName={tenant?.name || ""}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
    >
      {customer?.name ? (
        <div className="field">
          <label>Cliente</label>
          <input className="input" readOnly value={customer.name || ""} />
        </div>
      ) : null}
      {errorMsg ? <PublicAlert>{errorMsg}</PublicAlert> : null}
      {!products.length ? (
        <PublicAlert>No hay productos disponibles en este catálogo.</PublicAlert>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {products.map((p: any) => {
            const mode = String(p?.collectionMode || "");
            const label = mode === "AUTO_DEBIT" ? "Suscripción" : "Plan";
            return (
              <div key={p.id} className="card cardPad" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="field-hint">{label}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{formatMoney(p.priceInCents, p.currency)}</div>
                    <div className="field-hint">{formatInterval(p.intervalUnit, p.intervalCount)}</div>
                  </div>
                </div>
                <form method="POST" action={`/api/public/cart/${encodeURIComponent(token)}/select`}>
                  <input type="hidden" name="planId" value={p.id} />
                  <button className="primary" type="submit">
                    Continuar
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </PublicCheckoutLayout>
  );
}
