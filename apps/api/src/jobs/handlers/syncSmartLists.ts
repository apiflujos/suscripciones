import { syncAllSmartLists } from "../../services/smartListSync";
import { systemLog } from "../../services/systemLog";
import { LogLevel } from "@prisma/client";

export async function syncSmartLists() {
  const results = await syncAllSmartLists();
  if (!results.length) return;
  const totals = results.reduce(
    (acc, r) => {
      acc.added += r.added || 0;
      acc.removed += r.removed || 0;
      acc.failed += r.ok ? 0 : 1;
      return acc;
    },
    { added: 0, removed: 0, failed: 0 }
  );
  if (totals.added === 0 && totals.removed === 0 && totals.failed === 0) return;
  await systemLog(LogLevel.INFO, "smart_lists.sync", "Smart lists synced", { results, totals }).catch(() => {});
}
