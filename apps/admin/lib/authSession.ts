export const ADMIN_SESSION_COOKIE = "admin_session";

function normalize(v: unknown) {
  return String(v || "").trim();
}

export function getAdminBasicCredentials() {
  return {
    user: normalize(process.env.ADMIN_BASIC_USER),
    pass: normalize(process.env.ADMIN_BASIC_PASS)
  };
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toHex(new Uint8Array(digest));
}

export async function computeAdminSessionToken() {
  const { user, pass } = getAdminBasicCredentials();
  if (!user || !pass) return "";
  const salt = normalize(process.env.ADMIN_SESSION_SALT) || "v1";
  return sha256Hex(`admin:${salt}:${user}:${pass}`);
}

