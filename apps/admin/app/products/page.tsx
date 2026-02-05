import Link from "next/link";
import { createOrder, createProduct } from "./actions";
import { VariantsEditor } from "./VariantsEditor";
import { SubscriptionDateFields } from "../subscriptions/SubscriptionDateFields";
import { createPaymentLink, createPlan, createSubscription } from "../subscriptions/actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token: process.env.API_ADMIN_TOKEN || ""
  };
}

async function fetchAdmin(path: string) {
  const { apiBase, token } = getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

function fmtMoney(p: any) {
  const cents = Number(p);
  if (!Number.isFinite(cents)) return "—";
  const pesos = Math.trunc(cents / 100);
  return `$${pesos.toLocaleString("es-CO")}`;
}

export default async function ProductsPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Productos y Servicios</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const tab = typeof searchParams?.tab === "string" ? searchParams.tab : "inventory";
  const created = typeof searchParams?.created === "string" ? searchParams.created : "";
  const checkoutUrl = typeof searchParams?.checkoutUrl === "string" ? searchParams.checkoutUrl : "";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";

  const [products, plans, subs, customers] = await Promise.all([
    fetchAdmin("/admin/products"),
    fetchAdmin("/admin/plans"),
    fetchAdmin("/admin/subscriptions"),
    fetchAdmin("/admin/customers")
  ]);

  const productItems = (products.json?.items ?? []) as any[];
  const planItems = (plans.json?.items ?? []) as any[];
  const subItems = (subs.json?.items ?? []) as any[];
  const customerItems = (customers.json?.items ?? []) as any[];
  const orders = tab === "orders" ? await fetchAdmin("/admin/orders") : null;
  const orderItems = (orders?.json?.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
      {checkoutUrl ? (
        <div className="card cardPad">
          Checkout:{" "}
          <a href={checkoutUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            abrir link
          </a>
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <h3>Productos y Servicios</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <a
                className={`ghost ${tab === "inventory" ? "is-active" : ""}`}
                href={`/products?${new URLSearchParams({ tab: "inventory" })}`}
              >
                Inventario
              </a>
              <a
                className={`ghost ${tab === "commercial" ? "is-active" : ""}`}
                href={`/products?${new URLSearchParams({ tab: "commercial" })}`}
              >
                Gestión Comercial
              </a>
              <a
                className={`ghost ${tab === "orders" ? "is-active" : ""}`}
                href={`/products?${new URLSearchParams({ tab: "orders" })}`}
              >
                Pedidos
              </a>
            </div>
          </div>
          <div className="field-hint">
            Inventario: molde de producto/servicio. Gestión: planes (link) y suscripciones (auto).
          </div>
        </div>

        <div className="settings-group-body">
          {tab === "inventory" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="panel module">
                <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <h3>Nuevo producto / servicio</h3>
                  <span className="settings-group-title">{productItems.length} total</span>
                </div>

                <form action={createProduct} style={{ display: "grid", gap: 10 }}>
                  <div className="field-hint">
                    Basado en campos típicos de <strong>Shopify</strong> (vendor, type, tags, opciones/variantes) y <strong>Alegra</strong>{" "}
                    (referencia/SKU, unidad, impuestos, descuento).
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Nombre</label>
                      <input className="input" name="name" placeholder="Ej: Mensualidad – Olivia Shoes" required />
                    </div>
                    <div className="field">
                      <label>SKU</label>
                      <input className="input" name="sku" placeholder="OLIVIA-MENSUAL-001" required />
                    </div>
                  </div>

                  <div className="field">
                    <label>Descripción</label>
                    <textarea className="input" name="description" placeholder="(Shopify: body) (Alegra: description)" rows={3} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Vendor (Shopify)</label>
                      <input className="input" name="vendor" placeholder="Marca / proveedor" />
                    </div>
                    <div className="field">
                      <label>Product type (Shopify)</label>
                      <input className="input" name="productType" placeholder="Categoría" />
                    </div>
                    <div className="field">
                      <label>Tags (Shopify)</label>
                      <input className="input" name="tags" placeholder="tag1, tag2, tag3" />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Tipo</label>
                      <select className="select" name="kind" defaultValue="PRODUCT">
                        <option value="PRODUCT">PRODUCTO</option>
                        <option value="SERVICE">SERVICIO</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Moneda</label>
                      <input className="input" name="currency" defaultValue="COP" />
                    </div>
                    <div className="field">
                      <label>Precio base ($)</label>
                      <input className="input" name="basePricePesos" placeholder="150500" inputMode="numeric" required />
                      <div className="field-hint">Se gestiona en pesos; el back-end guarda en centavos.</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Impuesto</label>
                      <select className="select" name="taxPercent" defaultValue="0">
                        <option value="0">Sin impuesto</option>
                        <option value="19">IVA 19%</option>
                        <option value="8">Consumo 8%</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Descuento</label>
                      <select className="select" name="discountType" defaultValue="NONE">
                        <option value="NONE">Sin descuento</option>
                        <option value="FIXED">Valor fijo</option>
                        <option value="PERCENT">Porcentaje</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Unidad (Alegra)</label>
                      <input className="input" name="unit" placeholder="UND" />
                      <div className="field-hint">Campo tipo “unit” de item/invoice.</div>
                    </div>
                    <div className="field" />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                      <input name="taxable" type="checkbox" defaultChecked />
                      <span>Taxable (Shopify)</span>
                    </label>
                    <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                      <input name="requiresShipping" type="checkbox" />
                      <span>Requires shipping (Shopify)</span>
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Descuento fijo ($)</label>
                      <input className="input" name="discountValuePesos" placeholder="0" inputMode="numeric" />
                    </div>
                    <div className="field">
                      <label>Descuento %</label>
                      <input className="input" name="discountPercent" placeholder="0" inputMode="numeric" />
                      <div className="field-hint">El descuento se aplica antes del impuesto.</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Opción 1 (ej: Talla)</label>
                      <input className="input" name="option1Name" placeholder="Talla" />
                    </div>
                    <div className="field">
                      <label>Opción 2 (ej: Color)</label>
                      <input className="input" name="option2Name" placeholder="Color" />
                    </div>
                  </div>

                  <VariantsEditor />

                  <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button className="primary" type="submit">
                      Guardar producto/servicio
                    </button>
                  </div>
                </form>
              </div>

              <div className="panel module" style={{ padding: 0 }}>
                <table className="table" aria-label="Tabla de productos">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Nombre</th>
                      <th>Tipo</th>
                      <th>Precio</th>
                      <th>IVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productItems.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{p.sku}</td>
                        <td>{p.name}</td>
                        <td>{p.kind}</td>
                        <td>{fmtMoney(p.basePriceInCents)}</td>
                        <td>{p.taxPercent ? `${p.taxPercent}%` : "—"}</td>
                      </tr>
                    ))}
                    {productItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: "var(--muted)" }}>
                          Sin productos/servicios.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            tab === "orders" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="panel module">
                  <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <h3>Nuevo pedido (link de pago)</h3>
                    <span className="settings-group-title">Base Shopify/Alegra</span>
                  </div>

                  <form action={createOrder} style={{ display: "grid", gap: 10 }}>
                    <div className="field">
                      <label>Origen</label>
                      <select className="select" name="source" defaultValue="MANUAL">
                        <option value="MANUAL">MANUAL</option>
                        <option value="SHOPIFY">SHOPIFY</option>
                        <option value="ALEGRA">ALEGRA</option>
                      </select>
                    </div>

                    <div className="field">
                      <label>Contacto</label>
                      <select className="select" name="customerId" required>
                        {customerItems.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.email || c.name || c.id}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Referencia pedido</label>
                        <input className="input" name="reference" placeholder="Shopify: #1001 / Alegra: FAC-001" required />
                      </div>
                      <div className="field">
                        <label>Moneda</label>
                        <input className="input" name="currency" defaultValue="COP" />
                      </div>
                    </div>

                    <div className="field">
                      <label>Fecha de corte (expira)</label>
                      <input className="input" name="expiresAt" type="datetime-local" step={60} />
                      <div className="field-hint">Opcional: se manda como `expires_at` a Wompi.</div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Ítem (SKU)</label>
                        <select className="select" name="itemSku">
                          <option value="">(manual)</option>
                          {productItems.map((p) => (
                            <option key={p.id} value={p.sku}>
                              {p.sku} · {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Nombre ítem</label>
                        <input className="input" name="itemName" placeholder="Line item title (Shopify) / item name (Alegra)" required />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Cantidad</label>
                        <input className="input" name="quantity" defaultValue="1" inputMode="numeric" />
                      </div>
                      <div className="field">
                        <label>Precio unitario ($)</label>
                        <input className="input" name="unitPricePesos" placeholder="150500" inputMode="numeric" required />
                      </div>
                      <div className="field">
                        <label>Impuesto %</label>
                        <select className="select" name="taxPercent" defaultValue="0">
                          <option value="0">0</option>
                          <option value="19">19</option>
                          <option value="8">8</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Descuento</label>
                        <select className="select" name="discountType" defaultValue="NONE">
                          <option value="NONE">NONE</option>
                          <option value="FIXED">FIXED</option>
                          <option value="PERCENT">PERCENT</option>
                        </select>
                        <div className="field-hint">Se aplica antes del impuesto.</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div className="field">
                          <label>Valor ($)</label>
                          <input className="input" name="discountValuePesos" placeholder="0" inputMode="numeric" />
                        </div>
                        <div className="field">
                          <label>%</label>
                          <input className="input" name="discountPercent" placeholder="0" inputMode="numeric" />
                        </div>
                      </div>
                    </div>

                    <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                      <input name="sendChatwoot" type="checkbox" defaultChecked />
                      <span>Enviar link por Chatwoot</span>
                    </label>

                    <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                      <button className="primary" type="submit">
                        Generar link de pago
                      </button>
                    </div>
                  </form>
                </div>

                <div className="panel module" style={{ padding: 0 }}>
                  <table className="table" aria-label="Tabla de pedidos">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Referencia</th>
                        <th>Cliente</th>
                        <th>Valor</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map((p) => (
                        <tr key={p.id}>
                          <td>{p.createdAt ? new Date(p.createdAt).toLocaleString() : "—"}</td>
                          <td>{p.reference || "—"}</td>
                          <td>{p.customer?.email || p.customer?.name || p.customerId}</td>
                          <td>
                            {fmtMoney(p.amountInCents)} {p.currency}
                          </td>
                          <td>{p.status}</td>
                        </tr>
                      ))}
                      {orderItems.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ color: "var(--muted)" }}>
                            Sin pedidos.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="panel module">
                <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <h3>Planes</h3>
                  <span className="settings-group-title">{planItems.length} total</span>
                </div>

                <form action={createPlan} style={{ display: "grid", gap: 10 }}>
                  <div className="field">
                    <label>Nombre</label>
                    <input className="input" name="name" placeholder="Ej: Mensual – Olivia Shoes" required />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Precio (centavos)</label>
                      <input className="input" name="priceInCents" defaultValue="49000" inputMode="numeric" />
                    </div>
                    <div className="field">
                      <label>Moneda</label>
                      <input className="input" name="currency" defaultValue="COP" />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Unidad</label>
                      <select className="select" name="intervalUnit" defaultValue="MONTH">
                        <option value="DAY">DAY</option>
                        <option value="WEEK">WEEK</option>
                        <option value="MONTH">MONTH</option>
                        <option value="CUSTOM">CUSTOM</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Cada</label>
                      <input className="input" name="intervalCount" defaultValue="1" inputMode="numeric" />
                    </div>
                  </div>

                  <div className="field">
                    <label>Método de cobro</label>
                    <select className="select" name="collectionMode" defaultValue="MANUAL_LINK">
                      <option value="MANUAL_LINK">MANUAL_LINK</option>
                      <option value="AUTO_LINK">AUTO_LINK</option>
                      <option value="AUTO_DEBIT">AUTO_DEBIT</option>
                    </select>
                  </div>

                  <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button className="primary" type="submit">
                      Crear plan
                    </button>
                  </div>
                </form>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {planItems.map((p) => (
                    <div key={p.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                      <strong>{p.name}</strong>
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        {p.priceInCents} {p.currency} / {p.intervalCount} {p.intervalUnit}
                        {p.metadata?.collectionMode ? ` · ${p.metadata.collectionMode}` : ""}
                      </div>
                    </div>
                  ))}
                  {planItems.length === 0 ? <div className="field-hint">Sin planes.</div> : null}
                </div>
              </div>

              <div className="panel module">
                <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <h3>Suscripciones</h3>
                  <span className="settings-group-title">{subItems.length} total</span>
                </div>

                <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
                  <div className="field">
                    <label>Cliente</label>
                    <select className="select" name="customerId" required>
                      {customerItems.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.email || c.name || c.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label>Plan</label>
                    <select className="select" name="planId" required>
                      {planItems.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.priceInCents} {p.currency})
                        </option>
                      ))}
                    </select>
                  </div>

                  <SubscriptionDateFields />

                  <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                    <input name="createPaymentLink" type="checkbox" defaultChecked />
                    <span>Crear link de pago (si aplica) y enviar por Chatwoot</span>
                  </label>

                  <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button className="primary" type="submit">
                      Crear suscripción
                    </button>
                  </div>
                </form>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {subItems.slice(0, 20).map((s) => (
                    <div key={s.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <strong>{s.plan?.name ?? "Suscripción"}</strong>
                        <span className="field-hint">{s.status}</span>
                        <form action={createPaymentLink} style={{ marginLeft: "auto" }}>
                          <input type="hidden" name="subscriptionId" value={s.id} />
                          <button className="ghost" type="submit">
                            Generar link
                          </button>
                        </form>
                      </div>
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        cliente: {s.customer?.email || s.customer?.name || s.customerId}
                      </div>
                    </div>
                  ))}
                  {subItems.length === 0 ? <div className="field-hint">Sin suscripciones.</div> : null}
                </div>
              </div>
            </div>
            )
          )}
        </div>
      </section>

      <div className="field-hint" style={{ marginTop: 12 }}>
        Nota: Importación desde Shopify/Alegra queda como siguiente paso (requiere credenciales y endpoints específicos).
      </div>

      <div style={{ marginTop: 10 }}>
        <Link className="btn" href="/settings">
          Configuración
        </Link>
      </div>
    </main>
  );
}
