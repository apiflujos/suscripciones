import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { listPaymentLogs } from "../admin/_services/logs";

/** Los logs y pagos son solo para SUPER_ADMIN, igual que /logs. */
export async function requireSuperAdmin() {
  const c = await cookies();
  const session = await verifyAdminSessionToken(c.get(ADMIN_SESSION_COOKIE)?.value || "");
  if (session?.role !== "SUPER_ADMIN") redirect("/settings?tab=notificaciones");
  return session;
}

/** Un pago por id (sin límite de fechas); 404 si no existe. */
export async function loadPayment(id: string) {
  const res = await listPaymentLogs({ take: 1, ids: [id], from: "2000-01-01" });
  const payment = ((res.items ?? []) as any[])[0];
  if (!payment) notFound();
  return payment as any;
}
