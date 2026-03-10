import { prisma } from "../db/prisma";
import { reconcileWompiTransaction, reconcileWompiByReference } from "../services/wompiReconcile";

type Args = {
  days: number;
  tenantId?: string;
  limit: number;
  dryRun: boolean;
  prefer: "tx" | "ref";
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = raw.indexOf(flag);
    if (idx === -1) return undefined;
    return raw[idx + 1];
  };

  const days = Number(get("--days") || 7);
  const tenantId = get("--tenant");
  const limit = Number(get("--limit") || 200);
  const dryRun = raw.includes("--dry-run");
  const prefer = (get("--prefer") || "tx") === "ref" ? "ref" : "tx";

  return {
    days: Number.isFinite(days) && days > 0 ? days : 7,
    tenantId: tenantId ? String(tenantId).trim() : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 200,
    dryRun,
    prefer
  };
}

async function main() {
  const args = parseArgs();
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  const pending = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: since },
      ...(args.tenantId ? { tenantId: args.tenantId } : {})
    },
    orderBy: { createdAt: "asc" },
    take: args.limit,
    select: {
      id: true,
      tenantId: true,
      reference: true,
      wompiTransactionId: true,
      createdAt: true
    }
  });

  console.log(
    JSON.stringify(
      {
        mode: "reconcile-stale-pending",
        count: pending.length,
        days: args.days,
        tenantId: args.tenantId || null,
        dryRun: args.dryRun,
        prefer: args.prefer
      },
      null,
      2
    )
  );

  let ok = 0;
  let failed = 0;

  for (const p of pending) {
    const useTx = args.prefer === "tx" && p.wompiTransactionId;
    const label = useTx ? "tx" : "ref";
    try {
      if (args.dryRun) {
        console.log(`[dry-run] ${label} payment=${p.id} ref=${p.reference} tx=${p.wompiTransactionId || "—"}`);
        ok++;
        continue;
      }

      if (useTx) {
        const result = await reconcileWompiTransaction({
          wompiTransactionId: p.wompiTransactionId!,
          tenantId: p.tenantId,
          checksumPrefix: "batch-reconcile"
        });
        console.log(`[ok] ${label} payment=${p.id} tx=${p.wompiTransactionId} -> ${result.status || result.reason}`);
        ok++;
      } else {
        const result = await reconcileWompiByReference({
          reference: p.reference,
          tenantId: p.tenantId,
          checksumPrefix: "batch-reconcile-ref"
        });
        console.log(`[ok] ${label} payment=${p.id} ref=${p.reference} -> ${result.status || result.reason}`);
        ok++;
      }
    } catch (err: any) {
      failed++;
      console.error(
        `[fail] payment=${p.id} ref=${p.reference} tx=${p.wompiTransactionId || "—"} error=${String(err?.message || err)}`
      );
    }
  }

  console.log(JSON.stringify({ done: true, ok, failed }, null, 2));
}

main()
  .catch((err) => {
    console.error(String(err?.stack || err?.message || err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
