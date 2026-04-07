import { LogLevel } from "@prisma/client";
import { logger } from "../../lib/logger";
import { systemLog } from "../../services/systemLog";
import { recomputeGamificationScores } from "../../services/gamification";

export async function gamificationRecalc(payload: any) {
  const scope = (payload?.scope || "all") as "customers" | "products" | "all";
  const tenantId = payload?.tenantId ? String(payload.tenantId) : null;
  await recomputeGamificationScores({ scope, tenantId }).catch((err) => {
    throw err;
  });
  await systemLog(LogLevel.INFO, "gamification.recalc", "Gamificacion recalculada", { scope, tenantId }).catch((err: any) => {
    logger.warn({ err, scope, tenantId }, "gamificationRecalc: fallo escribiendo systemLog");
  });
}
