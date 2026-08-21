import { getSubscriptionsBoard, filterBoardRows } from "../../../admin/_services/subscriptionsBoard";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DELINQUENCY_LABEL: Record<string, string> = {
  AL_DIA: "Al día",
  EN_GRACIA: "En gracia",
  EN_MORA: "En mora"
};

const MODE_LABEL: Record<string, string> = {
  AUTO_DEBIT: "Débito automático",
  AUTO_LINK: "Link de pago",
  MANUAL_LINK: "Cobro manual"
};

/** Escapa un campo para CSV: comillas dobladas y el valor entre comillas. */
function cell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function dateOnly(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short" }).format(d);
}

export async function GET(req: Request) {
  // La descarga se dispara desde un enlace del navegador, así que la sesión
  // llega por cookie y no por header Authorization.
  const jar = await cookies();
  const session = await verifyAdminSessionToken(jar.get(ADMIN_SESSION_COOKIE)?.value || "");
  if (!session) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  const board = await getSubscriptionsBoard({ tenantId: tenantId || null });
  const rows = filterBoardRows(board.rows, {
    mode: url.searchParams.get("mode"),
    state: url.searchParams.get("state"),
    notified: url.searchParams.get("notified"),
    q: url.searchParams.get("q")
  });

  const header = [
    "Cliente", "Teléfono", "Plan", "Modo de cobro", "Monto",
    "Ciclo", "Vence", "Estado del ciclo", "Cobranza", "Días de atraso",
    "Tiene tarjeta", "Último pago", "Fecha de pago", "Aviso enviado", "Error del aviso"
  ];

  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([
      r.customerName,
      r.customerPhone ?? "",
      r.planName,
      MODE_LABEL[r.mode] ?? r.mode,
      // Sin separador de miles: así entra como número en Excel.
      Math.round(r.amountInCents / 100),
      r.cycleNumber ?? "",
      dateOnly(r.cycleDueAt),
      r.cycleStatus ?? "",
      DELINQUENCY_LABEL[r.delinquency] ?? r.delinquency,
      r.delinquency === "EN_MORA" ? r.daysPastDue : "",
      r.hasCard ? "Sí" : "No",
      r.lastPaymentStatus ?? "Sin intento",
      dateOnly(r.lastPaymentAt),
      r.messageDelivered === true ? "Entregado" : r.messageDelivered === false ? "Falló" : "Sin enviar",
      r.messageError ?? ""
    ].map(cell).join(","));
  }

  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota" }).format(new Date());
  // BOM para que Excel abra los acentos correctamente.
  const csv = "﻿" + lines.join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="suscripciones-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
