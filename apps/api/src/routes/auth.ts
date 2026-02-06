import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { SaUserRole } from "@prisma/client";
import { createSaSession, isSuperAdminEmail, verifyPassword } from "../services/superAdminAuth";

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

  if (isSuperAdminEmail(email)) {
    try {
      const ip = req.ip ? String(req.ip) : null;
      const ua = req.header("user-agent") || null;
      const session = await createSaSession({ email, password, ip, userAgent: ua });
      return res.json({
        kind: "super_admin",
        email,
        role: "SUPER_ADMIN",
        saToken: session.token,
        expiresAt: session.expiresAt.toISOString()
      });
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : "";
      if (msg === "super_admin_not_configured") return res.status(500).json({ error: "super_admin_not_configured" });
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user || !user.active) return res.status(401).json({ error: "unauthorized" });
  if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "unauthorized" });

  const role = user.role === SaUserRole.ADMIN ? "ADMIN" : "AGENT";
  res.json({ kind: "user", email: user.email, role, tenantId: user.tenantId ?? null });
});
