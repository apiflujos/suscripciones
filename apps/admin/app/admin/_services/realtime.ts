import "server-only";

import { LogLevel } from "@prisma/client";
import { systemLog } from "@suscripciones/core/services/systemLog";

export async function writeRealtimeTestLog() {
  await systemLog(
    LogLevel.WARN,
    "realtime.test",
    "Notificación de prueba en tiempo real",
    { createdAt: new Date().toISOString() },
    "Sistema"
  ).catch(() => {});
}
