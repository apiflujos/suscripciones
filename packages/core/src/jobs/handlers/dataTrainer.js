"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataTrainer = dataTrainer;
const client_1 = require("@prisma/client");
const logger_1 = require("../../lib/logger");
const systemLog_1 = require("../../services/systemLog");
const chatwootFollowupTrainer_1 = require("../../services/chatwootFollowupTrainer");
async function dataTrainer(payload) {
    const trainer = String(payload?.trainer || "chatwoot_followup").trim();
    if (trainer && trainer !== "chatwoot_followup") {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "data_trainer", "Trainer desconocido", { trainer }).catch((err) => {
            logger_1.logger.warn({ err, trainer }, "dataTrainer: fallo escribiendo systemLog de trainer desconocido");
        });
        return;
    }
    const stats = await (0, chatwootFollowupTrainer_1.chatwootFollowupTrainer)(payload).catch((err) => {
        throw err;
    });
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "data_trainer", "Trainer ejecutado", {
        trainer: "chatwoot_followup",
        stats
    }).catch((err) => {
        logger_1.logger.warn({ err, trainer: "chatwoot_followup" }, "dataTrainer: fallo escribiendo systemLog de ejecucion");
    });
}
