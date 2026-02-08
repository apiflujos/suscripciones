import { prisma } from "../db/prisma";

function normalizeEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

async function main() {
  const email = normalizeEmail(process.env.SA_EMAIL || "");
  if (!email) throw new Error("SA_EMAIL is required");

  const dbName = await prisma.$queryRawUnsafe<{ current_database: string }[]>("select current_database() as current_database");
  const dbHost = await prisma.$queryRawUnsafe<{ inet_server_addr: string }[]>("select inet_server_addr() as inet_server_addr");

  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  console.log("DB", { name: dbName?.[0]?.current_database || null, host: dbHost?.[0]?.inet_server_addr || null });
  if (!user) {
    console.log("NOT_FOUND", { email });
    return;
  }
  console.log("USER", { email: user.email, role: user.role, active: user.active, tenantId: user.tenantId });
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
