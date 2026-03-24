import { prisma } from "../db/prisma";
import { GamificationEntityType, PaymentStatus, SubscriptionStatus, SmartViewVisibility as DbSmartViewVisibility } from "@prisma/client";
import { formatLevelName } from "./gamification";

export type SmartViewRule =
  | {
      field: string;
      op:
        | "equals"
        | "notEquals"
        | "contains"
        | "notContains"
        | "startsWith"
        | "endsWith"
        | "in"
        | "notIn"
        | "gt"
        | "gte"
        | "lt"
        | "lte"
        | "before"
        | "after"
        | "between"
        | "not_between"
        | "within_last"
        | "within_next"
        | "older_than"
        | "newer_than"
        | "exists"
        | "isEmpty";
      value?: unknown;
    }
  | { op: "and" | "or"; rules: SmartViewRule[] };

export type SmartViewScope = "customers" | "products" | "billing" | "logs" | "payments" | "campaigns";

export type SmartField = {
  key: string;
  label: string;
  group: string;
  type: "text" | "number" | "date" | "boolean" | "enum" | "phone" | "money";
  operators: SmartViewRule["op"][];
  options?: Array<{ value: string; label: string }>;
  optionsSource?: string;
};

const OPS_BY_TYPE: Record<SmartField["type"], SmartViewRule["op"][]> = {
  text: ["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "exists", "isEmpty"],
  phone: ["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "exists", "isEmpty"],
  enum: ["equals", "notEquals", "in", "notIn", "exists", "isEmpty"],
  boolean: ["equals", "notEquals", "exists", "isEmpty"],
  number: ["equals", "notEquals", "gt", "gte", "lt", "lte", "between", "not_between", "exists", "isEmpty"],
  money: ["equals", "notEquals", "gt", "gte", "lt", "lte", "between", "not_between", "exists", "isEmpty"],
  date: ["before", "after", "between", "not_between", "within_last", "within_next", "older_than", "newer_than", "exists", "isEmpty"]
};

function normalizeFieldOps(fields: SmartField[]) {
  return fields.map((f) => ({ ...f, operators: OPS_BY_TYPE[f.type] || f.operators }));
}

export type SmartViewVisibility = "PRIVATE" | "ORG";
export type SmartViewType = "DYNAMIC" | "STATIC";

export function normalizeSmartViewScope(value: string): SmartViewScope | null {
  const v = String(value || "").trim().toLowerCase();
  if (v === "customers") return "customers";
  if (v === "products") return "products";
  if (v === "billing") return "billing";
  if (v === "logs") return "logs";
  if (v === "payments") return "payments";
  if (v === "campaigns") return "campaigns";
  return null;
}

export function normalizeSmartViewVisibility(value: string): SmartViewVisibility {
  const v = String(value || "").trim().toUpperCase();
  return v === "PRIVATE" ? "PRIVATE" : "ORG";
}

export function normalizeSmartViewType(value: string): SmartViewType {
  const v = String(value || "").trim().toUpperCase();
  return v === "STATIC" ? "STATIC" : "DYNAMIC";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getByPath(obj: Record<string, unknown> | null | undefined, path: string) {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toComparable(val: unknown) {
  if (val == null) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const t = Date.parse(val);
    if (!Number.isNaN(t)) return t;
    return val.toLowerCase();
  }
  if (typeof val === "number" || typeof val === "boolean") return val;
  return val;
}

function normalizeString(val: unknown) {
  if (val == null) return "";
  return String(val).toLowerCase();
}

function toDateMs(val: unknown): number | null {
  if (val == null) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string") {
    const t = Date.parse(val);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function durationMs(amount: number, unit: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("sec")) return n * 1000;
  if (u.startsWith("min")) return n * 60 * 1000;
  if (u.startsWith("hour") || u.startsWith("hr")) return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

function toCents(input: unknown): number | null {
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeMoneyRuleValue(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((v) => toCents(v)).filter((v) => typeof v === "number");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const from = toCents(record?.from ?? record?.min ?? record?.start);
    const to = toCents(record?.to ?? record?.max ?? record?.end);
    return {
      ...(typeof from === "number" ? { from } : {}),
      ...(typeof to === "number" ? { to } : {})
    };
  }
  return toCents(value);
}

function evalRule(rule: SmartViewRule, ctx: Record<string, unknown>): boolean {
  if (!rule) return true;
  if ("rules" in rule) {
    const items = Array.isArray(rule.rules) ? rule.rules : [];
    if (rule.op === "or") return items.some((r) => evalRule(r, ctx));
    return items.every((r) => evalRule(r, ctx));
  }

  const field = String(rule.field || "").trim();
  const op = rule.op;
  if (!field) return true;
  const val = getByPath(ctx, field);
  const isMoneyField = field.includes("amountInCents") || field.includes("priceInCents");

  if (op === "exists") return val != null;
  if (op === "isEmpty") return val == null || String(val).trim() === "";

  const ruleValue = isMoneyField ? normalizeMoneyRuleValue(rule.value) : rule.value;
  const cmpVal = toComparable(val);
  const target = toComparable(ruleValue);

  if (op === "equals") return cmpVal === target;
  if (op === "notEquals") return cmpVal !== target;
  if (op === "contains") return normalizeString(cmpVal).includes(normalizeString(target));
  if (op === "notContains") return !normalizeString(cmpVal).includes(normalizeString(target));
  if (op === "startsWith") return normalizeString(cmpVal).startsWith(normalizeString(target));
  if (op === "endsWith") return normalizeString(cmpVal).endsWith(normalizeString(target));
  if (op === "in") return Array.isArray(ruleValue) && ruleValue.map(toComparable).includes(cmpVal as any);
  if (op === "notIn") return Array.isArray(ruleValue) && !ruleValue.map(toComparable).includes(cmpVal as any);
  if (op === "gt") return (cmpVal as any) > (target as any);
  if (op === "gte") return (cmpVal as any) >= (target as any);
  if (op === "lt") return (cmpVal as any) < (target as any);
  if (op === "lte") return (cmpVal as any) <= (target as any);
  if ((op === "between" || op === "not_between") && typeof cmpVal === "number") {
    const ruleRecord = ruleValue as Record<string, unknown>;
    const from = Number(ruleRecord?.from ?? (Array.isArray(ruleValue) ? ruleValue[0] : null));
    const to = Number(ruleRecord?.to ?? (Array.isArray(ruleValue) ? ruleValue[1] : null));
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    const inside = cmpVal >= from && cmpVal <= to;
    return op === "between" ? inside : !inside;
  }
  if (op === "before" || op === "after" || op === "between" || op === "not_between" || op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
    const valMs = toDateMs(val);
    if (valMs == null) return false;
    const now = Date.now();

    if (op === "before") {
      const t = toDateMs(rule.value);
      return t != null ? valMs < t : false;
    }
    if (op === "after") {
      const t = toDateMs(rule.value);
      return t != null ? valMs > t : false;
    }
    if (op === "between") {
      const ruleValueObj = rule.value as Record<string, unknown>;
      const from = toDateMs(ruleValueObj?.from ?? (Array.isArray(rule.value) ? rule.value[0] : null));
      const to = toDateMs(ruleValueObj?.to ?? (Array.isArray(rule.value) ? rule.value[1] : null));
      if (from == null || to == null) return false;
      return valMs >= from && valMs <= to;
    }
    if (op === "not_between") {
      const ruleValueObj = rule.value as Record<string, unknown>;
      const from = toDateMs(ruleValueObj?.from ?? (Array.isArray(rule.value) ? rule.value[0] : null));
      const to = toDateMs(ruleValueObj?.to ?? (Array.isArray(rule.value) ? rule.value[1] : null));
      if (from == null || to == null) return false;
      return !(valMs >= from && valMs <= to);
    }
    const ruleValueObj = rule.value as Record<string, unknown>;
    const amount = Number(ruleValueObj?.amount ?? ruleValueObj?.value ?? 0);
    const unit = String(ruleValueObj?.unit ?? "days");
    const ms = durationMs(amount, unit);
    if (ms <= 0) return false;
    if (op === "within_last") return valMs >= now - ms && valMs <= now;
    if (op === "within_next") return valMs >= now && valMs <= now + ms;
    if (op === "older_than") return valMs <= now - ms;
    if (op === "newer_than") return valMs >= now - ms;
  }
  return false;
}

export function parseFiltersParam(raw?: string): SmartViewRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed as SmartViewRule;
  } catch {
    return null;
  }
}

export async function listSmartViews(scope: SmartViewScope, tenantId: string, actorEmail?: string | null) {
  const visibilityWhere = actorEmail
    ? { OR: [{ visibility: DbSmartViewVisibility.ORG }, { visibility: DbSmartViewVisibility.PRIVATE, createdByEmail: actorEmail }] }
    : { visibility: DbSmartViewVisibility.ORG };
  const items = await prisma.smartView.findMany({
    where: {
      tenantId,
      scope,
      ...visibilityWhere
    },
    orderBy: [{ updatedAt: "desc" }]
  });
  return items;
}

export async function getSmartViewById(id: string, tenantId: string, actorEmail?: string | null) {
  const view = await prisma.smartView.findFirst({
    where: { id, tenantId }
  });
  if (!view) return null;
  if (view.visibility === "PRIVATE" && actorEmail && view.createdByEmail && view.createdByEmail !== actorEmail) return null;
  if (view.visibility === "PRIVATE" && !actorEmail) return null;
  return view;
}

export async function getSmartViewItemIds(viewId: string) {
  const items = await prisma.smartViewItem.findMany({
    where: { smartViewId: viewId },
    select: { itemId: true }
  });
  return items.map((i) => String(i.itemId));
}

export async function setSmartViewItems(viewId: string, ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  await prisma.$transaction([
    prisma.smartViewItem.deleteMany({ where: { smartViewId: viewId } }),
    prisma.smartViewItem.createMany({ data: unique.map((itemId) => ({ smartViewId: viewId, itemId })), skipDuplicates: true }),
    prisma.smartView.update({ where: { id: viewId }, data: { staticCount: unique.length } })
  ]);
  return unique.length;
}

export async function resolveSmartViewIds(scope: SmartViewScope, tenantId: string | null, actorEmail: string | null, viewId?: string, rules?: SmartViewRule | null) {
  if (viewId) {
    if (!tenantId) return [] as string[];
    const view = await getSmartViewById(viewId, tenantId, actorEmail);
    if (!view || view.scope !== scope) return [] as string[];
    if (view.type === "STATIC") return getSmartViewItemIds(view.id);
    const parsedRules = view.filters as SmartViewRule | null;
    if (!parsedRules) return [] as string[];
    return computeSmartViewIds(scope, tenantId, parsedRules);
  }
  if (rules) return computeSmartViewIds(scope, tenantId, rules);
  return null;
}

export function getSmartViewFields(scope: SmartViewScope): SmartField[] {
  if (scope === "customers") {
    return normalizeFieldOps([
      { key: "customer.name", label: "Nombre", group: "Datos personales", type: "text", operators: [] },
      { key: "customer.email", label: "Email", group: "Datos personales", type: "text", operators: [] },
      { key: "customer.phone", label: "Teléfono", group: "Datos personales", type: "phone", operators: [] },
      { key: "customer.id", label: "ID", group: "Sistema", type: "text", operators: [] },
      { key: "customer.createdAt", label: "Fecha creación", group: "Datos personales", type: "date", operators: [] },
      { key: "customer.updatedAt", label: "Fecha actualización", group: "Datos personales", type: "date", operators: [] },
      { key: "address.city", label: "Ciudad", group: "Dirección", type: "enum", operators: ["equals", "in", "notIn"], optionsSource: "customer_city" },
      { key: "address.dept", label: "Departamento", group: "Dirección", type: "enum", operators: ["equals", "in", "notIn"], optionsSource: "customer_dept" },
      { key: "address.line1", label: "Dirección", group: "Dirección", type: "text", operators: ["contains", "equals"] },
      { key: "address.postalCode", label: "Código postal", group: "Dirección", type: "text", operators: [] },
      { key: "id.type", label: "Tipo identificación", group: "Identificación", type: "enum", operators: ["equals", "in"], optionsSource: "id_type" },
      { key: "id.number", label: "Número identificación", group: "Identificación", type: "text", operators: ["equals", "contains"] },
      { key: "subscription.status", label: "Estado suscripción", group: "Suscripción", type: "enum", operators: [], options: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"].map((v) => ({ value: v, label: v })) },
      { key: "subscription.hasActive", label: "Tiene suscripción activa", group: "Suscripción", type: "boolean", operators: [] },
      { key: "subscription.startAt", label: "Fecha inicio suscripción", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.currentPeriodStartAt", label: "Inicio del ciclo", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.currentPeriodEndAt", label: "Fin del ciclo", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.nextBillingDate", label: "Próximo pago", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.daysPastDue", label: "Días en mora", group: "Suscripción", type: "number", operators: [] },
      { key: "subscription.inMora", label: "En mora", group: "Suscripción", type: "boolean", operators: [] },
      { key: "plan.name", label: "Nombre plan", group: "Plan", type: "enum", operators: [], optionsSource: "plan_names" },
      { key: "plan.priceInCents", label: "Precio plan (COP)", group: "Plan", type: "money", operators: [] },
      { key: "plan.currency", label: "Moneda plan", group: "Plan", type: "enum", operators: [], options: ["COP", "USD", "MXN", "PEN", "CLP"].map((v) => ({ value: v, label: v })) },
      { key: "plan.intervalUnit", label: "Unidad periodicidad", group: "Plan", type: "enum", operators: [], options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })) },
      { key: "plan.intervalCount", label: "Cada (intervalo)", group: "Plan", type: "number", operators: [] },
      { key: "plan.collectionMode", label: "Tipo de cobro", group: "Plan", type: "enum", operators: [], options: ["AUTO_LINK", "AUTO_DEBIT"].map((v) => ({ value: v, label: v })) },
      { key: "payments.lastStatus", label: "Estado último pago", group: "Pagos", type: "enum", operators: [], options: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"].map((v) => ({ value: v, label: v })) },
      { key: "payments.lastPaidAt", label: "Fecha último pago", group: "Pagos", type: "date", operators: [] },
      { key: "payments.lastAmountInCents", label: "Monto último pago (COP)", group: "Pagos", type: "money", operators: [] },
      { key: "payments.lastCurrency", label: "Moneda último pago", group: "Pagos", type: "enum", operators: [], options: ["COP", "USD", "MXN", "PEN", "CLP"].map((v) => ({ value: v, label: v })) },
      { key: "payments.totalCount", label: "Pagos totales", group: "Pagos", type: "number", operators: [] },
      { key: "payments.approvedCount", label: "Pagos aprobados", group: "Pagos", type: "number", operators: [] },
      { key: "gamification.level", label: "Nivel gamificación (1-10)", group: "Gamificación", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "gamification.levelName", label: "Nivel gamificación (nombre)", group: "Gamificación", type: "enum", operators: ["equals", "in"], options: ["Rookie", "Explorador", "Bronce", "Plata", "Oro", "Platino", "Diamante", "Elite", "Maestro", "Leyenda"].map((v) => ({ value: v, label: v })) },
      { key: "gamification.statusScore", label: "Score gamificación", group: "Gamificación", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "gamification.lifetimePoints", label: "Puntos históricos", group: "Gamificación", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] }
    ]);
  }

  if (scope === "products") {
    return normalizeFieldOps([
      { key: "product.name", label: "Nombre", group: "Producto", type: "text", operators: [] },
      { key: "product.sku", label: "SKU", group: "Producto", type: "text", operators: [] },
      { key: "product.kind", label: "Tipo", group: "Producto", type: "enum", operators: [], options: ["PRODUCT", "SERVICE"].map((v) => ({ value: v, label: v })) },
      { key: "product.productType", label: "Categoría", group: "Producto", type: "enum", operators: [], optionsSource: "product_type" },
      { key: "product.vendor", label: "Marca", group: "Producto", type: "enum", operators: [], optionsSource: "product_vendor" },
      { key: "product.priceInCents", label: "Precio (COP)", group: "Producto", type: "money", operators: [] },
      { key: "product.currency", label: "Moneda", group: "Producto", type: "enum", operators: [], options: ["COP", "USD", "MXN", "PEN", "CLP"].map((v) => ({ value: v, label: v })) },
      { key: "product.intervalUnit", label: "Unidad periodicidad", group: "Periodicidad", type: "enum", operators: [], options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })) },
      { key: "product.intervalCount", label: "Cada (intervalo)", group: "Periodicidad", type: "number", operators: [] },
      { key: "product.requiresShipping", label: "Requiere envío", group: "Producto", type: "boolean", operators: [] },
      { key: "product.taxable", label: "Aplica impuestos", group: "Producto", type: "boolean", operators: [] },
      { key: "product.createdAt", label: "Fecha creación", group: "Producto", type: "date", operators: [] },
      { key: "product.updatedAt", label: "Fecha actualización", group: "Producto", type: "date", operators: [] },
      { key: "gamification.level", label: "Nivel gamificación (1-10)", group: "Gamificación", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "gamification.levelName", label: "Nivel gamificación (nombre)", group: "Gamificación", type: "enum", operators: ["equals", "in"], options: ["Rookie", "Explorador", "Bronce", "Plata", "Oro", "Platino", "Diamante", "Elite", "Maestro", "Leyenda"].map((v) => ({ value: v, label: v })) },
      { key: "gamification.statusScore", label: "Score gamificación", group: "Gamificación", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "gamification.lifetimePoints", label: "Puntos históricos", group: "Gamificación", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] }
    ]);
  }

  if (scope === "billing") {
    return normalizeFieldOps([
      { key: "customer.name", label: "Nombre cliente", group: "Cliente", type: "text", operators: [] },
      { key: "customer.email", label: "Email cliente", group: "Cliente", type: "text", operators: [] },
      { key: "customer.phone", label: "Teléfono cliente", group: "Cliente", type: "phone", operators: [] },
      { key: "address.city", label: "Ciudad", group: "Cliente", type: "enum", operators: ["equals", "in"], optionsSource: "customer_city" },
      { key: "address.dept", label: "Departamento", group: "Cliente", type: "enum", operators: ["equals", "in"], optionsSource: "customer_dept" },
      { key: "plan.name", label: "Nombre plan", group: "Plan", type: "enum", operators: [], optionsSource: "plan_names" },
      { key: "plan.collectionMode", label: "Tipo de cobro", group: "Plan", type: "enum", operators: [], options: ["AUTO_DEBIT", "AUTO_LINK"].map((v) => ({ value: v, label: v })) },
      { key: "plan.priceInCents", label: "Precio plan (COP)", group: "Plan", type: "money", operators: [] },
      { key: "plan.currency", label: "Moneda plan", group: "Plan", type: "enum", operators: [], options: ["COP", "USD", "MXN", "PEN", "CLP"].map((v) => ({ value: v, label: v })) },
      { key: "plan.intervalUnit", label: "Unidad periodicidad", group: "Plan", type: "enum", operators: [], options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })) },
      { key: "plan.intervalCount", label: "Cada (intervalo)", group: "Plan", type: "number", operators: [] },
      { key: "subscription.status", label: "Estado suscripción", group: "Suscripción", type: "enum", operators: [], options: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"].map((v) => ({ value: v, label: v })) },
      { key: "subscription.inMora", label: "En mora", group: "Suscripción", type: "boolean", operators: [] },
      { key: "subscription.startAt", label: "Fecha inicio", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.currentPeriodStartAt", label: "Inicio del ciclo", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.currentPeriodEndAt", label: "Fin del ciclo", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.nextBillingDate", label: "Próximo pago", group: "Suscripción", type: "date", operators: [] },
      { key: "subscription.daysPastDue", label: "Días en mora", group: "Suscripción", type: "number", operators: [] },
      { key: "subscription.currentCycle", label: "Ciclo actual", group: "Suscripción", type: "number", operators: [] },
      { key: "payments.lastStatus", label: "Estado último pago", group: "Pago", type: "enum", operators: [], options: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"].map((v) => ({ value: v, label: v })) },
      { key: "payments.lastPaidAt", label: "Fecha último pago", group: "Pago", type: "date", operators: [] },
      { key: "payments.lastAmountInCents", label: "Monto último pago (COP)", group: "Pago", type: "money", operators: [] },
      { key: "payments.lastCurrency", label: "Moneda último pago", group: "Pago", type: "enum", operators: [], options: ["COP", "USD", "MXN", "PEN", "CLP"].map((v) => ({ value: v, label: v })) }
    ]);
  }

  if (scope === "logs") {
    return normalizeFieldOps([
      { key: "log.level", label: "Nivel", group: "Log", type: "enum", operators: ["equals", "in"], options: ["INFO", "WARN", "ERROR"].map((v) => ({ value: v, label: v })) },
      { key: "log.source", label: "Fuente", group: "Log", type: "text", operators: ["equals", "contains", "startsWith"] },
      { key: "log.message", label: "Mensaje", group: "Log", type: "text", operators: ["contains"] },
      { key: "log.createdAt", label: "Fecha", group: "Log", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] }
    ]);
  }

  if (scope === "payments") {
    return normalizeFieldOps([
      { key: "payment.status", label: "Estado", group: "Pago", type: "enum", operators: [], options: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"].map((v) => ({ value: v, label: v })) },
      { key: "payment.amountInCents", label: "Monto (COP)", group: "Pago", type: "money", operators: [] },
      { key: "payment.currency", label: "Moneda", group: "Pago", type: "enum", operators: [], options: ["COP", "USD", "MXN", "PEN", "CLP"].map((v) => ({ value: v, label: v })) },
      { key: "payment.createdAt", label: "Fecha creación", group: "Pago", type: "date", operators: [] },
      { key: "payment.paidAt", label: "Fecha pago", group: "Pago", type: "date", operators: [] },
      { key: "payment.reference", label: "Referencia", group: "Pago", type: "text", operators: [] },
      { key: "payment.wompiTransactionId", label: "Wompi Tx", group: "Pago", type: "text", operators: [] },
      { key: "payment.wompiPaymentLinkId", label: "Wompi Link", group: "Pago", type: "text", operators: [] },
      { key: "customer.name", label: "Cliente", group: "Cliente", type: "text", operators: [] },
      { key: "customer.email", label: "Email", group: "Cliente", type: "text", operators: [] },
      { key: "customer.phone", label: "Teléfono", group: "Cliente", type: "phone", operators: [] },
      { key: "plan.name", label: "Plan", group: "Plan", type: "enum", operators: [], optionsSource: "plan_names" },
      { key: "subscription.status", label: "Estado suscripción", group: "Suscripción", type: "enum", operators: [], options: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"].map((v) => ({ value: v, label: v })) }
    ]);
  }

  return normalizeFieldOps([
    { key: "campaign.name", label: "Nombre", group: "Campaña", type: "text", operators: ["equals", "contains"] },
    { key: "campaign.status", label: "Estado", group: "Campaña", type: "enum", operators: ["equals", "in"], options: ["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "FAILED"].map((v) => ({ value: v, label: v })) },
    { key: "campaign.createdAt", label: "Fecha creación", group: "Campaña", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
    { key: "campaign.sentCount", label: "Enviados", group: "Campaña", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
    { key: "campaign.failedCount", label: "Fallidos", group: "Campaña", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] }
  ]);
}

export async function getSmartViewOptions(scope: SmartViewScope, field: string, tenantId: string | null) {
  if (field === "address.city") {
    const rows = await prisma.customer.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      select: { metadata: true }
    });
    const set = new Set<string>();
    rows.forEach((r) => {
      const meta = asRecord(r.metadata);
      const address = asRecord(meta.address);
      const city = (address.city as string) || (meta.city as string);
      if (city) set.add(String(city));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  if (field === "address.dept") {
    const rows = await prisma.customer.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      select: { metadata: true }
    });
    const set = new Set<string>();
    rows.forEach((r) => {
      const meta = asRecord(r.metadata);
      const address = asRecord(meta.address);
      const dept = (address.dept as string) || (meta.dept as string);
      if (dept) set.add(String(dept));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  if (field === "plan.name") {
    const rows = await prisma.subscriptionPlan.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      select: { name: true }
    });
    return rows.map((r) => ({ value: String(r.name), label: String(r.name) }));
  }

  if (field === "product.productType") {
    const rows = await prisma.subscriptionPlan.findMany({
      where: {
        metadata: { path: ["kind"], equals: "CATALOG_ITEM" } as any,
        ...(tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {})
      },
      select: { metadata: true }
    });
    const set = new Set<string>();
    rows.forEach((r) => {
      const meta = asRecord(r.metadata);
      const v = meta.productType;
      if (v) set.add(String(v));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  if (field === "product.vendor") {
    const rows = await prisma.subscriptionPlan.findMany({
      where: {
        metadata: { path: ["kind"], equals: "CATALOG_ITEM" } as any,
        ...(tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {})
      },
      select: { metadata: true }
    });
    const set = new Set<string>();
    rows.forEach((r) => {
      const meta = asRecord(r.metadata);
      const v = meta.vendor;
      if (v) set.add(String(v));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  if (field === "id.type") {
    const rows = await prisma.customer.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      select: { metadata: true }
    });
    const set = new Set<string>();
    rows.forEach((r) => {
      const meta = asRecord(r.metadata);
      const v = meta.identificacionTipo;
      if (v) set.add(String(v));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  return [];
}

export async function computeSmartViewIds(scope: SmartViewScope, tenantId: string | null, rules: SmartViewRule) {
  if (scope === "customers") {
    const [customers, approvedCounts, paymentCounts, gamificationScores] = await Promise.all([
      prisma.customer.findMany({
        where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
        include: {
          subscriptions: {
            include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
            orderBy: { createdAt: "desc" }
          },
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          tenantLinks: true
        }
      }),
      prisma.payment.groupBy({
        by: ["customerId"],
        where: { status: PaymentStatus.APPROVED },
        _count: { _all: true }
      }),
      prisma.payment.groupBy({
        by: ["customerId"],
        _count: { _all: true }
      }),
      prisma.gamificationScore.findMany({
        where: {
          entityType: GamificationEntityType.CUSTOMER,
          ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId: null })
        }
      })
    ]);

    const approvedByCustomer = new Map<string, number>();
    approvedCounts.forEach((row) => approvedByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
    const paymentsByCustomer = new Map<string, number>();
    paymentCounts.forEach((row) => paymentsByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
    const gamificationByKey = new Map<string, { level?: number | null; statusScore?: number | null; lifetimePoints?: number | null }>();
    gamificationScores.forEach((row) => {
      const key = `${row.tenantId || "global"}:${row.entityId}`;
      gamificationByKey.set(key, row);
    });

    const now = Date.now();

    return customers
      .filter((customer: any) => {
        const sub = customer.subscriptions?.[0] || null;
        const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;
        const approvedCount = approvedByCustomer.get(String(customer.id)) || 0;
        const totalPayments = paymentsByCustomer.get(String(customer.id)) || 0;
        const currentPeriodEndAt = sub?.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
        const currentPeriodStartAt = sub?.currentPeriodStartAt ? new Date(sub.currentPeriodStartAt) : null;
        const daysPastDue =
          currentPeriodEndAt && currentPeriodEndAt.getTime() < now
            ? Math.floor((now - currentPeriodEndAt.getTime()) / 86_400_000)
            : 0;

        const planMeta = asRecord(sub?.plan?.metadata);
        const collectionMode = (planMeta.collectionMode as string) || null;

        const gKey = tenantId ? `${tenantId}:${customer.id}` : `global:${customer.id}`;
        const gFallbackKey = `global:${customer.id}`;
        const gamification = gamificationByKey.get(gKey) || gamificationByKey.get(gFallbackKey) || null;
        const gamificationLevel = Number(gamification?.level || 1);
        const gamificationLevelName = formatLevelName(gamificationLevel);

        const customerMeta = asRecord(customer.metadata);
        const addressMeta = asRecord(customerMeta.address);
        const ctx: Record<string, unknown> = {
          customer: {
            name: customer.name || "",
            email: customer.email || "",
            phone: customer.phone || "",
            id: customer.id,
            createdAt: customer.createdAt,
            updatedAt: customer.updatedAt
          },
          address: {
            city: (addressMeta.city as string) || (customerMeta.city as string) || null,
            dept: (addressMeta.dept as string) || (customerMeta.dept as string) || null,
            line1: (addressMeta.line1 as string) || null,
            postalCode: (addressMeta.code5 as string) || (addressMeta.postalCode as string) || (customerMeta.postalCode as string) || null
          },
          id: {
            type: (customerMeta.identificacionTipo as string) || null,
            number: (customerMeta.identificacionNumero as string) || null
          },
          subscription: {
            status: sub?.status ?? null,
            hasActive: sub?.status === SubscriptionStatus.ACTIVE,
            startAt: sub?.startAt ?? null,
            currentPeriodStartAt,
            currentPeriodEndAt,
            currentCycle: sub?.currentCycle ?? null,
            nextBillingDate: currentPeriodEndAt,
            daysPastDue,
            inMora: sub?.status === SubscriptionStatus.PAST_DUE || daysPastDue > 0
          },
          plan: {
            name: sub?.plan?.name ?? null,
            priceInCents: sub?.plan?.priceInCents ?? null,
            currency: sub?.plan?.currency ?? null,
            intervalUnit: sub?.plan?.intervalUnit ?? null,
            intervalCount: sub?.plan?.intervalCount ?? null,
            collectionMode
          },
          payments: {
            lastStatus: latestPayment?.status ?? null,
            lastPaidAt: latestPayment?.paidAt ?? null,
            lastAmountInCents: latestPayment?.amountInCents ?? null,
            lastCurrency: latestPayment?.currency ?? null,
            approvedCount,
            totalCount: totalPayments
          },
          gamification: {
            level: gamificationLevel,
            levelName: gamificationLevelName,
            statusScore: Number(gamification?.statusScore || 0),
            lifetimePoints: Number(gamification?.lifetimePoints || 0)
          }
        };
        return evalRule(rules, ctx);
      })
      .map((c: any) => String(c.id));
  }

  if (scope === "products") {
    const items = await prisma.subscriptionPlan.findMany({
      where: {
        metadata: { path: ["kind"], equals: "CATALOG_ITEM" } as any,
        ...(tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {})
      }
    });
    const gamificationScores = await prisma.gamificationScore.findMany({
      where: {
        entityType: GamificationEntityType.PRODUCT,
        ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId: null })
      }
    });
    const gamificationByKey = new Map<string, { level?: number | null; statusScore?: number | null; lifetimePoints?: number | null }>();
    gamificationScores.forEach((row) => {
      const key = `${row.tenantId || "global"}:${row.entityId}`;
      gamificationByKey.set(key, row);
    });
    return items
      .filter((p: any) => {
        const gKey = tenantId ? `${tenantId}:${p.id}` : `global:${p.id}`;
        const gFallbackKey = `global:${p.id}`;
        const gamification = gamificationByKey.get(gKey) || gamificationByKey.get(gFallbackKey) || null;
        const gamificationLevel = Number(gamification?.level || 1);
        const gamificationLevelName = formatLevelName(gamificationLevel);
        const productMeta = asRecord(p.metadata);
        const displayName = typeof productMeta.displayName === "string" ? productMeta.displayName : "";
        const sku = typeof productMeta.sku === "string" ? productMeta.sku : "";
        const itemKind = typeof productMeta.itemKind === "string" && productMeta.itemKind.trim() ? productMeta.itemKind : "PRODUCT";
        const productType = typeof productMeta.productType === "string" ? productMeta.productType : null;
        const vendor = typeof productMeta.vendor === "string" ? productMeta.vendor : null;
        const requiresShipping = typeof productMeta.requiresShipping === "boolean" ? productMeta.requiresShipping : false;
        const taxable = typeof productMeta.taxable === "boolean" ? productMeta.taxable : true;
        const ctx = {
          product: {
            name: displayName || p.name,
            sku,
            priceInCents: p.priceInCents,
            currency: p.currency,
            intervalUnit: p.intervalUnit,
            intervalCount: p.intervalCount,
            kind: itemKind,
            productType,
            vendor,
            requiresShipping,
            taxable,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
          },
          gamification: {
            level: gamificationLevel,
            levelName: gamificationLevelName,
            statusScore: Number(gamification?.statusScore || 0),
            lifetimePoints: Number(gamification?.lifetimePoints || 0)
          }
        };
        return evalRule(rules, ctx);
      })
      .map((p: any) => String(p.id));
  }

  if (scope === "billing") {
    const items = await prisma.subscription.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      include: { plan: true, customer: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    const now = Date.now();
    return items
      .filter((s: any) => {
        const currentPeriodEndAt = s.currentPeriodEndAt ? new Date(s.currentPeriodEndAt) : null;
        const daysPastDue =
          currentPeriodEndAt && currentPeriodEndAt.getTime() < now
            ? Math.floor((now - currentPeriodEndAt.getTime()) / 86_400_000)
            : 0;
        const planMeta = asRecord(s.plan?.metadata);
        const collectionMode = (planMeta.collectionMode as string) || null;
        const customerMeta = asRecord(s.customer?.metadata);
        const addressMeta = asRecord(customerMeta.address);
        const ctx: Record<string, unknown> = {
          customer: {
            name: s.customer?.name || "",
            email: s.customer?.email || "",
            phone: s.customer?.phone || ""
          },
          address: {
            city: (addressMeta.city as string) || (customerMeta.city as string) || null,
            dept: (addressMeta.dept as string) || (customerMeta.dept as string) || null
          },
          plan: {
            name: s.plan?.name ?? null,
            collectionMode,
            priceInCents: s.plan?.priceInCents ?? null,
            currency: s.plan?.currency ?? null,
            intervalUnit: s.plan?.intervalUnit ?? null,
            intervalCount: s.plan?.intervalCount ?? null
          },
          subscription: {
            status: s.status,
            startAt: s.startAt ?? null,
            currentPeriodStartAt: s.currentPeriodStartAt ?? null,
            currentPeriodEndAt: s.currentPeriodEndAt ?? null,
            currentCycle: s.currentCycle ?? null,
            nextBillingDate: currentPeriodEndAt,
            daysPastDue,
            inMora: s.status === SubscriptionStatus.PAST_DUE || daysPastDue > 0
          },
          payments: {
            lastStatus: s.payments?.[0]?.status ?? null,
            lastPaidAt: s.payments?.[0]?.paidAt ?? null,
            lastAmountInCents: s.payments?.[0]?.amountInCents ?? null,
            lastCurrency: s.payments?.[0]?.currency ?? null
          }
        };
        return evalRule(rules, ctx);
      })
      .map((s: any) => String(s.id));
  }

  if (scope === "logs") {
    const items = await prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 2000 });
    return items
      .filter((l: any) => {
        const ctx: Record<string, unknown> = {
          log: {
            level: l.level,
            source: l.source,
            message: l.message,
            createdAt: l.createdAt
          }
        };
        return evalRule(rules, ctx);
      })
      .map((l: any) => String(l.id));
  }

  if (scope === "payments") {
    const items = await prisma.payment.findMany({
      where: tenantId ? { tenantId } : {},
      include: { customer: true, subscription: { include: { plan: true } } }
    });
    return items
      .filter((p: any) => {
        const ctx: Record<string, unknown> = {
          payment: {
            status: p.status,
            amountInCents: p.amountInCents,
            createdAt: p.createdAt,
            paidAt: p.paidAt,
            currency: p.currency,
            reference: p.reference,
            wompiTransactionId: p.wompiTransactionId,
            wompiPaymentLinkId: p.wompiPaymentLinkId
          },
          customer: {
            name: p.customer?.name || "",
            email: p.customer?.email || "",
            phone: p.customer?.phone || ""
          },
          plan: {
            name: p.subscription?.plan?.name || null
          },
          subscription: {
            status: p.subscription?.status ?? null
          }
        };
        return evalRule(rules, ctx);
      })
      .map((p: any) => String(p.id));
  }

  const items = await prisma.campaign.findMany({
    where: tenantId ? { tenantId } : {},
    orderBy: { createdAt: "desc" }
  });
  return items
    .filter((c: any) => {
      const ctx: Record<string, unknown> = {
        campaign: {
          name: c.name,
          status: c.status,
          createdAt: c.createdAt,
          sentCount: c.sentCount,
          failedCount: c.failedCount
        }
      };
      return evalRule(rules, ctx);
    })
    .map((c: any) => String(c.id));
}
