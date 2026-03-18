import { signJwt, verifyJwt } from "./jwt";

export async function signPublicToken(args: { sub: string; scope: "cart" | "payment" | "tokenization"; ttlSeconds: number }) {
  return signJwt({ sub: args.sub, role: "WEBHOOK", permissions: ["webhook:receive"], tenantId: null, scope: args.scope } as any, {
    ttlSeconds: args.ttlSeconds,
    audience: "public"
  });
}

export async function verifyPublicToken(token: string, scope: string) {
  const claims: any = await verifyJwt(token, { audience: "public" });
  if (!claims) return null;
  if (claims.scope && claims.scope !== scope) return null;
  return claims as any;
}
