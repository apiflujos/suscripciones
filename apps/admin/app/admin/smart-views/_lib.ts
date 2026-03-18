export function readActorEmail(req: Request): string | null {
  const raw = String(req.headers.get("x-admin-user-email") || "").trim();
  return raw || null;
}
