"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
const zod_1 = require("zod");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const optionalPositiveIntFromEnv = zod_1.z.preprocess((value) => {
    if (value == null)
        return undefined;
    if (typeof value === "string" && value.trim() === "")
        return undefined;
    return value;
}, zod_1.z.coerce.number().int().positive().optional());
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.string().default("development"),
    PORT: zod_1.z.coerce.number().int().positive().default(3002),
    DATABASE_URL: zod_1.z.string().min(1),
    APP_PUBLIC_BASE_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    NEXT_PUBLIC_PUBLIC_BASE_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    NEXT_PUBLIC_API_BASE_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    WOMPI_EVENTS_SECRET: zod_1.z.string().optional().or(zod_1.z.literal("")),
    WOMPI_PUBLIC_KEY: zod_1.z.string().optional().or(zod_1.z.literal("")),
    WOMPI_PRIVATE_KEY: zod_1.z.string().optional().or(zod_1.z.literal("")),
    WOMPI_INTEGRITY_SECRET: zod_1.z.string().optional().or(zod_1.z.literal("")),
    WOMPI_API_BASE_URL: zod_1.z.string().url().default("https://api.wompi.co/v1"),
    WOMPI_CHECKOUT_LINK_BASE_URL: zod_1.z.string().url().default("https://checkout.wompi.co/l/"),
    WOMPI_REDIRECT_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    ADMIN_API_TOKEN: zod_1.z.string().min(12).optional().or(zod_1.z.literal("")),
    JWT_SECRET: zod_1.z.string().min(16).optional().or(zod_1.z.literal("")),
    JWT_ISSUER: zod_1.z.string().optional().or(zod_1.z.literal("")),
    JWT_AUDIENCE: zod_1.z.string().optional().or(zod_1.z.literal("")),
    JWT_TTL_SECONDS: zod_1.z.coerce.number().optional(),
    JWT_REFRESH_TTL_DAYS: zod_1.z.coerce.number().optional(),
    REALTIME_PUBLISH_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    REALTIME_PUBLISH_TOKEN: zod_1.z.string().optional().or(zod_1.z.literal("")),
    SHOPIFY_FORWARD_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    SHOPIFY_FORWARD_SECRET: zod_1.z.string().optional().or(zod_1.z.literal("")),
    SHOPIFY_FORWARD_ORIGIN: zod_1.z.enum(["shopify", "shopify-native"]).optional(),
    CREDENTIALS_ENCRYPTION_KEY_B64: zod_1.z.string().optional().or(zod_1.z.literal("")),
    CHATWOOT_BASE_URL: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    CHATWOOT_ACCOUNT_ID: optionalPositiveIntFromEnv,
    CHATWOOT_API_ACCESS_TOKEN: zod_1.z.string().optional().or(zod_1.z.literal("")),
    CHATWOOT_INBOX_ID: optionalPositiveIntFromEnv
});
let envHydrated = false;
function stripWrappedQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function parseDotEnv(content) {
    const parsed = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const eqIndex = line.indexOf("=");
        if (eqIndex <= 0)
            continue;
        const key = line.slice(0, eqIndex).trim();
        const value = stripWrappedQuotes(line.slice(eqIndex + 1).trim());
        parsed[key] = value;
    }
    return parsed;
}
function hydrateProcessEnvFromFile(filePath) {
    if (!node_fs_1.default.existsSync(filePath))
        return false;
    const parsed = parseDotEnv(node_fs_1.default.readFileSync(filePath, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
        process.env[k] = v;
    }
    return true;
}
function ensureProcessEnvHydrated() {
    if (envHydrated)
        return;
    const envFileOverride = String(process.env.ENV_FILE || "").trim();
    const candidates = [
        envFileOverride,
        node_path_1.default.resolve(process.cwd(), ".env"),
        node_path_1.default.resolve(process.cwd(), "apps", "admin", ".env"),
        node_path_1.default.resolve(process.cwd(), "apps", "admin", ".env.local"),
        node_path_1.default.resolve(__dirname, "..", "..", ".env"),
        node_path_1.default.resolve(__dirname, "..", "..", "..", ".env"),
        node_path_1.default.resolve(__dirname, "..", "..", "..", "apps", "admin", ".env"),
        node_path_1.default.resolve(__dirname, "..", "..", "..", "apps", "admin", ".env.local")
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (hydrateProcessEnvFromFile(candidate))
            break;
    }
    envHydrated = true;
}
function loadEnv(processEnv) {
    ensureProcessEnvHydrated();
    const normalized = {
        ...process.env,
        ...processEnv,
        ADMIN_API_TOKEN: processEnv.ADMIN_API_TOKEN ?? process.env.ADMIN_API_TOKEN
    };
    const parsed = envSchema.safeParse(normalized);
    if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.error(parsed.error.flatten().fieldErrors);
        throw new Error("Invalid environment variables");
    }
    return parsed.data;
}
