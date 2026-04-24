import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma";

type AuditRow = {
  id: string;
  name: string;
  tenantId: string | null;
  kind: string;
  metadataItemId: string | null;
  catalogProductId: string | null;
  catalogProductName: string | null;
  issue: string;
};

function readMetadataItemId(metadata: unknown) {
  const meta = metadata && typeof metadata === "object" ? (metadata as any) : {};
  const itemId = String(meta?.catalog?.itemId || "").trim();
  return itemId || null;
}

function loadEnvFile(filepath: string) {
  if (!fs.existsSync(filepath)) return;
  const raw = fs.readFileSync(filepath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function ensureEnvLoaded() {
  const root = path.resolve(__dirname, "../../../../");
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, ".env.local"));
}

async function main() {
  ensureEnvLoaded();
  const fix = process.argv.includes("--fix");

  const plans = await prisma.subscriptionPlan.findMany({
    select: {
      id: true,
      name: true,
      tenantId: true,
      metadata: true,
      catalogProductId: true,
      catalogProduct: { select: { id: true, name: true } }
    },
    orderBy: [{ tenantId: "asc" }, { name: "asc" }]
  });

  const rows: AuditRow[] = [];
  const updates: Array<{ id: string; catalogProductId: string | null; metadata: unknown }> = [];

  for (const plan of plans) {
    const kind = String((plan.metadata as any)?.kind || "").trim().toUpperCase();
    const metadataItemId = readMetadataItemId(plan.metadata);
    const catalogProductId = String(plan.catalogProductId || "").trim() || null;
    const catalogProductName = plan.catalogProduct?.name || null;

    if (kind === "CATALOG_ITEM") {
      if (catalogProductId) {
        rows.push({
          id: plan.id,
          name: plan.name,
          tenantId: plan.tenantId || null,
          kind,
          metadataItemId,
          catalogProductId,
          catalogProductName,
          issue: "catalog_item_should_not_point_to_catalog_product"
        });
      }
      continue;
    }

    if (!catalogProductId && !metadataItemId) {
      rows.push({
        id: plan.id,
        name: plan.name,
        tenantId: plan.tenantId || null,
        kind,
        metadataItemId,
        catalogProductId,
        catalogProductName,
        issue: "missing_catalog_product_mapping"
      });
      continue;
    }

    if (!catalogProductId && metadataItemId) {
      rows.push({
        id: plan.id,
        name: plan.name,
        tenantId: plan.tenantId || null,
        kind,
        metadataItemId,
        catalogProductId,
        catalogProductName,
        issue: "catalog_product_id_missing_but_metadata_present"
      });
      updates.push({ id: plan.id, catalogProductId: metadataItemId, metadata: plan.metadata });
      continue;
    }

    if (catalogProductId && metadataItemId && catalogProductId !== metadataItemId) {
      rows.push({
        id: plan.id,
        name: plan.name,
        tenantId: plan.tenantId || null,
        kind,
        metadataItemId,
        catalogProductId,
        catalogProductName,
        issue: "catalog_product_id_differs_from_metadata"
      });
      updates.push({ id: plan.id, catalogProductId, metadata: plan.metadata });
    }
  }

  if (fix && updates.length) {
    for (const update of updates) {
      const meta = update.metadata && typeof update.metadata === "object" ? ({ ...(update.metadata as any) } as any) : {};
      const catalog = meta.catalog && typeof meta.catalog === "object" ? { ...meta.catalog } : {};
      if (update.catalogProductId) {
        catalog.itemId = update.catalogProductId;
      } else {
        delete catalog.itemId;
      }
      meta.catalog = catalog;
      await prisma.subscriptionPlan.update({
        where: { id: update.id },
        data: {
          catalogProductId: update.catalogProductId,
          metadata: meta as any
        }
      });
    }
  }

  const summary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.issue] = (acc[row.issue] || 0) + 1;
    return acc;
  }, {});

  console.log("=== Product Plan Mapping Audit ===");
  console.log(`Scanned: ${plans.length}`);
  console.log(`Issues: ${rows.length}`);
  console.log(`Mode: ${fix ? "fix" : "read-only"}`);
  console.log(JSON.stringify(summary, null, 2));

  for (const row of rows.slice(0, 100)) {
    console.log(
      [
        row.issue,
        row.id,
        row.name,
        row.tenantId || "-",
        `catalogProductId=${row.catalogProductId || "-"}`,
        `metadataItemId=${row.metadataItemId || "-"}`,
        `catalogProductName=${row.catalogProductName || "-"}`
      ].join(" | ")
    );
  }
}

main()
  .catch((err) => {
    console.error("audit-product-plan-mapping failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
