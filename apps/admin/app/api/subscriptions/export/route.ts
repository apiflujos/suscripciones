import { getSubscriptionsBoard, filterBoardRows } from "../../../admin/_services/subscriptionsBoard";
import { resolveTenantId } from "../../../admin/_services/tenantResolver";
import { csvDocument } from "../../../lib/csv";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";
import { getRolePermissions, hasPermissions, permissionsForPath } from "../../../../lib/rbac";

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
  // Mismo permiso que exige cualquier otra ruta de /api/subscriptions.
  const required = permissionsForPath(url.pathname, req.method) ?? undefined;
  if (!hasPermissions(required, getRolePermissions(session.role))) {
    return new Response("forbidden", { status: 403 });
  }

  // El canal se resuelve igual que en el tablero: si no, un mismo enlace
  // devolvería un recorte distinto al que se está viendo en pantalla.
  const tenantParam = url.searchParams.get("tenantId");
  const tenantId = tenantParam ? await resolveTenantId(tenantParam) : null;
  const board = await getSubscriptionsBoard({ tenantId });
  const rows = filterBoardRows(board.rows, {
    mode: url.searchParams.get("mode"),
    state: url.searchParams.get("state"),
    notified: url.searchParams.get("notified"),
    q: url.searchParams.get("q")
  });

  const header = [
    "Cliente", "Teléfono", "Plan", "Modo de cobro", "Monto",
    "Ciclo", "Ciclo pagado", "Fecha de pago", "Vence", "Estado del ciclo", "Días de atraso",
    "Próximo cobro", "Tiene tarjeta", "Aviso", "Estado del aviso", "Detalle del aviso", "Mensaje enviado"
  ];

  const NOTICE_STATUS_LABEL: Record<string, string> = {
    SENT: "Enviado",
    FAILED: "Falló",
    PENDING: "En cola"
  };

  const rowsCsv = rows.map((r) => [
    r.customerName,
    r.customerPhone ?? "",
    r.planName,
    MODE_LABEL[r.mode] ?? r.mode,
    // Sin separador de miles: así entra como número en Excel.
    Math.round(r.amountInCents / 100),
    r.cycleNumber ?? "",
    r.cyclePaid ? "Sí" : "No",
    dateOnly(r.cyclePaidAt),
    dateOnly(r.cycleDueAt),
    DELINQUENCY_LABEL[r.delinquency] ?? r.delinquency,
    r.delinquency === "EN_MORA" ? r.daysPastDue : "",
    r.nextCharge ? dateOnly(r.nextCharge.at) : "Sin cobro programado",
    r.hasCard ? "Sí" : "No",
    r.notice?.kind ?? "",
    r.notice ? NOTICE_STATUS_LABEL[r.notice.status] ?? r.notice.status : "Sin aviso",
    r.notice?.reason ?? "",
    r.notice?.content ?? ""
  ]);

  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota" }).format(new Date());
  const csv = csvDocument(header, rowsCsv);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="suscripciones-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
