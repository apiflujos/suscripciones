"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCampaign = sendCampaign;
const prisma_1 = require("../../db/prisma");
const client_1 = require("@prisma/client");
const client_2 = require("../../providers/chatwoot/client");
const runtimeConfig_1 = require("../../services/runtimeConfig");
const smartList_1 = require("../../services/smartList");
const smartViews_1 = require("../../services/smartViews");
const chatwootSync_1 = require("../../services/chatwootSync");
const systemLog_1 = require("../../services/systemLog");
const logger_1 = require("../../lib/logger");
const BATCH_SIZE = 25;
async function getClient() {
    const cfg = await (0, runtimeConfig_1.getChatwootConfig)();
    if (!cfg.configured)
        throw new Error("chatwoot_not_configured");
    return new client_2.ChatwootClient({
        baseUrl: cfg.baseUrl,
        accountId: cfg.accountId,
        apiAccessToken: cfg.apiAccessToken,
        inboxId: cfg.inboxId
    });
}
async function sendCampaign(payload) {
    const campaignId = String(payload?.campaignId || "").trim();
    if (!campaignId)
        return;
    const campaign = await prisma_1.prisma.campaign.findUnique({ where: { id: campaignId }, include: { smartList: true } });
    if (!campaign)
        return;
    try {
        const client = await getClient();
        let recipients = [];
        if (campaign.smartViewFilters) {
            const ids = await (0, smartViews_1.computeSmartViewIds)("customers", campaign.tenantId, campaign.smartViewFilters);
            recipients = ids.map((id) => ({ id }));
        }
        else if (campaign.smartListId && campaign.smartList) {
            recipients = await (0, smartList_1.computeSmartListRecipients)(campaign.smartList.rules);
        }
        else {
            await prisma_1.prisma.campaign.update({
                where: { id: campaign.id },
                data: { status: "FAILED", lastError: "missing_audience" }
            });
            await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "campaigns.send", "Campaña sin audiencia válida", {
                campaignId: campaign.id,
                tenantId: campaign.tenantId
            }).catch((err) => {
                logger_1.logger.warn({ err, campaignId: campaign.id }, "Fallo escribiendo systemLog de campaña sin audiencia");
            });
            return;
        }
        if (recipients.length > 0) {
            await prisma_1.prisma.campaignSend.createMany({
                data: recipients.map((c) => ({
                    campaignId: campaign.id,
                    customerId: c.id,
                    tenantId: campaign.tenantId
                })),
                skipDuplicates: true
            });
        }
        const pending = await prisma_1.prisma.campaignSend.findMany({
            where: { campaignId: campaign.id, status: "PENDING" },
            take: BATCH_SIZE,
            include: { customer: true }
        });
        for (const send of pending) {
            try {
                const ensured = await (0, chatwootSync_1.ensureChatwootContactForCustomer)(send.customerId);
                if (!ensured.ok) {
                    await prisma_1.prisma.campaignSend.update({
                        where: { id: send.id },
                        data: { status: "FAILED", errorMessage: ensured.reason }
                    });
                    continue;
                }
                const conversation = await client.createConversation({
                    contactId: ensured.contactId,
                    sourceId: ensured.sourceId
                });
                if (campaign.templateParams) {
                    await client.sendTemplate(conversation.conversationId, {
                        content: campaign.content,
                        templateParams: campaign.templateParams
                    });
                }
                else {
                    await client.sendMessage(conversation.conversationId, campaign.content);
                }
                await prisma_1.prisma.campaignSend.update({
                    where: { id: send.id },
                    data: { status: "SENT", sentAt: new Date(), errorMessage: null }
                });
            }
            catch (err) {
                await prisma_1.prisma.campaignSend.update({
                    where: { id: send.id },
                    data: { status: "FAILED", errorMessage: err?.message ? String(err.message) : "send_failed" }
                });
            }
        }
        const [sentCount, failedCount, pendingCount] = await Promise.all([
            prisma_1.prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "SENT" } }),
            prisma_1.prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "FAILED" } }),
            prisma_1.prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "PENDING" } })
        ]);
        const nextStatus = pendingCount === 0 ? "COMPLETED" : "RUNNING";
        await prisma_1.prisma.campaign.update({
            where: { id: campaign.id },
            data: {
                status: nextStatus,
                sentCount,
                failedCount,
                lastError: nextStatus === "COMPLETED" ? null : campaign.lastError,
                completedAt: nextStatus === "COMPLETED" ? new Date() : null
            }
        });
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "campaigns.send", "Lote de campaña procesado", {
            campaignId: campaign.id,
            tenantId: campaign.tenantId,
            sentCount,
            failedCount,
            pendingCount,
            batchSize: pending.length
        }).catch((err) => {
            logger_1.logger.warn({ err, campaignId: campaign.id }, "Fallo escribiendo systemLog de lote de campaña");
        });
        if (pendingCount > 0) {
            await prisma_1.prisma.retryJob.create({
                data: { type: "SEND_CAMPAIGN", payload: { campaignId: campaign.id } }
            });
        }
    }
    catch (err) {
        const message = err?.message ? String(err.message) : "send_campaign_failed";
        logger_1.logger.error({ err, campaignId: campaign.id }, "Campaign send failed");
        await prisma_1.prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: "FAILED", lastError: message }
        });
        await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "campaigns.send", "Campaña falló", {
            campaignId: campaign.id,
            tenantId: campaign.tenantId,
            error: message
        }).catch((err) => {
            logger_1.logger.warn({ err, campaignId: campaign.id }, "Fallo escribiendo systemLog de campaña fallida");
        });
        throw err;
    }
}
