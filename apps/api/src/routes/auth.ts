import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { SaUserRole } from "@prisma/client";
import { createSaSession, verifyPassword } from "../services/superAdminAuth";

export const authRouter = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) {
    const total = await prisma.saUser.count();
    if (total === 0) return res.status(500).json({ error: "no_admin_users" });
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!user.active) return res.status(401).json({ error: "unauthorized" });
  if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "unauthorized" });

  if (user.role === SaUserRole.SUPER_ADMIN) {
    try {
      const ip = req.ip ? String(req.ip) : null;
      const ua = req.header("user-agent") || null;
      const session = await createSaSession({ email: user.email, password, ip, userAgent: ua });
      return res.json({
        kind: "super_admin",
        email: user.email,
        role: "SUPER_ADMIN",
        saToken: session.token,
        expiresAt: session.expiresAt.toISOString()
      });
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : "";
      if (msg === "no_super_admin_user") return res.status(500).json({ error: "no_super_admin_user" });
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const role = user.role === SaUserRole.ADMIN ? "ADMIN" : "AGENT";
  res.json({ kind: "user", email: user.email, role, tenantId: user.tenantId ?? null });
});
