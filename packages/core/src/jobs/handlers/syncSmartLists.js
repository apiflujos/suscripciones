"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSmartLists = syncSmartLists;
const smartListSync_1 = require("../../services/smartListSync");
const systemLog_1 = require("../../services/systemLog");
const client_1 = require("@prisma/client");
const logger_1 = require("../../lib/logger");
async function syncSmartLists() {
    const results = await (0, smartListSync_1.syncAllSmartLists)();
    if (!results.length)
        return;
    const totals = results.reduce((acc, r) => {
        acc.added += r.added || 0;
        acc.removed += r.removed || 0;
        acc.failed += r.ok ? 0 : 1;
        return acc;
    }, { added: 0, removed: 0, failed: 0 });
    if (totals.added === 0 && totals.removed === 0 && totals.failed === 0)
        return;
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "smart_lists.sync", "Smart lists synced", { results, totals }).catch((err) => {
        logger_1.logger.warn({ err, totals }, "syncSmartLists: fallo escribiendo systemLog");
    });
}
