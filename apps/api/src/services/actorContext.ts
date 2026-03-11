import type { Request } from "express";
import { SystemActor } from "./systemLog";

export function getActorFromReq(req: Request): string {
  const sa = (req as any).sa;
  if (sa?.email) {
    return sa.email.toLowerCase().includes("@") ? sa.email : `user:${sa.email}`;
  }

  const adminEmail = req.header("x-admin-user-email") || "";
  if (adminEmail) {
    return adminEmail.toLowerCase().includes("@") ? adminEmail : `user:${adminEmail}`;
  }

  // Check if it's a known webhook source
  if (req.path.startsWith("/webhooks/wompi")) {
    return SystemActor.WEBHOOK_WOMPI;
  }

  return SystemActor.SYSTEM;
}
