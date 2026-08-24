"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coerceTenantId = coerceTenantId;
exports.getDefaultTenantId = getDefaultTenantId;
exports.readTenantIdFromReq = readTenantIdFromReq;
exports.readTenantIdsFromReq = readTenantIdsFromReq;
exports.getEffectiveTenantId = getEffectiveTenantId;
exports.getEffectiveTenantIds = getEffectiveTenantIds;
const prisma_1 = require("../db/prisma");
function normalize(v) {
    return String(v || "").trim();
}
function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function coerceTenantId(value) {
    const raw = normalize(value);
    if (!raw || raw.toLowerCase() === "all")
        return null;
    return isUuid(raw) ? raw : null;
}
let cached = null;
const CACHE_TTL_MS = 30_000;
async function getDefaultTenantId() {
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS)
        return cached.tenantId;
    const envId = normalize(process.env.SA_APP_TENANT_ID) ||
        normalize(process.env.SA_TENANT_ID) ||
        normalize(process.env.SUPER_ADMIN_TENANT_ID);
    if (envId && isUuid(envId)) {
        cached = { tenantId: envId, at: now };
        return envId;
    }
    const name = normalize(process.env.SA_DEFAULT_TENANT_NAME) ||
        normalize(process.env.DEFAULT_TENANT_NAME);
    const tenant = name
        ? await prisma_1.prisma.saTenant.findFirst({
            where: { name: { equals: name, mode: "insensitive" } },
        })
        : await prisma_1.prisma.saTenant.findFirst({
            where: { active: true },
            orderBy: { createdAt: "asc" },
        });
    if (!tenant && !name) {
        const anyTenant = await prisma_1.prisma.saTenant.findFirst({ orderBy: { createdAt: "asc" } });
        const anyTenantId = anyTenant?.id || null;
        cached = { tenantId: anyTenantId, at: now };
        return anyTenantId;
    }
    const tenantId = tenant?.id || null;
    cached = { tenantId, at: now };
    return tenantId;
}
function readTenantIdFromReq(req) {
    const raw = normalize(req?.query?.tenantId) ||
        normalize(req?.body?.tenantId) ||
        normalize(req?.header?.("x-tenant-id")) ||
        normalize(req?.headers?.["x-tenant-id"]);
    return coerceTenantId(raw);
}
function readTenantIdsFromReq(req) {
    const rawBody = req?.body?.tenantIds;
    const rawQuery = req?.query?.tenantIds;
    const rawSingle = readTenantIdFromReq(req);
    const out = [];
    const push = (v) => {
        const s = normalize(v);
        if (!s)
            return;
        if (s.toLowerCase() === "all")
            return;
        if (isUuid(s))
            out.push(s);
    };
    if (Array.isArray(rawBody)) {
        for (const v of rawBody)
            push(v);
    }
    else if (typeof rawBody === "string") {
        for (const v of rawBody.split(","))
            push(v);
    }
    if (Array.isArray(rawQuery)) {
        for (const v of rawQuery)
            push(v);
    }
    else if (typeof rawQuery === "string") {
        for (const v of rawQuery.split(","))
            push(v);
    }
    if (rawSingle)
        push(rawSingle);
    return Array.from(new Set(out));
}
async function getEffectiveTenantId(req) {
    const fromReq = readTenantIdFromReq(req);
    if (fromReq)
        return fromReq;
    return await getDefaultTenantId();
}
async function getEffectiveTenantIds(req) {
    const ids = readTenantIdsFromReq(req);
    if (ids.length)
        return ids;
    const fallback = await getDefaultTenantId();
    return fallback ? [fallback] : [];
}
