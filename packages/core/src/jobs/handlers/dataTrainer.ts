import { LogLevel } from "@prisma/client";
import { logger } from "../../lib/logger";
import { systemLog } from "../../services/systemLog";
import { chatwootFollowupTrainer } from "../../services/chatwootFollowupTrainer";

export async function dataTrainer(payload: any) {
  const trainer = String(payload?.trainer || "chatwoot_followup").trim();
  if (trainer && trainer !== "chatwoot_followup") {
    await systemLog(LogLevel.WARN, "data_trainer", "Trainer desconocido", { trainer }).catch((err: any) => {
      logger.warn({ err, trainer }, "dataTrainer: fallo escribiendo systemLog de trainer desconocido");
    });
    return;
  }

  const stats = await chatwootFollowupTrainer(payload).catch((err) => {
    throw err;
  });

  await systemLog(LogLevel.INFO, "data_trainer", "Trainer ejecutado", {
    trainer: "chatwoot_followup",
    stats
  }).catch((err: any) => {
    logger.warn({ err, trainer: "chatwoot_followup" }, "dataTrainer: fallo escribiendo systemLog de ejecucion");
  });
}
