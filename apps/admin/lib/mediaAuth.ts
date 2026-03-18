import { signJwt, verifyJwt } from "./jwt";

export async function signMediaToken(filename: string, ttlSeconds = 600) {
  const token = await signJwt({
    sub: "media",
    role: "ADMIN",
    permissions: ["media:read"],
    tenantId: null,
    file: filename
  } as any, { ttlSeconds });
  return token;
}

export async function verifyMediaToken(token: string, filename: string) {
  const claims: any = await verifyJwt(token);
  if (!claims) return null;
  if (!Array.isArray(claims.permissions) || !claims.permissions.includes("media:read")) return null;
  if (claims.file && claims.file !== filename) return null;
  return claims as any;
}
