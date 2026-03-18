import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const optionalPositiveIntFromEnv = z.preprocess((value) => {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, z.coerce.number().int().positive().optional());

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1),
  WOMPI_EVENTS_SECRET: z.string().optional().or(z.literal("")),
  WOMPI_PUBLIC_KEY: z.string().optional().or(z.literal("")),
  WOMPI_PRIVATE_KEY: z.string().optional().or(z.literal("")),
  WOMPI_INTEGRITY_SECRET: z.string().optional().or(z.literal("")),
  WOMPI_API_BASE_URL: z.string().url().default("https://api.wompi.co/v1"),
  WOMPI_CHECKOUT_LINK_BASE_URL: z.string().url().default("https://checkout.wompi.co/l/"),
  WOMPI_REDIRECT_URL: z.string().url().optional().or(z.literal("")),
  ADMIN_API_TOKEN: z.string().min(12),
  SHOPIFY_FORWARD_URL: z.string().url().optional().or(z.literal("")),
  SHOPIFY_FORWARD_SECRET: z.string().optional().or(z.literal("")),
  SHOPIFY_FORWARD_ORIGIN: z.enum(["shopify", "shopify-native"]).optional(),
  CREDENTIALS_ENCRYPTION_KEY_B64: z.string().optional().or(z.literal("")),
  CHATWOOT_BASE_URL: z.string().url().optional().or(z.literal("")),
  CHATWOOT_ACCOUNT_ID: optionalPositiveIntFromEnv,
  CHATWOOT_API_ACCESS_TOKEN: z.string().optional().or(z.literal("")),
  CHATWOOT_INBOX_ID: optionalPositiveIntFromEnv
});

export type Env = z.infer<typeof envSchema>;

let envHydrated = false;

function stripWrappedQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDotEnv(content: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = stripWrappedQuotes(line.slice(eqIndex + 1).trim());
    parsed[key] = value;
  }
  return parsed;
}

function hydrateProcessEnvFromFile(filePath: string) {
  if (!fs.existsSync(filePath)) return false;
  const parsed = parseDotEnv(fs.readFileSync(filePath, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    process.env[k] = v;
  }
  return true;
}

function ensureProcessEnvHydrated() {
  if (envHydrated) return;

  const envFileOverride = String(process.env.ENV_FILE || "").trim();
  const candidates = [
    envFileOverride,
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps", "admin", ".env"),
    path.resolve(process.cwd(), "apps", "admin", ".env.local"),
    path.resolve(__dirname, "..", "..", ".env"),
    path.resolve(__dirname, "..", "..", "..", ".env"),
    path.resolve(__dirname, "..", "..", "..", "apps", "admin", ".env"),
    path.resolve(__dirname, "..", "..", "..", "apps", "admin", ".env.local")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (hydrateProcessEnvFromFile(candidate)) break;
  }
  envHydrated = true;
}

export function loadEnv(processEnv: NodeJS.ProcessEnv): Env {
  ensureProcessEnvHydrated();
  const normalized = {
    ...process.env,
    ...processEnv,
    ADMIN_API_TOKEN: processEnv.ADMIN_API_TOKEN ?? process.env.ADMIN_API_TOKEN
  } as NodeJS.ProcessEnv;

  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}
