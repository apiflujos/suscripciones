import "server-only";

import { prisma } from "@suscripciones/database";
import { getSystemSmartList, getSystemSmartLists } from "@suscripciones/core/services/systemSmartLists";
import { computeSmartListRecipients } from "@suscripciones/core/services/smartList";
import { syncSmartListById } from "@suscripciones/core/services/smartListSync";
import { matchesTenant, parseRules, slugifyLabel } from "../comms/_lib";

export async function listSmartListMembers(args: {
  id: string;
  take?: number;
  skip?: number;
  active?: boolean;
  tenantId?: string | null;
}) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" as const };

  const takeRaw = Number(args.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const active = args.active;
  const tenantId = String(args.tenantId || "").trim();

  const systemList = getSystemSmartList(id);
  if (systemList) {
    if (active === false) return { ok: true, items: [], total: 0 };
    const recipients = await computeSmartListRecipients(systemList.rules as any);
    const filtered = tenantId ? recipients.filter((c: any) => matchesTenant(c, tenantId)) : recipients;
    const slice = filtered.slice(skip, skip + take);
    return {
      ok: true,
      items: slice.map((c: any) => ({
        id: `system-${c.id}`,
        active: true,
        lastSeenAt: null,
        customer: {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone
        }
      })),
      total: filtered.length
    };
  }

  const list = await prisma.smartList.findUnique({ where: { id } });
  if (!list) return { ok: false, status: 404, error: "not_found" as const };

  const where: any = { smartListId: id };
  if (active !== undefined) where.active = active;
  if (tenantId) {
    where.customer = {
      OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }]
    };
  }

  const [total, items] = await Promise.all([
    prisma.smartListMember.count({ where }),
    prisma.smartListMember.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      skip,
      include: { customer: { include: { tenantLinks: true } } }
    })
  ]);

  return {
    ok: true,
    items: items.map((m: any) => ({
      id: m.id,
      active: m.active,
      lastSeenAt: m.lastSeenAt,
      customer: {
        id: m.customer.id,
        name: m.customer.name,
        email: m.customer.email,
        phone: m.customer.phone
      }
    })),
    total
  };
}

export async function listSmartLists(args: { tenantId?: string | null; take?: number; skip?: number }) {
  const takeRaw = Number(args.take ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const tenantId = args.tenantId ? String(args.tenantId).trim() : "";
  const where = tenantId ? { tenantId } : {};
  const [items, totalDb] = await Promise.all([
    prisma.smartList.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.smartList.count({ where })
  ]);
  const systemLists = getSystemSmartLists().map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    category: list.category,
    system: true
  }));
  return { ok: true as const, items: [...systemLists, ...items], total: totalDb + systemLists.length };
}

export async function createSmartList(args: {
  tenantId?: string | null;
  name: string;
  description?: string | null;
  enabled?: boolean;
  rules: any;
}) {
  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) return { ok: false as const, status: 400, error: "tenant_required" as const };
  const name = String(args.name || "").trim();
  if (!name) return { ok: false as const, status: 400, error: "invalid_name" as const };

  const rules = parseRules(args.rules);
  const chatwootLabel = slugifyLabel(name);

  const created = await prisma.smartList.create({
    data: {
      tenant: { connect: { id: tenantId } },
      name,
      description: args.description ?? undefined,
      enabled: args.enabled ?? true,
      rules: rules as any,
      chatwootLabel
    }
  });
  return { ok: true as const, smartList: created };
}

export async function getSmartListById(args: { id: string; tenantId?: string | null }) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false as const, status: 400, error: "invalid_id" as const };
  const systemList = getSystemSmartList(id);
  if (systemList) {
    return {
      ok: true as const,
      smartList: {
        id: systemList.id,
        name: systemList.name,
        description: systemList.description,
        category: systemList.category,
        system: true,
        rules: systemList.rules
      }
    };
  }
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return { ok: false as const, status: 404, error: "not_found" as const };
  const tenantId = args.tenantId ? String(args.tenantId).trim() : "";
  if (tenantId && String(smartList.tenantId) !== tenantId) return { ok: false as const, status: 404, error: "not_found" as const };
  return { ok: true as const, smartList };
}

export async function updateSmartList(args: {
  id: string;
  tenantId?: string | null;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  rules?: any;
}) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false as const, status: 400, error: "invalid_id" as const };
  if (getSystemSmartList(id)) return { ok: false as const, status: 400, error: "system_list_readonly" as const };

  const existing = await prisma.smartList.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, status: 404, error: "not_found" as const };
  const tenantId = args.tenantId ? String(args.tenantId).trim() : "";
  if (tenantId && String(existing.tenantId) !== tenantId) return { ok: false as const, status: 404, error: "not_found" as const };

  const rules = args.rules != null ? parseRules(args.rules) : undefined;
  const nextLabel = args.name ? slugifyLabel(args.name) : undefined;

  const updated = await prisma.smartList.update({
    where: { id },
    data: {
      name: args.name,
      description: args.description,
      enabled: args.enabled,
      rules: rules ? (rules as any) : undefined,
      chatwootLabel: nextLabel
    }
  });
  return { ok: true as const, smartList: updated };
}

export async function deleteSmartList(args: { id: string; tenantId?: string | null }) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false as const, status: 400, error: "invalid_id" as const };
  if (getSystemSmartList(id)) return { ok: false as const, status: 400, error: "system_list_readonly" as const };
  const existing = await prisma.smartList.findUnique({ where: { id } });
  if (!existing) return { ok: true as const };
  const tenantId = args.tenantId ? String(args.tenantId).trim() : "";
  if (tenantId && String(existing.tenantId) !== tenantId) return { ok: false as const, status: 404, error: "not_found" as const };
  await prisma.smartList.delete({ where: { id } }).catch(() => null);
  return { ok: true as const };
}

export async function syncSmartList(args: { id: string }) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false as const, status: 400, error: "invalid_id" as const };
  if (getSystemSmartList(id)) return { ok: false as const, status: 400, error: "system_list_readonly" as const };
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return { ok: false as const, status: 404, error: "not_found" as const };

  const out = await syncSmartListById(id).catch((err: any) => {
    return { ok: false, error: err?.message || "sync_failed" } as any;
  });
  if (!out || out.ok === false) {
    return { ok: false as const, status: 400, error: (out as any)?.error || "sync_failed" } as const;
  }
  return { ok: true as const, added: out.added, removed: out.removed, label: smartList.chatwootLabel };
}

export async function previewSmartList(args: { id: string; tenantId?: string | null }) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false as const, status: 400, error: "invalid_id" as const };
  const tenantId = String(args.tenantId || "").trim();
  const systemList = getSystemSmartList(id);
  const resolveRecipients = async (rules: any) => {
    const recipients = await computeSmartListRecipients(rules as any);
    const filtered = tenantId ? recipients.filter((c: any) => matchesTenant(c, tenantId)) : recipients;
    const sample = filtered.slice(0, 20).map((c: any) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }));
    return { count: filtered.length, sample };
  };
  if (systemList) {
    const out = await resolveRecipients(systemList.rules);
    return { ok: true as const, ...out };
  }
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return { ok: false as const, status: 404, error: "not_found" as const };
  const out = await resolveRecipients(smartList.rules);
  return { ok: true as const, ...out };
}
