import { LogLevel } from "@prisma/client";
import { systemLog } from "../../services/systemLog";
import { chatwootFollowupTrainer } from "../../services/chatwootFollowupTrainer";

export async function dataTrainer(payload: any) {
  const trainer = String(payload?.trainer || "chatwoot_followup").trim();
  if (trainer && trainer !== "chatwoot_followup") {
    await systemLog(LogLevel.WARN, "data_trainer", "Trainer desconocido", { trainer }).catch(() => {});
    return;
  }

  const stats = await chatwootFollowupTrainer(payload).catch((err) => {
    throw err;
  });

  await systemLog(LogLevel.INFO, "data_trainer", "Trainer ejecutado", {
    trainer: "chatwoot_followup",
    stats
  }).catch(() => {});
}
