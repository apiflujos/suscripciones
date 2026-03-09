"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  initialStatus: "processing" | "ok" | "fail";
  paymentId?: string;
  chargeError?: string;
  returnTo: string;
  subscriptionId?: string;
  tenantId?: string;
  csrfToken: string;
  retryAction: (formData: FormData) => void;
};

type PaymentStatus = "PENDING" | "APPROVED" | "DECLINED" | "ERROR" | "VOIDED";

function mapStatus(status?: PaymentStatus) {
  if (status === "APPROVED") return "ok" as const;
  if (status === "DECLINED" || status === "ERROR" || status === "VOIDED") return "fail" as const;
  return "processing" as const;
}

function describeChargeError(raw?: string) {
  const code = String(raw || "").trim();
  if (!code) return "";
  if (code === "customer_payment_source_missing") return "El cliente no tiene una tarjeta tokenizada usable para debito automatico.";
  if (code === "customer_email_required") return "El cliente no tiene email y Wompi lo exige para crear el cobro.";
  if (code === "charge_not_due_yet") return "La suscripcion todavia no esta en fecha de cobro.";
  if (code === "pending_charge_exists") return "Ya existe un cobro pendiente reciente para esta suscripcion.";
  if (code === "manual_charge_disabled_by_settings" || code === "manual_charge_not_allowed") {
    return "El cobro manual esta deshabilitado para esta configuracion.";
  }
  return code.replace(/_/g, " ");
}

export function ChargeStatusModal({
  initialStatus,
  paymentId,
  chargeError,
  returnTo,
  subscriptionId,
  tenantId,
  csrfToken,
  retryAction
}: Props) {
  const [status, setStatus] = useState<"processing" | "ok" | "fail">(initialStatus);
  const [detail, setDetail] = useState<string>(describeChargeError(chargeError));
  const [attempts, setAttempts] = useState(0);

  const canPoll = useMemo(() => initialStatus === "processing" && !!paymentId, [initialStatus, paymentId]);

  useEffect(() => {
    if (!canPoll) return;
    let mounted = true;
    let timer: any = null;

    const tick = async () => {
      if (!mounted || !paymentId) return;
      try {
        const qs = new URLSearchParams({ paymentId });
        if (tenantId) qs.set("tenantId", tenantId);
        const res = await fetch(`/api/payments/status?${qs.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!mounted) return;
        if (!res.ok || !json?.payment) {
          setAttempts((v) => v + 1);
          return;
        }
        const next = mapStatus(json.payment.status as PaymentStatus);
        if (next !== "processing") {
          setStatus(next);
          if (next === "fail") {
            const reason = json?.lastAttempt?.errorMessage || json?.lastAttempt?.errorCode || "";
            setDetail(describeChargeError(reason) || "El cobro fue rechazado.");
          }
          return;
        }
        const tx = String(json?.payment?.wompiTransactionId || "").trim();
        const last = String(json?.lastAttempt?.status || "").trim();
        if (tx || last) {
          setDetail(
            [
              tx ? `Transacción Wompi: ${tx}` : "",
              last ? `Estado técnico: ${last}` : ""
            ]
              .filter(Boolean)
              .join(" · ")
          );
        }
        setAttempts((v) => v + 1);
      } catch {
        setAttempts((v) => v + 1);
      }
    };

    timer = setInterval(tick, 3000);
    tick();
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [canPoll, paymentId, tenantId]);

  const title = status === "processing" ? "Procesando cobro" : status === "ok" ? "Cobro exitoso" : "Cobro fallido";
  const toneOk = status === "processing" || status === "ok";
  const body =
    status === "processing"
      ? `Esperando confirmación de Wompi. Este proceso puede tardar algunos segundos.${detail ? ` ${detail}` : ""}`
      : status === "ok"
        ? "El cobro se confirmó correctamente."
        : `No se pudo cobrar la suscripción. ${detail || ""}`;

  const footerNote =
    status === "processing" && attempts > 6
      ? "La confirmación está tardando. Puedes cerrar este modal y revisar el estado más tarde."
      : "";

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: 460 }}>
        <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <a className="ghost modal-close" href={returnTo} aria-label="Cerrar" data-modal-close="true" data-loader="off">
            X
          </a>
        </div>
        <div
          className="card cardPad"
          style={{
            borderColor: toneOk ? "rgba(34, 197, 94, 0.25)" : "rgba(217, 83, 79, 0.22)",
            background: toneOk ? "rgba(34, 197, 94, 0.08)" : "rgba(217, 83, 79, 0.08)"
          }}
        >
          {body}
          {footerNote ? <div style={{ marginTop: 8, color: "#666" }}>{footerNote}</div> : null}
        </div>
        <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {status === "fail" && subscriptionId ? (
            <form action={retryAction}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <button className="ghost btn-compact btn-blue" type="submit">
                Reintentar cobro
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
