function b64urlEncode(input: Uint8Array) {
  let s = "";
  for (const b of input) s += String.fromCharCode(b);
  const b64 = Buffer.from(s, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importHmacKey(secret: string) {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function hmacSha256(secret: string, message: string) {
  const key = await importHmacKey(secret);
  const data = new TextEncoder().encode(message);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

export async function signPublicToken(args: { sub: string; scope: "cart" | "payment" | "tokenization"; ttlSeconds: number }) {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("missing_jwt_secret");
  const issuer = String(process.env.JWT_ISSUER || "suscripciones").trim();
  const audience = "public";
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.trunc(Number(args.ttlSeconds || 0)) || 3600);

  const payload = {
    sub: args.sub,
    role: "WEBHOOK",
    permissions: ["webhook:receive"],
    tenantId: null,
    scope: args.scope,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + ttl
  } as const;

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const toSign = `${headerB64}.${payloadB64}`;
  const sig = await hmacSha256(secret, toSign);
  const sigB64 = b64urlEncode(sig);
  return `${toSign}.${sigB64}`;
}
