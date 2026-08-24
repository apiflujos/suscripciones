"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSaAppTenantId = getSaAppTenantId;
exports.consumeApp = consumeApp;
const logger_1 = require("../lib/logger");
const superAdminConsume_1 = require("./superAdminConsume");
function normalize(v) {
    const s = String(v || "").trim();
    return s || "";
}
function getSaAppTenantId() {
    return (normalize(process.env.SA_APP_TENANT_ID) ||
        normalize(process.env.SA_TENANT_ID) ||
        normalize(process.env.SUPER_ADMIN_TENANT_ID) ||
        "");
}
async function consumeApp(serviceKey, args) {
    const tenantId = getSaAppTenantId();
    if (!tenantId)
        return;
    await (0, superAdminConsume_1.consumeLimitOrBlock)(serviceKey, { tenantId, amount: args.amount, source: args.source, meta: args.meta }).catch((err) => {
        logger_1.logger.warn({ err, serviceKey, tenantId }, "superAdminApp: fallo consumiendo límite/app usage");
    });
}
