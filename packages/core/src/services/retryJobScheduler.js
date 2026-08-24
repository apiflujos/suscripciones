"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePaymentRetryRunAt = resolvePaymentRetryRunAt;
exports.ensurePaymentRetryJob = ensurePaymentRetryJob;
const client_1 = require("@prisma/client");
const prisma_1 = require("../db/prisma");
const runtimeConfig_1 = require("./runtimeConfig");
const timeZoneScheduling_1 = require("../lib/timeZoneScheduling");
const ACTIVE_JOB_STATUSES = [client_1.RetryJobStatus.PENDING, client_1.RetryJobStatus.RUNNING];
const SAME_SLOT_TOLERANCE_MS = 60_000;
async function resolvePaymentRetryRunAt(args) {
    const now = args.now instanceof Date && !Number.isNaN(args.now.getTime()) ? args.now : new Date();
    const rawDueAt = args.dueAt instanceof Date && !Number.isNaN(args.dueAt.getTime()) ? args.dueAt : now;
    const cfg = args.config ||
        (await (0, runtimeConfig_1.getAutoDebitConfig)().catch(() => ({ executionHour: "09:00", timeZone: "America/Bogota" })));
    const executionHour = String(cfg?.executionHour || "09:00").trim() || "09:00";
    const timeZone = String(cfg?.timeZone || "America/Bogota").trim() || "America/Bogota";
    const scheduledForDueDay = (0, timeZoneScheduling_1.applyClockTimeInZone)(rawDueAt, executionHour, timeZone);
    if (scheduledForDueDay.getTime() > now.getTime())
        return scheduledForDueDay;
    const scheduledForToday = (0, timeZoneScheduling_1.applyClockTimeInZone)(now, executionHour, timeZone);
    if (scheduledForToday.getTime() > now.getTime())
        return scheduledForToday;
    // Si la hora de hoy ya pasó, el cobro va a la de mañana. Devolver "ahora"
    // hacía que cada job se ejecutara al instante de crearse, y el cobro caía a
    // cualquier hora en vez de a la establecida.
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return (0, timeZoneScheduling_1.applyClockTimeInZone)(tomorrow, executionHour, timeZone);
}
async function ensurePaymentRetryJob(args) {
    const subscriptionId = String(args.subscriptionId || "").trim();
    if (!subscriptionId)
        return null;
    const db = args.db ?? prisma_1.prisma;
    const maxAttempts = Number.isFinite(args.maxAttempts) ? Math.max(1, Math.trunc(args.maxAttempts)) : 1;
    const targetRunAt = args.runAt instanceof Date && !Number.isNaN(args.runAt.getTime()) ? args.runAt : new Date();
    const existing = await db.retryJob.findFirst({
        where: {
            type: client_1.RetryJobType.PAYMENT_RETRY,
            status: { in: ACTIVE_JOB_STATUSES },
            payload: { path: ["subscriptionId"], equals: subscriptionId }
        },
        orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
        select: { id: true, runAt: true, maxAttempts: true }
    });
    if (!existing) {
        return db.retryJob.create({
            data: {
                type: client_1.RetryJobType.PAYMENT_RETRY,
                runAt: targetRunAt,
                maxAttempts,
                payload: { subscriptionId }
            }
        });
    }
    const sameSlot = Math.abs(existing.runAt.getTime() - targetRunAt.getTime()) <= SAME_SLOT_TOLERANCE_MS;
    if (sameSlot)
        return existing;
    return db.retryJob.update({
        where: { id: existing.id },
        data: {
            runAt: targetRunAt,
            maxAttempts: Math.max(existing.maxAttempts, maxAttempts),
            updatedAt: new Date()
        }
    });
}
