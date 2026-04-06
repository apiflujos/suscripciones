import { prisma } from "../../db/prisma";
import { LogLevel } from "@prisma/client";
import { ChatwootClient } from "../../providers/chatwoot/client";
import { getChatwootConfig } from "../../services/runtimeConfig";
import { computeSmartListRecipients } from "../../services/smartList";
import { computeSmartViewIds } from "../../services/smartViews";
import { ensureChatwootContactForCustomer } from "../../services/chatwootSync";
import { systemLog } from "../../services/systemLog";
import { logger } from "../../lib/logger";

const BATCH_SIZE = 25;

async function getClient() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) throw new Error("chatwoot_not_configured");
  return new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
}

export async function sendCampaign(payload: { campaignId: string }) {
  const campaignId = String(payload?.campaignId || "").trim();
  if (!campaignId) return;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { smartList: true } });
  if (!campaign) return;

  try {
    const client = await getClient();

    let recipients: Array<{ id: string }> = [];
    if (campaign.smartViewFilters) {
      const ids = await computeSmartViewIds("customers", campaign.tenantId, campaign.smartViewFilters as any);
      recipients = ids.map((id) => ({ id }));
    } else if (campaign.smartListId && campaign.smartList) {
      recipients = await computeSmartListRecipients(campaign.smartList.rules as any);
    } else {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "FAILED", lastError: "missing_audience" }
      });
      await systemLog(LogLevel.ERROR, "campaigns.send", "Campaña sin audiencia válida", {
        campaignId: campaign.id,
        tenantId: campaign.tenantId
      }).catch(() => {});
      return;
    }

    if (recipients.length > 0) {
      await prisma.campaignSend.createMany({
        data: recipients.map((c: any) => ({
          campaignId: campaign.id,
          customerId: c.id,
          tenantId: campaign.tenantId
        })),
        skipDuplicates: true
      });
    }

    const pending = await prisma.campaignSend.findMany({
      where: { campaignId: campaign.id, status: "PENDING" },
      take: BATCH_SIZE,
      include: { customer: true }
    });

    for (const send of pending) {
      try {
        const ensured = await ensureChatwootContactForCustomer(send.customerId);
        if (!ensured.ok) {
          await prisma.campaignSend.update({
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
            templateParams: campaign.templateParams as any
          });
        } else {
          await client.sendMessage(conversation.conversationId, campaign.content);
        }

        await prisma.campaignSend.update({
          where: { id: send.id },
          data: { status: "SENT", sentAt: new Date(), errorMessage: null }
        });
      } catch (err: any) {
        await prisma.campaignSend.update({
          where: { id: send.id },
          data: { status: "FAILED", errorMessage: err?.message ? String(err.message) : "send_failed" }
        });
      }
    }

    const [sentCount, failedCount, pendingCount] = await Promise.all([
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "SENT" } }),
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "FAILED" } }),
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "PENDING" } })
    ]);

    const nextStatus = pendingCount === 0 ? "COMPLETED" : "RUNNING";
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: nextStatus,
        sentCount,
        failedCount,
        lastError: nextStatus === "COMPLETED" ? null : campaign.lastError,
        completedAt: nextStatus === "COMPLETED" ? new Date() : null
      }
    });

    await systemLog(LogLevel.INFO, "campaigns.send", "Lote de campaña procesado", {
      campaignId: campaign.id,
      tenantId: campaign.tenantId,
      sentCount,
      failedCount,
      pendingCount,
      batchSize: pending.length
    }).catch(() => {});

    if (pendingCount > 0) {
      await prisma.retryJob.create({
        data: { type: "SEND_CAMPAIGN", payload: { campaignId: campaign.id } }
      });
    }
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "send_campaign_failed";
    logger.error({ err, campaignId: campaign.id }, "Campaign send failed");
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "FAILED", lastError: message }
    });
    await systemLog(LogLevel.ERROR, "campaigns.send", "Campaña falló", {
      campaignId: campaign.id,
      tenantId: campaign.tenantId,
      error: message
    }).catch(() => {});
    throw err;
  }
}
