import { LogLevel } from "@prisma/client";
import { systemLog } from "../../services/systemLog";
import { buildMonthlyBillingReport } from "../../services/billingReport";
import { sendEmailViaSmtp } from "../../services/email";
import { SUPER_ADMIN_EMAIL } from "../../services/superAdminAuth";

function splitEmails(v: string) {
  return String(v || "")
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function billingMonthlyReport(payload: any) {
  const periodKey = String(payload?.periodKey || "").trim();
  if (!periodKey) throw new Error("missing_period_key");

  const report = await buildMonthlyBillingReport({ periodKey });

  const to = splitEmails(process.env.BILLING_REPORT_TO || "").length ? splitEmails(process.env.BILLING_REPORT_TO || "") : [SUPER_ADMIN_EMAIL];
  const subject = `Reporte mensual SaaS ${periodKey}`;

  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || (String(process.env.SMTP_SECURE || "").trim() === "1" ? 465 : 587));
  const secure = String(process.env.SMTP_SECURE || "").trim() === "1";
  const user = String(process.env.SMTP_USER || "").trim() || undefined;
  const pass = String(process.env.SMTP_PASS || "").trim() || undefined;
  const from = String(process.env.SMTP_FROM || "").trim();

  if (host && from) {
    await sendEmailViaSmtp({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure,
      user,
      pass,
      from,
      to,
      subject,
      text: report.text
    });
    await systemLog(LogLevel.INFO, "billing.report", "Monthly report sent", { periodKey, to, method: "smtp" }).catch(() => {});
  } else {
    await systemLog(LogLevel.INFO, "billing.report", "Monthly report generated (email not configured)", {
      periodKey,
      to,
      method: "none",
      hint: "Set SMTP_HOST, SMTP_FROM (and SMTP_USER/SMTP_PASS) to enable email sending.",
      report: report.text.slice(0, 5000)
    }).catch(() => {});
  }

  return { ok: true };
}

