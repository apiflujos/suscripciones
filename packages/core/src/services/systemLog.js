"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemActor = void 0;
exports.systemLog = systemLog;
const prisma_1 = require("../db/prisma");
const actorStore_1 = require("./actorStore");
const realtimePublisher_1 = require("./realtimePublisher");
exports.SystemActor = {
    SYSTEM: "sistema",
    WEBHOOK_WOMPI: "webhook:wompi",
    JOB_PAYMENT_RETRY: "job:paymentRetry",
    JOB_SUBSCRIPTION_REMINDER: "job:subscriptionReminder",
    JOB_SEND_CHATWOOT: "job:sendChatwootMessage",
    JOB_PROCESS_WOMPI: "job:processWompiEvent",
};
async function systemLog(level, source, message, context, actor) {
    // Try provided actor, then context actor, then default to system
    const finalActor = actor || (0, actorStore_1.getContextActor)() || exports.SystemActor.SYSTEM;
    await prisma_1.prisma.systemLog.create({
        data: {
            level,
            source,
            message,
            context: context,
            actor: finalActor
        }
    });
    void (0, realtimePublisher_1.publishRealtime)("logs", {
        level,
        source,
        message,
        actor: finalActor,
        createdAt: new Date().toISOString()
    });
}
