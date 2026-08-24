"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gamificationRecalc = gamificationRecalc;
const client_1 = require("@prisma/client");
const logger_1 = require("../../lib/logger");
const systemLog_1 = require("../../services/systemLog");
const gamification_1 = require("../../services/gamification");
async function gamificationRecalc(payload) {
    const scope = (payload?.scope || "all");
    const tenantId = payload?.tenantId ? String(payload.tenantId) : null;
    await (0, gamification_1.recomputeGamificationScores)({ scope, tenantId }).catch((err) => {
        throw err;
    });
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "gamification.recalc", "Gamificacion recalculada", { scope, tenantId }).catch((err) => {
        logger_1.logger.warn({ err, scope, tenantId }, "gamificationRecalc: fallo escribiendo systemLog");
    });
}
