import { SystemActor } from "./systemLog";

type HeaderLike = { header?: (name: string) => string | undefined; headers?: Record<string, string>; path?: string };

export function getActorFromReq(req: HeaderLike | any): string {
  const sa = (req as any).sa;
  if (sa?.email) {
    return sa.email.toLowerCase().includes("@") ? sa.email : `user:${sa.email}`;
  }

  const adminEmail = (req?.header?.("x-admin-user-email") ||
    req?.headers?.["x-admin-user-email"] ||
    req?.headers?.["X-Admin-User-Email"] ||
    "") as string;
  if (adminEmail) {
    return adminEmail.toLowerCase().includes("@") ? adminEmail : `user:${adminEmail}`;
  }

  // Check if it's a known webhook source
  const path = typeof req?.path === "string" ? req.path : "";
  if (path.startsWith("/webhooks/wompi")) {
    return SystemActor.WEBHOOK_WOMPI;
  }

  return SystemActor.SYSTEM;
}
