import { syncAllSmartLists } from "../../services/smartListSync";
import { systemLog } from "../../services/systemLog";
import { LogLevel } from "@prisma/client";

export async function syncSmartLists() {
  const results = await syncAllSmartLists();
  await systemLog(LogLevel.INFO, "smart_lists.sync", "Smart lists synced", { results }).catch(() => {});
}
