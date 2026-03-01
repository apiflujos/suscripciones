import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { getEffectiveTenantId } from "../services/tenantContext";
import {
  computeSmartViewIds,
  getSmartViewFields,
  getSmartViewOptions,
  normalizeSmartViewScope,
  normalizeSmartViewType,
  normalizeSmartViewVisibility,
  parseFiltersParam,
  resolveSmartViewIds,
  listSmartViews,
  setSmartViewItems,
  getSmartViewById
} from "../services/smartViews";

export const smartViewsRouter = express.Router();

function readActorEmail(req: any): string | null {
  const raw = String(req.header("x-admin-user-email") || "").trim();
  return raw || null;
}

smartViewsRouter.get("/:scope/fields", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  res.json({ fields: getSmartViewFields(scope) });
});

smartViewsRouter.get("/:scope/options", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const field = String(req.query.field || "").trim();
  if (!field) return res.status(400).json({ error: "missing_field" });
  const tenantId = await getEffectiveTenantId(req);
  const options = await getSmartViewOptions(scope, field, tenantId);
  res.json({ options });
});

smartViewsRouter.get("/:scope", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const actorEmail = readActorEmail(req);
  const items = await listSmartViews(scope, tenantId, actorEmail);
  res.json({ items });
});

smartViewsRouter.get("/:scope/:id", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const actorEmail = readActorEmail(req);
  const view = await getSmartViewById(String(req.params.id || ""), tenantId, actorEmail);
  if (!view || view.scope !== scope) return res.status(404).json({ error: "not_found" });
  res.json({ view });
});

smartViewsRouter.post("/:scope/preview", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const rules = parseFiltersParam(JSON.stringify(req.body?.filters ?? req.body?.rules ?? req.body?.filter ?? null));
  if (!rules) return res.status(400).json({ error: "invalid_filters" });
  const ids = await computeSmartViewIds(scope, tenantId, rules);
  res.json({ ids, count: ids.length });
});

smartViewsRouter.post("/:scope", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const body = req.body || {};
  const schema = z.object({
    name: z.string().min(1),
    visibility: z.string().optional(),
    type: z.string().optional(),
    filters: z.any().optional(),
    staticIds: z.array(z.string()).optional()
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const actorEmail = readActorEmail(req);
  const visibility = normalizeSmartViewVisibility(parsed.data.visibility || "ORG");
  const type = normalizeSmartViewType(parsed.data.type || "DYNAMIC");
  const created = await prisma.smartView.create({
    data: {
      tenantId,
      name: parsed.data.name,
      scope,
      visibility,
      type,
      filters: parsed.data.filters ?? null,
      createdByEmail: actorEmail || null
    }
  });

  if (type === "STATIC") {
    const ids = Array.isArray(parsed.data.staticIds) ? parsed.data.staticIds : [];
    await setSmartViewItems(created.id, ids);
  }

  res.status(201).json({ view: created });
});

smartViewsRouter.put("/:scope/:id", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const actorEmail = readActorEmail(req);
  const view = await getSmartViewById(String(req.params.id || ""), tenantId, actorEmail);
  if (!view || view.scope !== scope) return res.status(404).json({ error: "not_found" });
  if (view.visibility === "PRIVATE" && view.createdByEmail && actorEmail && view.createdByEmail !== actorEmail) {
    return res.status(403).json({ error: "forbidden" });
  }
  const schema = z.object({
    name: z.string().min(1).optional(),
    visibility: z.string().optional(),
    type: z.string().optional(),
    filters: z.any().optional(),
    staticIds: z.array(z.string()).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const visibility = parsed.data.visibility ? normalizeSmartViewVisibility(parsed.data.visibility) : view.visibility;
  const type = parsed.data.type ? normalizeSmartViewType(parsed.data.type) : view.type;
  const updated = await prisma.smartView.update({
    where: { id: view.id },
    data: {
      name: parsed.data.name ?? view.name,
      visibility,
      type,
      filters: parsed.data.filters ?? view.filters
    }
  });
  if (type === "STATIC") {
    const ids = Array.isArray(parsed.data.staticIds) ? parsed.data.staticIds : [];
    await setSmartViewItems(view.id, ids);
  }
  res.json({ view: updated });
});

smartViewsRouter.delete("/:scope/:id", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const actorEmail = readActorEmail(req);
  const view = await getSmartViewById(String(req.params.id || ""), tenantId, actorEmail);
  if (!view || view.scope !== scope) return res.status(404).json({ error: "not_found" });
  if (view.visibility === "PRIVATE" && view.createdByEmail && actorEmail && view.createdByEmail !== actorEmail) {
    return res.status(403).json({ error: "forbidden" });
  }
  await prisma.smartView.delete({ where: { id: view.id } });
  res.json({ ok: true });
});

smartViewsRouter.post("/:scope/resolve", async (req, res) => {
  const scope = normalizeSmartViewScope(String(req.params.scope || ""));
  if (!scope) return res.status(400).json({ error: "invalid_scope" });
  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const actorEmail = readActorEmail(req);
  const { viewId, filters } = req.body || {};
  const parsed = filters ? parseFiltersParam(JSON.stringify(filters)) : null;
  const ids = await resolveSmartViewIds(scope, tenantId, actorEmail, viewId, parsed || undefined);
  if (ids === null) return res.json({ ids: null, count: null });
  res.json({ ids, count: ids.length });
});
