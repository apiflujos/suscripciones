"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { deleteCustomer, updateCustomer } from "./actions";
import { LocalDateTime } from "../ui/LocalDateTime";

type CustomerRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt?: string;
  metadata?: any;
};

type LatestLink = {
  checkoutUrl: string;
  createdAt: string;
  chatwootStatus: string;
  chatwootError?: string;
};

export function CustomersTable({
  items,
  latestLinks
}: {
  items: CustomerRow[];
  latestLinks: Record<string, LatestLink>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [dept, setDept] = useState("");
  const [city, setCity] = useState("");
  const [code5, setCode5] = useState("");
  const [dane8, setDane8] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<Record<string, string>>({});
  const [sendOk, setSendOk] = useState<Record<string, string>>({});

  const modalTitle = useMemo(() => (editing ? `Editar: ${editing.name || editing.email || "Contacto"}` : "Editar contacto"), [editing]);

  function initialsFor(customer: CustomerRow) {
    const base = (customer.name || customer.email || "CN").trim();
    if (!base) return "CN";
    const parts = base.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || "C";
    const b = parts.length > 1 ? parts[1][0] : (parts[0]?.[1] || "N");
    return `${a}${b}`.toUpperCase();
  }

  function openEditor(item: CustomerRow) {
    setEditing(item);
    setOpen(true);
    setName(item.name || "");
    setEmail(item.email || "");
    setPhone(item.phone || "");
    setIdType(String(item.metadata?.identificacionTipo || ""));
    setIdNumber(String(item.metadata?.identificacionNumero || item.metadata?.identificacion || ""));
    setAddressLine1(String(item.metadata?.address?.line1 || ""));
    setDept(String(item.metadata?.address?.dept || ""));
    setCity(String(item.metadata?.address?.city || ""));
    setCode5(String(item.metadata?.address?.code5 || ""));
    setDane8(String(item.metadata?.address?.dane8 || ""));
  }

  return (
    <>
      <div className="contacts-grid" aria-label="Lista de contactos">
        {items.map((c) => {
          const link = latestLinks[String(c.id)];
          const status = String(link?.chatwootStatus || "");
          const errorMsg = link?.chatwootError || "";
          const statusLabel = status === "SENT" ? "Enviado" : status === "FAILED" ? "Falló" : status === "PENDING" ? "Pendiente" : "";
          const formId = `send-link-${c.id}`;
          return (
            <div className="contact-card contact-card-horizontal" key={c.id}>
              <div className="contact-left">
                <div className="contact-header">
                  <div>
                    <div className="contact-title">{c.name || "—"}</div>
                    <div className="contact-subline">{c.email || "—"}</div>
                  </div>
                  <div className="contact-subline">{c.phone || "—"}</div>
                </div>
                <div className="contact-meta-grid">
                  <div><span>Identificación</span>{c.metadata?.identificacion || c.metadata?.identificationNumber || "—"}</div>
                  <div><span>Ciudad</span>{c.metadata?.address?.city || "—"}</div>
                  <div><span>Dirección</span>{c.metadata?.address?.line1 || "—"}</div>
                  <div>
                    <span>Cobro auto</span>
                    {c.metadata?.wompi?.paymentSourceId ? (
                      <span className="pill pill-ok">OK</span>
                    ) : (
                      <Link href={`/customers/${c.id}/payment-method`} style={{ textDecoration: "underline" }}>
                        Agregar
                      </Link>
                    )}
                  </div>
                  <div><span>Creado</span><LocalDateTime value={c.createdAt} /></div>
                </div>
              </div>

              <div className="contact-right">
                <div className="contact-actions">
                  <button className="icon-btn" type="button" onClick={() => openEditor(c)} aria-label="Editar">✎</button>
                </div>
                <div className="contact-paylink">
                  <div className="paylink-title">Link de pago</div>
                  <form
                    id={formId}
                    className="paylink-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const amount = (form.elements.namedItem("amount") as HTMLInputElement | null)?.value || "";
                      setSendingId(c.id);
                      setSendError((prev) => ({ ...prev, [c.id]: "" }));
                      setSendOk((prev) => ({ ...prev, [c.id]: "" }));
                      try {
                        const res = await fetch("/api/customers/send-payment-link", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            customerId: c.id,
                            customerName: c.name || "",
                            amount
                          })
                        });
                        const contentType = res.headers.get("content-type") || "";
                        if (!contentType.includes("application/json")) {
                          setSendError((prev) => ({ ...prev, [c.id]: "auth_required" }));
                          return;
                        }
                        const json = await res.json().catch(() => ({}));
                        if (!res.ok || !json?.ok) {
                          setSendError((prev) => ({ ...prev, [c.id]: json?.error || "send_failed" }));
                          return;
                        }
                        if (typeof json?.notificationsScheduled === "number" && json.notificationsScheduled === 0) {
                          setSendError((prev) => ({ ...prev, [c.id]: "no_rules" }));
                          return;
                        }
                        setSendOk((prev) => ({ ...prev, [c.id]: "sent" }));
                      } finally {
                        setSendingId(null);
                      }
                    }}
                  >
                    <input type="hidden" name="customerId" value={c.id} />
                    <input type="hidden" name="customerName" value={c.name || ""} />
                    <input className="input" name="amount" placeholder="$ 10000" inputMode="numeric" />
                    <button className="primary" type="submit" disabled={sendingId === c.id}>
                      {sendingId === c.id ? "Enviando..." : "Enviar link"}
                    </button>
                  </form>
                  {link?.checkoutUrl ? (
                    <div className="paylink-meta">
                      <a className="ghost" href={link.checkoutUrl} target="_blank" rel="noreferrer">
                        Link de pago
                      </a>
                      {statusLabel ? (
                        <span className={`pill ${status === "SENT" ? "pill-ok" : status === "FAILED" ? "pill-bad" : "pill-warn"}`}>
                          {statusLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {status === "FAILED" && errorMsg ? <div className="paylink-error">{errorMsg}</div> : null}
                  {sendError[c.id] === "auth_required" ? (
                    <div className="paylink-error">Sesión vencida. Vuelve a iniciar sesión.</div>
                  ) : null}
                  {sendError[c.id] === "no_rules" ? (
                    <div className="paylink-error">No hay notificaciones activas para enviar el link.</div>
                  ) : null}
                  {sendError[c.id] && sendError[c.id] !== "auth_required" && sendError[c.id] !== "no_rules" ? (
                    <div className="paylink-error">{sendError[c.id]}</div>
                  ) : null}
                  {sendOk[c.id] ? <div className="paylink-success">Link enviado.</div> : null}
                  {status === "FAILED" ? (
                    <button
                      className="ghost paylink-retry"
                      type="button"
                      onClick={() => {
                        const form = document.getElementById(formId) as HTMLFormElement | null;
                        form?.requestSubmit();
                      }}
                    >
                      Reintentar
                    </button>
                  ) : null}
                </div>
                <form
                  action={deleteCustomer}
                  className="delete-row"
                  onSubmit={(e) => {
                    if (!confirm("¿Eliminar contacto?")) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={c.id} />
                  <button className="icon-btn danger" type="submit" aria-label="Eliminar">🗑</button>
                </form>
              </div>
            </div>
          );
        })}
        {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
      </div>

      {open && editing ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16
          }}
        >
          <div className="panel module" style={{ width: "min(860px, 96vw)", maxHeight: "90vh", overflow: "auto" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{modalTitle}</h3>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>

            <form action={updateCustomer} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={editing.id} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input className="input" name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Teléfono</label>
                  <input className="input" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="field">
                  <label>Identificación</label>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                    <input className="input" name="idType" value={idType} onChange={(e) => setIdType(e.target.value)} placeholder="CC" />
                    <input className="input" name="idNumber" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Dirección</label>
                <input className="input" name="addressLine1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Departamento</label>
                  <input className="input" name="dept" value={dept} onChange={(e) => setDept(e.target.value)} />
                </div>
                <div className="field">
                  <label>Ciudad</label>
                  <input className="input" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="field">
                  <label>Código 5</label>
                  <input className="input" name="code5" value={code5} onChange={(e) => setCode5(e.target.value)} />
                </div>
                <div className="field">
                  <label>DANE 8</label>
                  <input className="input" name="dane8" value={dane8} onChange={(e) => setDane8(e.target.value)} />
                </div>
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="ghost" type="button" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <button className="primary" type="submit">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
