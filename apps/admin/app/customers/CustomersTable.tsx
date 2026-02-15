"use client";

import { useMemo, useRef, useState, useEffect } from "react";
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
  latestLinks,
  subscriptionsByCustomer,
  csrfToken
}: {
  items: CustomerRow[];
  latestLinks: Record<string, LatestLink>;
  subscriptionsByCustomer: Record<string, { hasPlan: boolean }>;
  csrfToken: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsCustomer, setDetailsCustomer] = useState<CustomerRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<Record<string, string>>({});
  const [sendOk, setSendOk] = useState<Record<string, string>>({});

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
  const modalRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  const modalTitle = useMemo(() => (editing ? `Editar: ${editing.name || editing.email || "Contacto"}` : "Editar contacto"), [editing]);

  function hasToken(customer: CustomerRow) {
    const meta = customer.metadata ?? {};
    const candidates = [
      meta?.wompi?.paymentSourceId,
      meta?.wompi?.payment_source_id,
      meta?.paymentSourceId,
      meta?.payment_source_id
    ];
    return candidates.some((v: any) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^\d+$/.test(v)));
  }

  function initialsFor(customer: CustomerRow) {
    const base = (customer.name || customer.email || "CN").trim();
    if (!base) return "CN";
    const parts = base.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || "C";
    const b = parts.length > 1 ? parts[1][0] : (parts[0]?.[1] || "N");
    return `${a}${b}`.toUpperCase();
  }

  function openEditor(item: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
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

  function closeEditor() {
    setOpen(false);
    setEditing(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  function openDetails(item: CustomerRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setDetailsCustomer(item);
    setDetailsOpen(true);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsCustomer(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    const el = modalRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
  }, [open]);

  useEffect(() => {
    if (!detailsOpen) return;
    const el = detailsRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("button");
    first?.focus();
  }, [detailsOpen]);

  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (detailsOpen) closeDetails();
      else closeEditor();
      return;
    }
    if (e.key !== "Tab") return;
    const root = detailsOpen ? detailsRef.current : modalRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]"))
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div className="contacts-grid" aria-label="Lista de contactos">
        {items.map((c) => {
          const link = latestLinks[String(c.id)];
          const formId = `send-link-${c.id}`;
          const hasPlan = subscriptionsByCustomer[String(c.id)]?.hasPlan ?? false;
          return (
            <div className="contact-card" key={c.id}>
              <div className="contact-left">
                <div className="contact-section-title">Información personal</div>
                <div className="contact-person-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div>
                    <span>Nombre</span>
                    <strong style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{c.name || "—"}</span>
                      {hasToken(c) ? <span className="pill pill-ok">Tokenizada</span> : <span className="pill pill-bad">Sin token</span>}
                    </strong>
                  </div>
                  <div>
                    <span>Email</span>
                    {c.email || "—"}
                  </div>
                  <div>
                    <span>Teléfono</span>
                    {c.phone || "—"}
                  </div>
                </div>
              </div>

              <div className="contact-right">
                <div className="contact-right-top">
                  <div className="contact-actions">
                    <button className="icon-btn" type="button" onClick={() => openEditor(c)} aria-label="Editar">✎</button>
                    <form
                      action={deleteCustomer}
                      className="delete-row"
                      onSubmit={(e) => {
                        if (!confirm("¿Eliminar contacto?")) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="id" value={c.id} />
                      <button className="icon-btn danger" type="submit" aria-label="Eliminar">🗑</button>
                    </form>
                  </div>
                </div>
                <div className="contact-plan-grid" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <span>Plan / Suscripción</span>
                    {hasPlan ? <span className="pill pill-ok">Sí</span> : <span className="pill pill-muted">No</span>}
                  </div>
                </div>
                <div className="contact-paylink">
                  <div className="paylink-title">Crear link de pago</div>
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
                    <input className="input" name="amount" placeholder="$ 10000" inputMode="numeric" aria-label="Monto" />
                    <button className="primary btn-compact" type="submit" disabled={sendingId === c.id}>
                      {sendingId === c.id ? "Enviando..." : "Enviar link"}
                    </button>
                  </form>
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
                </div>
                <div className="contact-secondary-actions">
                  <button className="ghost btn-compact btn-blue" type="button" onClick={() => openDetails(c)}>
                    Ver detalles
                  </button>
                  <Link className="ghost btn-compact btn-green" href={`/billing?crear=1&selectCustomerId=${encodeURIComponent(String(c.id))}`}>
                    Crear plan / suscripción
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
      </div>

      {detailsOpen && detailsCustomer ? (
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
          <div
            ref={detailsRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-details-title"
            className="panel module"
            style={{ width: "min(820px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
            onKeyDown={onModalKeyDown}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="customer-details-title" style={{ margin: 0 }}>
                Detalles: {detailsCustomer.name || detailsCustomer.email || detailsCustomer.id}
              </h3>
              <button type="button" className="ghost" onClick={closeDetails}>
                Cerrar
              </button>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div className="contact-section-title">Datos personales</div>
                <div className="contact-person-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <div>
                    <span>Nombre</span>
                    <strong>{detailsCustomer.name || "—"}</strong>
                  </div>
                  <div>
                    <span>Email</span>
                    {detailsCustomer.email || "—"}
                  </div>
                  <div>
                    <span>Teléfono</span>
                    {detailsCustomer.phone || "—"}
                  </div>
                  <div>
                    <span>Identificación</span>
                    {detailsCustomer.metadata?.identificacion || detailsCustomer.metadata?.identificationNumber || "—"}
                  </div>
                  <div>
                    <span>ID</span>
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{detailsCustomer.id}</span>
                  </div>
                  <div>
                    <span>Creado</span>
                    <LocalDateTime value={detailsCustomer.createdAt} />
                  </div>
                </div>
              </div>

              <div>
                <div className="contact-section-title">Dirección</div>
                <div className="contact-person-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <div>
                    <span>Dirección</span>
                    {detailsCustomer.metadata?.address?.line1 || "—"}
                  </div>
                  <div>
                    <span>Ciudad</span>
                    {detailsCustomer.metadata?.address?.city || "—"}
                  </div>
                  <div>
                    <span>Departamento</span>
                    {detailsCustomer.metadata?.address?.dept || "—"}
                  </div>
                </div>
              </div>

              <div>
                <div className="contact-section-title">Método de pago</div>
                <div className="contact-person-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <div>
                    <span>Estado</span>
                    {hasToken(detailsCustomer) ? <span className="pill pill-ok">Tokenizada</span> : <span className="pill pill-bad">Sin token</span>}
                  </div>
                  <div>
                    <span>Payment Source ID</span>
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {String((detailsCustomer.metadata as any)?.wompi?.paymentSourceId || (detailsCustomer.metadata as any)?.wompi?.payment_source_id || "—")}
                    </span>
                  </div>
                  <div>
                    <span>Estado link</span>
                    {(() => {
                      const link = latestLinks[String(detailsCustomer.id)];
                      const status = String(link?.chatwootStatus || "");
                      const statusLabel = status === "SENT" ? "Enviado" : status === "FAILED" ? "Falló" : status === "PENDING" ? "Pendiente" : "";
                      return statusLabel ? (
                        <span className={`pill ${status === "SENT" ? "pill-ok" : status === "FAILED" ? "pill-bad" : "pill-warn"}`}>
                          {statusLabel}
                        </span>
                      ) : (
                        "—"
                      );
                    })()}
                  </div>
                  <div>
                    <span>Último link</span>
                    {(() => {
                      const link = latestLinks[String(detailsCustomer.id)];
                      return link?.createdAt ? <LocalDateTime value={link.createdAt} /> : "—";
                    })()}
                  </div>
                  {!hasToken(detailsCustomer) ? (
                    <div>
                      <Link href={`/customers/${detailsCustomer.id}/payment-method`} style={{ textDecoration: "underline" }}>
                        Tokenizar método
                      </Link>
                    </div>
                  ) : null}
                </div>
                <div className="contact-paylink" style={{ marginTop: 10 }}>
                  <div className="paylink-title">Crear link de pago</div>
                  <form
                    id={`details-paylink-${detailsCustomer.id}`}
                    className="paylink-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const amount = (form.elements.namedItem("amount") as HTMLInputElement | null)?.value || "";
                      setSendingId(detailsCustomer.id);
                      setSendError((prev) => ({ ...prev, [detailsCustomer.id]: "" }));
                      setSendOk((prev) => ({ ...prev, [detailsCustomer.id]: "" }));
                      try {
                        const res = await fetch("/api/customers/send-payment-link", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            customerId: detailsCustomer.id,
                            customerName: detailsCustomer.name || "",
                            amount
                          })
                        });
                        const contentType = res.headers.get("content-type") || "";
                        if (!contentType.includes("application/json")) {
                          setSendError((prev) => ({ ...prev, [detailsCustomer.id]: "auth_required" }));
                          return;
                        }
                        const json = await res.json().catch(() => ({}));
                        if (!res.ok || !json?.ok) {
                          setSendError((prev) => ({ ...prev, [detailsCustomer.id]: json?.error || "send_failed" }));
                          return;
                        }
                        if (typeof json?.notificationsScheduled === "number" && json.notificationsScheduled === 0) {
                          setSendError((prev) => ({ ...prev, [detailsCustomer.id]: "no_rules" }));
                          return;
                        }
                        setSendOk((prev) => ({ ...prev, [detailsCustomer.id]: "sent" }));
                      } finally {
                        setSendingId(null);
                      }
                    }}
                  >
                    <input type="hidden" name="customerId" value={detailsCustomer.id} />
                    <input type="hidden" name="customerName" value={detailsCustomer.name || ""} />
                    <input className="input" name="amount" placeholder="$ 10000" inputMode="numeric" aria-label="Monto" />
                    <button className="primary btn-compact" type="submit" disabled={sendingId === detailsCustomer.id}>
                      {sendingId === detailsCustomer.id ? "Enviando..." : "Enviar link"}
                    </button>
                  </form>
                  {sendError[detailsCustomer.id] === "auth_required" ? (
                    <div className="paylink-error">Sesión vencida. Vuelve a iniciar sesión.</div>
                  ) : null}
                  {sendError[detailsCustomer.id] === "no_rules" ? (
                    <div className="paylink-error">No hay notificaciones activas para enviar el link.</div>
                  ) : null}
                  {sendError[detailsCustomer.id] && sendError[detailsCustomer.id] !== "auth_required" && sendError[detailsCustomer.id] !== "no_rules" ? (
                    <div className="paylink-error">{sendError[detailsCustomer.id]}</div>
                  ) : null}
                  {sendOk[detailsCustomer.id] ? <div className="paylink-success">Link enviado.</div> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-edit-title"
            className="panel module"
            style={{ width: "min(860px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
            onKeyDown={onModalKeyDown}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="customer-edit-title" style={{ margin: 0 }}>{modalTitle}</h3>
              <button type="button" className="ghost" onClick={closeEditor}>
                Cerrar
              </button>
            </div>

            <form action={updateCustomer} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
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
                <button className="ghost" type="button" onClick={closeEditor}>
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
