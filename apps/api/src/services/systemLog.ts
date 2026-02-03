import { LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";

export async function systemLog(level: LogLevel, source: string, message: string, context?: unknown) {
  await prisma.systemLog.create({
    data: {
      level,
      source,
      message,
      context: context as any
    }
  });
}

