import { prisma } from "../db/prisma";
import { getPublicBaseUrlFromEnv } from "../services/publicBase";

function normalizeImageUrl(raw: unknown, base: string) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  if (!value.includes("/") && /\.(jpe?g|png|webp|gif)$/i.test(value)) {
    return base ? `${base}/public/media/${value}` : `/public/media/${value}`;
  }
  return value;
}

async function main() {
  const base = getPublicBaseUrlFromEnv();
  if (!base) {
    console.warn("[repair-product-image-urls] APP_PUBLIC_BASE_URL is empty. Using relative /public/media paths.");
  }

  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      metadata: { path: ["kind"], equals: "CATALOG_ITEM" } as any
    },
    select: { id: true, name: true, metadata: true }
  });

  let scanned = 0;
  let fixed = 0;
  for (const plan of plans) {
    scanned += 1;
    const meta = plan.metadata && typeof plan.metadata === "object" ? (plan.metadata as any) : {};
    const imageUrl = meta?.imageUrl;
    if (!imageUrl) continue;
    if (/^https?:\/\//i.test(String(imageUrl)) || String(imageUrl).startsWith("/")) continue;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(String(imageUrl))) continue;

    const nextUrl = normalizeImageUrl(imageUrl, base);
    if (!nextUrl || nextUrl === imageUrl) continue;
    const nextMeta = { ...meta, imageUrl: nextUrl };
    await prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { metadata: nextMeta as any }
    });
    fixed += 1;
    console.log(`Fixed image URL in product ${plan.id} (${plan.name}) -> ${nextUrl}`);
  }

  console.log(`Done. Scanned: ${scanned}. Fixed: ${fixed}.`);
}

main()
  .catch((err) => {
    console.error("repair failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
