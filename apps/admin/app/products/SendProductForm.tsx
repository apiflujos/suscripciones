"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FormActions, PageSection } from "../ui/PageShell";
import { PendingButton } from "../ui/PendingButton";
import "./products.css";

export type SendCustomer = { id: string; name?: string | null; email?: string | null; phone?: string | null };

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function customerLabel(c: SendCustomer) {
  return String(c?.name || c?.email || c?.phone || "Contacto").trim() || "Contacto";
}

function customerMeta(c: SendCustomer) {
  return [String(c?.email || "").trim(), String(c?.phone || "").trim()].filter(Boolean).join(" · ");
}

/**
 * Elegir contacto y enviarle el link de pago del producto. Se mantiene la
 * búsqueda local de antes; el envío usa la misma acción `sendProductToCustomer`.
 */
export function SendProductForm({
  action,
  csrfToken,
  productId,
  customers,
  returnTo,
  failTo,
  messagePreview,
  blockers,
  hasTemplate
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  productId: string;
  customers: SendCustomer[];
  returnTo: string;
  failTo: string;
  messagePreview: string;
  /** Motivos por los que no se puede enviar (checkout, URL base, etc.). */
  blockers: string[];
  hasTemplate: boolean;
}) {
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(handle);
  }, [search]);

  const query = useMemo(() => normalize(debounced.trim()), [debounced]);
  const selected = useMemo(() => customers.find((c) => String(c.id) === customerId) || null, [customers, customerId]);
  const active = query.length >= 2;

  const results = useMemo(() => {
    if (!active) return [];
    const tokens = query.split(/\s+/).filter(Boolean);
    const compactQuery = query.replace(/\s+/g, "");
    return customers
      .map((c) => {
        const name = normalize(c.name || "");
        const email = normalize(c.email || "");
        const phone = String(c.phone || "").replace(/\s+/g, "").toLowerCase();
        let score = 0;
        let reason = "";
        if (email && email === query) { score += 160; reason = "Email exacto"; }
        if (phone && phone === compactQuery) { score += 160; reason = reason || "Teléfono exacto"; }
        if (name && name === query) { score += 140; reason = reason || "Nombre exacto"; }
        if (name.startsWith(query)) { score += 90; reason = reason || "Nombre inicia"; }
        if (email.startsWith(query) || phone.startsWith(compactQuery)) { score += 80; reason = reason || "Contacto inicia"; }
        if (name.includes(query)) { score += 60; reason = reason || "Nombre contiene"; }
        if (email.includes(query) || phone.includes(compactQuery)) { score += 50; reason = reason || "Contacto contiene"; }
        const hits = tokens.reduce((acc, t) => (name.includes(t) ? acc + 1 : acc), 0);
        score += hits * 10;
        if (hits && !reason) reason = "Coincidencias parciales";
        return { item: c, score, reason };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || customerLabel(a.item).localeCompare(customerLabel(b.item), "es"))
      .slice(0, 10);
  }, [customers, query, active]);

  const disabled = !customerId || blockers.length > 0 || !hasTemplate;

  return (
    <form action={action} className="page-shell-body">
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="failTo" value={failTo} />

      <PageSection title="1. Contacto" description="Busca el contacto que recibirá el link de pago.">
        <div className="field">
          <label htmlFor="send-search">Buscar contacto</label>
          <input
            id="send-search"
            className="input"
            type="search"
            placeholder="Nombre, email o teléfono"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          {!selected && !active ? <div className="field-hint">Escribe al menos 2 caracteres para buscar rápido.</div> : null}
        </div>
        {selected ? (
          <div className="send-selected" role="status">
            <div className="send-selected-text">
              <div className="send-selected-name">{customerLabel(selected)}</div>
              <div className="field-hint">{customerMeta(selected) || "Sin contacto adicional"}</div>
            </div>
            <button
              type="button"
              className="ghost btn-compact"
              onClick={() => {
                setSearch("");
                setCustomerId("");
              }}
            >
              Cambiar
            </button>
          </div>
        ) : null}
        {active ? (
          <div className="send-results">
            <div className="field-hint" role="status">
              {results.length ? `Resultados rápidos (${results.length})` : "Sin coincidencias"}
            </div>
            {results.map((row) => {
              const c = row.item;
              const isSelected = String(c.id) === customerId;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`send-result${isSelected ? " is-selected" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setCustomerId(String(c.id));
                    setSearch(customerLabel(c));
                  }}
                >
                  <span className="send-result-name">{customerLabel(c)}</span>
                  <span className="send-result-meta">{customerMeta(c) || "Sin contacto adicional"}</span>
                  <span className="send-result-tags">
                    {row.reason ? <span className="pill pill-soft">{row.reason}</span> : null}
                    {isSelected ? <span className="pill pill-ok">Seleccionado</span> : <span className="pill">Elegir</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {customers.length === 0 ? <div className="field-hint ui-alert-danger">No hay contactos creados para enviar este producto.</div> : null}
      </PageSection>

      <PageSection title="2. Mensaje" description="Se usa la plantilla WhatsApp activa de Notificaciones para link de pago.">
        <div className="field">
          <label htmlFor="send-preview">Notificación configurada</label>
          <textarea id="send-preview" className="input" rows={8} readOnly value={messagePreview} />
        </div>
        {blockers.map((text) => (
          <div key={text} className="field-hint ui-alert-danger" role="alert">{text}</div>
        ))}
        {!hasTemplate ? (
          <div className="field-hint ui-alert-danger" role="alert">
            Falta una plantilla WhatsApp activa para link de pago en Notificaciones.
            <div className="send-config-link">
              <Link className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                Configurar plantilla
              </Link>
            </div>
          </div>
        ) : null}
        {blockers.length === 0 && hasTemplate ? <div className="field-hint">Se usará el checkout público configurado para este producto.</div> : null}
        {!customerId ? <div className="field-hint">Selecciona un contacto para habilitar el envío.</div> : null}
      </PageSection>

      <FormActions cancelHref={returnTo}>
        <PendingButton className="primary btn-compact btn-send" type="submit" pendingText="Enviando..." disabled={disabled}>
          Enviar link de pago
        </PendingButton>
      </FormActions>
    </form>
  );
}
