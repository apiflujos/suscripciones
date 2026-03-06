import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { hashPassword } from "../services/superAdminAuth";
import { SaUserRole } from "@prisma/client";

export const settingsUsersRouter = express.Router();

/**
 * Helper para obtener el usuario que hace la petición desde el header x-admin-user-email
 */
async function getRequestingUser(req: express.Request) {
  const email = String(req.header("x-admin-user-email") || "").trim().toLowerCase();
  if (!email) return null;
  return await prisma.saUser.findUnique({ where: { email } });
}

// Listar usuarios del tenant actual
settingsUsersRouter.get("/", async (req, res) => {
  const requester = await getRequestingUser(req);
  if (!requester || (requester.role !== SaUserRole.ADMIN && requester.role !== SaUserRole.SUPER_ADMIN)) {
    return res.status(403).json({ error: "unauthorized_role" });
  }

  const tenantId = requester.tenantId;
  if (!tenantId) return res.status(400).json({ error: "no_tenant_context" });

  const items = await prisma.saUser.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, active: true, createdAt: true }
  });

  res.json({ items });
});

// Crear un nuevo usuario (ADMIN o AGENT) para el tenant
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional().default(true)
});

settingsUsersRouter.post("/", async (req, res) => {
  const requester = await getRequestingUser(req);
  if (!requester || (requester.role !== SaUserRole.ADMIN && requester.role !== SaUserRole.SUPER_ADMIN)) {
    return res.status(403).json({ error: "unauthorized_role" });
  }

  const tenantId = requester.tenantId;
  if (!tenantId) return res.status(400).json({ error: "no_tenant_context" });

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.saUser.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_already_exists" });

  const user = await prisma.saUser.create({
    data: {
      tenantId,
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      active: parsed.data.active
    } as any
  });

  res.status(201).json({ 
    id: user.id, 
    email: user.email, 
    role: user.role, 
    active: user.active 
  });
});
