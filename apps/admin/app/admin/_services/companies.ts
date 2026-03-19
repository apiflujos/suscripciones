import "server-only";

import { prisma } from "@suscripciones/database";

export async function listEmpresas(args: {
  tenantId?: string | null;
  take?: number;
  skip?: number;
  q?: string;
}) {
  const tenantId = args.tenantId || null;
  const takeRaw = Number(args.take ?? 20);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 20;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(args.q || "").trim();

  const where: any = {};
  if (tenantId) where.tenantId = tenantId;
  if (q) {
    const digits = q.replace(/[^\d]/g, "");
    const or: any[] = [
      { nombre: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { direccion: { contains: q, mode: "insensitive" } },
      { sitioWeb: { contains: q, mode: "insensitive" } }
    ];
    if (digits.length >= 4) {
      or.push({ telefono: { contains: digits } });
      or.push({ telefono: { contains: q } });
    } else {
      or.push({ telefono: { contains: q, mode: "insensitive" } });
    }
    where.OR = or;
  }

  const [items, total] = await prisma.$transaction([
    prisma.empresa.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: {
        contactoPrincipal: true,
        _count: { select: { contactos: true } }
      }
    }),
    prisma.empresa.count({ where })
  ]);

  return { items, total };
}

export async function getEmpresaById(id: string) {
  const empresaId = String(id || "").trim();
  if (!empresaId) return null;
  return prisma.empresa.findUnique({
    where: { id: empresaId },
    include: {
      contactos: { orderBy: { createdAt: "asc" } },
      contactoPrincipal: true
    }
  });
}

export async function listContactos(args: {
  tenantId?: string | null;
  take?: number;
  skip?: number;
  q?: string;
}) {
  const tenantId = args.tenantId || null;
  const takeRaw = Number(args.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(args.q || "").trim();

  const where: any = {};
  if (tenantId) where.empresa = { tenantId };
  if (q) {
    const digits = q.replace(/[^\d]/g, "");
    const or: any[] = [
      { nombre: { contains: q, mode: "insensitive" } },
      { cargo: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } }
    ];
    if (digits.length >= 4) {
      or.push({ telefono: { contains: digits } });
      or.push({ telefono: { contains: q } });
    } else {
      or.push({ telefono: { contains: q, mode: "insensitive" } });
    }
    where.OR = or;
  }

  const [items, total] = await prisma.$transaction([
    prisma.contacto.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: { empresa: true }
    }),
    prisma.contacto.count({ where })
  ]);

  return { items, total };
}

export async function countEmpresasAndContactos(tenantId?: string | null) {
  const whereEmpresa = tenantId ? { tenantId } : {};
  const whereContacto = tenantId ? { empresa: { tenantId } } : {};
  const [empresas, contactos] = await prisma.$transaction([
    prisma.empresa.count({ where: whereEmpresa }),
    prisma.contacto.count({ where: whereContacto })
  ]);
  return { empresas, contactos };
}
