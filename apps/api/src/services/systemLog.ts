import { LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getContextActor } from "./actorStore";

export const SystemActor = {
  SYSTEM: "sistema",
  WEBHOOK_WOMPI: "webhook:wompi",
  JOB_PAYMENT_RETRY: "job:paymentRetry",
  JOB_SUBSCRIPTION_REMINDER: "job:subscriptionReminder",
  JOB_SEND_CHATWOOT: "job:sendChatwootMessage",
  JOB_PROCESS_WOMPI: "job:processWompiEvent",
} as const;

export async function systemLog(
  level: LogLevel,
  source: string,
  message: string,
  context?: unknown,
  actor?: string
) {
  // Try provided actor, then context actor, then default to system
  const finalActor = actor || getContextActor() || SystemActor.SYSTEM;

  await prisma.systemLog.create({
    data: {
      level,
      source,
      message,
      context: context as any,
      actor: finalActor
    }
  });
}
