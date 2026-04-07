"use client";

import { useEffect, useMemo, useState } from "react";
import { AppModal } from "../ui/AppModal";

type Props = {
  initialStatus: "processing" | "ok" | "fail";
  paymentId?: string;
  chargeError?: string;
  chargeErrorDetails?: string;
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
  if (code === "No se pudo conectar con el API de suscripciones.") return code;
  if (code === "No se pudo cobrar la suscripción.") return code;
  if (code === "No se pudo procesar el cobro.") return code;
  if (code === "El cliente no tiene una tarjeta tokenizada lista para débito automático.") return code;
  if (code === "El cliente no tiene correo electrónico y Wompi lo exige para cobrar.") return code;
  if (code === "La suscripción todavía no está en fecha de cobro.") return code;
  if (code === "Ya existe un cobro pendiente reciente para esta suscripción.") return code;
  if (code === "El cobro manual está deshabilitado en la configuración.") return code;
  if (code === "Esta suscripción no permite cobro manual.") return code;
  if (code === "No se encontró la suscripción para el canal seleccionado.") return code;
  if (code === "La solicitud de cobro es inválida.") return code;
  if (code === "customer_payment_source_missing") return "El cliente no tiene una tarjeta tokenizada usable para debito automatico.";
  if (code === "customer_email_required") return "El cliente no tiene email y Wompi lo exige para crear el cobro.";
  if (code === "charge_not_due_yet") return "La suscripcion todavia no esta en fecha de cobro.";
  if (code === "pending_charge_exists") return "Ya existe un cobro pendiente reciente para esta suscripcion.";
  if (code === "manual_charge_disabled_by_settings" || code === "manual_charge_not_allowed") {
    return "El cobro manual esta deshabilitado para esta configuracion.";
  }
  if (code === "payment_already_approved") return "Esta suscripción ya fue cobrada para el ciclo actual.";
  if (code === "subscription_not_found") return "No se encontró la suscripción para el canal seleccionado.";
  if (code === "fetch_failed") return "No se pudo conectar con el API de suscripciones.";
  if (code === "auto_debit_in_progress") return "Ya hay un intento de débito automático en proceso.";
  if (code === "wompi_reference_already_used_guard") return "Se bloqueó el cobro para evitar una transacción duplicada en Wompi.";
  return "No se pudo cobrar la suscripción.";
}

function formatChargeDetails(raw?: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const looksJson = value.startsWith("{") || value.startsWith("[") || value.includes("\"");
  if (looksJson && value.length > 120) {
    return "Detalle técnico disponible en Logs.";
  }
  const stringifyValue = (input: unknown) => {
    if (input === null || input === undefined) return "";
    if (typeof input === "string") return input;
    if (typeof input === "number" || typeof input === "boolean") return String(input);
    if (Array.isArray(input)) {
      // Render arrays compactly unless they contain objects.
      if (input.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))) {
        return input.map((v) => String(v ?? "")).join(", ");
      }
      try {
        return JSON.stringify(input, null, 2);
      } catch {
        return String(input);
      }
    }
    if (typeof input === "object") {
      try {
        return JSON.stringify(input, null, 2);
      } catch {
        return String(input);
      }
    }
    return String(input);
  };
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const picked =
        (parsed as any).errorMessage ||
        (parsed as any).message ||
        (parsed as any).error ||
        (parsed as any).reason ||
        (parsed as any).status ||
        (parsed as any).code ||
        "";
      if (picked) return String(picked);
      return "Detalle técnico disponible en Logs.";
    }
    const labels: Record<string, string> = {
      dueAt: "Fecha prevista de cobro",
      currentPeriodEndAt: "Fecha de corte actual",
      expectedByLastPayment: "Fecha esperada por último pago",
      paymentId: "Pago relacionado",
      wompiTransactionId: "Transacción Wompi",
      createdAt: "Fecha de creación",
      requestedTenantId: "Canal solicitado",
      subscriptionTenantId: "Canal principal de la suscripción",
      tenantLinks: "Canales asociados",
      collectionMode: "Modo de cobro",
      availableKeys: "Campos disponibles en metadata",
      wompiKeys: "Campos Wompi en metadata"
    };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out = Object.entries(parsed as Record<string, unknown>)
        .map(([key, entry]) => {
          const label = labels[key] || key;
          const rendered = stringifyValue(entry);
          if (!rendered) return `${label}:`;
          // If it's multi-line JSON, show it on the next line for readability.
          return rendered.includes("\n") ? `${label}:\n${rendered}` : `${label}: ${rendered}`;
        })
        .join("\n");
      return out || "Detalle técnico disponible en Logs.";
    }
    return "Detalle técnico disponible en Logs.";
  } catch {
    if (value.length > 160) return "Detalle técnico disponible en Logs.";
    return value
      .replaceAll("requestedTenantId", "Canal solicitado")
      .replaceAll("subscriptionTenantId", "Canal principal de la suscripción")
      .replaceAll("tenantLinks", "Canales asociados")
      .replaceAll("collectionMode", "Modo de cobro")
      .replaceAll("dueAt", "Fecha prevista de cobro")
      .replaceAll("currentPeriodEndAt", "Fecha de corte actual")
      .replaceAll("expectedByLastPayment", "Fecha esperada por último pago")
      .replaceAll("paymentId", "Pago relacionado")
      .replaceAll("wompiTransactionId", "Transacción Wompi")
      .replaceAll("createdAt", "Fecha de creación");
  }
}

export function ChargeStatusModal({
  initialStatus,
  paymentId,
  chargeError,
  chargeErrorDetails,
  returnTo,
  subscriptionId,
  tenantId,
  csrfToken,
  retryAction
}: Props) {
  const [status, setStatus] = useState<"processing" | "ok" | "fail">(initialStatus);
  const [detail, setDetail] = useState<string>(describeChargeError(chargeError));
  const [technicalDetail, setTechnicalDetail] = useState<string>(formatChargeDetails(chargeErrorDetails));
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
            setTechnicalDetail(
              formatChargeDetails(
                json?.lastAttempt?.response ? JSON.stringify(json.lastAttempt.response) : json?.lastAttempt?.errorMessage || json?.lastAttempt?.errorCode || ""
              )
            );
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
  const baseFailMessage = "No se pudo cobrar la suscripción.";
  const safeDetail =
    detail && detail !== baseFailMessage ? detail : "";
  const body =
    status === "processing"
      ? `Esperando confirmación de Wompi. Este proceso puede tardar algunos segundos.${detail ? ` ${detail}` : ""}`
      : status === "ok"
        ? "El cobro se confirmó correctamente."
        : `${baseFailMessage}${safeDetail ? ` ${safeDetail}` : ""}`;

  const footerNote =
    status === "processing" && attempts > 6
      ? "La confirmación está tardando. Puedes cerrar este modal y revisar el estado más tarde."
      : "";

  const closeModal = () => {
    window.location.href = returnTo;
  };

  return (
    <AppModal open onClose={closeModal} title={title} maxWidth={460}>
        <div
          className="card cardPad"
          style={{
            borderColor: toneOk ? "rgba(34, 197, 94, 0.25)" : "rgba(217, 83, 79, 0.22)",
            background: toneOk ? "rgba(34, 197, 94, 0.08)" : "rgba(217, 83, 79, 0.08)"
          }}
        >
          {body}
          {paymentId ? <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Pago asociado: {paymentId}</div> : null}
          {technicalDetail ? (
            <pre
              style={{
                marginTop: 8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
                color: "#444"
              }}
            >
              {technicalDetail}
            </pre>
          ) : null}
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
    </AppModal>
  );
}
