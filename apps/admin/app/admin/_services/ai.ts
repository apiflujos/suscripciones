import "server-only";

import crypto from "crypto";
import { LogLevel, RetryJobType } from "@prisma/client";
import { prisma } from "@suscripciones/database";
import { logger } from "@suscripciones/core/lib/logger";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { getGlobalModuleAccess } from "@suscripciones/core/services/moduleAccess";

type AiAccessDenied = { ok: false; status: 403; error: "ai_disabled"; reason?: string | null };
type AiHistoryOk = { ok: true; items: any[] };

export async function getAiHistory(args: {
  tenantId?: string | null;
  take: number;
  scope?: string;
  customerId?: string;
  productId?: string;
}): Promise<AiHistoryOk | AiAccessDenied> {
  const aiAccess = await getGlobalModuleAccess("ai");
  if (!aiAccess.enabled) {
    return { ok: false, status: 403, error: "ai_disabled", reason: aiAccess.reason };
  }

  const andFilters: any[] = [];
  if (args.tenantId) andFilters.push({ context: { path: ["tenantId"], equals: args.tenantId } });
  if (args.scope) andFilters.push({ context: { path: ["scope"], equals: args.scope } });
  if (args.customerId) andFilters.push({ context: { path: ["customerId"], equals: args.customerId } });
  if (args.productId) andFilters.push({ context: { path: ["productId"], equals: args.productId } });

  const items = await prisma.systemLog.findMany({
    where: {
      source: { startsWith: "ai." },
      ...(andFilters.length ? { AND: andFilters } : {})
    },
    orderBy: { createdAt: "desc" },
    take: args.take
  });

  const filtered = items.filter((i) => {
    const ctx: any = i.context || {};
    return Boolean(ctx?.answer || ctx?.error);
  });

  return { ok: true, items: filtered };
}

type AiAskOk = { ok: true; requestId: string };

export async function queueAiAssistRequest(args: {
  question: string;
  from?: string | null;
  to?: string | null;
  tenantId?: string | null;
  customerId?: string | null;
  productId?: string | null;
  scope?: string | null;
}): Promise<AiAskOk | AiAccessDenied> {
  const aiAccess = await getGlobalModuleAccess("ai");
  if (!aiAccess.enabled) {
    return { ok: false, status: 403, error: "ai_disabled", reason: aiAccess.reason };
  }

  const requestId = crypto.randomUUID();
  const payload = {
    requestId,
    question: args.question,
    from: args.from || null,
    to: args.to || null,
    tenantId: args.tenantId || null,
    customerId: args.customerId || null,
    productId: args.productId || null,
    scope: args.scope || null,
    requestedAt: new Date().toISOString()
  };

  await prisma.retryJob.create({
    data: {
      type: RetryJobType.AI_ASSIST,
      runAt: new Date(),
      maxAttempts: 2,
      payload
    }
  });

  await systemLog(LogLevel.INFO, "ai.chat.requested", "Solicitud IA registrada", payload).catch((err) => {
    logger.warn({ err, requestId }, "ai service: fallo escribiendo systemLog de solicitud");
  });

  return { ok: true, requestId };
}
