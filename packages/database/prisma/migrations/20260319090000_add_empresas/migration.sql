-- CreateTable: Empresa
CREATE TABLE "Empresa" (
  "id" UUID NOT NULL,
  "tenantId" UUID,
  "nombre" TEXT NOT NULL,
  "email" TEXT,
  "telefono" TEXT,
  "direccion" TEXT,
  "sitioWeb" TEXT,
  "contactoPrincipalId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Contacto
CREATE TABLE "Contacto" (
  "id" UUID NOT NULL,
  "empresaId" UUID NOT NULL,
  "nombre" TEXT NOT NULL,
  "email" TEXT,
  "telefono" TEXT,
  "cargo" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Contacto_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Subscription
ALTER TABLE "Subscription" ADD COLUMN "empresaId" UUID;
ALTER TABLE "Subscription" ADD COLUMN "contactoId" UUID;

-- Indexes
CREATE INDEX "Empresa_tenantId_idx" ON "Empresa"("tenantId");
CREATE INDEX "Empresa_contactoPrincipalId_idx" ON "Empresa"("contactoPrincipalId");
CREATE UNIQUE INDEX "Empresa_contactoPrincipalId_key" ON "Empresa"("contactoPrincipalId");
CREATE INDEX "Contacto_empresaId_idx" ON "Contacto"("empresaId");
CREATE INDEX "Subscription_empresaId_idx" ON "Subscription"("empresaId");
CREATE INDEX "Subscription_contactoId_idx" ON "Subscription"("contactoId");

-- Foreign Keys
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_contactoPrincipalId_fkey" FOREIGN KEY ("contactoPrincipalId") REFERENCES "Contacto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contacto" ADD CONSTRAINT "Contacto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_contactoId_fkey" FOREIGN KEY ("contactoId") REFERENCES "Contacto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
