import { prisma } from "../db/prisma";
import { PaymentStatus, SubscriptionStatus, SmartViewVisibility as DbSmartViewVisibility } from "@prisma/client";

export type SmartViewRule =
  | {
      field: string;
      op:
        | "equals"
        | "contains"
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
        | "within_last"
        | "within_next"
        | "older_than"
        | "newer_than"
        | "exists"
        | "isEmpty";
      value?: any;
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

function getByPath(obj: any, path: string) {
  const parts = path.split(".").filter(Boolean);
  let current = obj as any;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function toComparable(val: any) {
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

function normalizeString(val: any) {
  if (val == null) return "";
  return String(val).toLowerCase();
}

function toDateMs(val: any): number | null {
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

function evalRule(rule: SmartViewRule, ctx: Record<string, any>): boolean {
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

  if (op === "exists") return val != null;
  if (op === "isEmpty") return val == null || String(val).trim() === "";

  const cmpVal = toComparable(val);
  const target = toComparable(rule.value);

  if (op === "equals") return cmpVal === target;
  if (op === "contains") return normalizeString(cmpVal).includes(normalizeString(target));
  if (op === "startsWith") return normalizeString(cmpVal).startsWith(normalizeString(target));
  if (op === "endsWith") return normalizeString(cmpVal).endsWith(normalizeString(target));
  if (op === "in") return Array.isArray(rule.value) && rule.value.map(toComparable).includes(cmpVal as any);
  if (op === "notIn") return Array.isArray(rule.value) && !rule.value.map(toComparable).includes(cmpVal as any);
  if (op === "gt") return (cmpVal as any) > (target as any);
  if (op === "gte") return (cmpVal as any) >= (target as any);
  if (op === "lt") return (cmpVal as any) < (target as any);
  if (op === "lte") return (cmpVal as any) <= (target as any);
  if (op === "before" || op === "after" || op === "between" || op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
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
      const from = toDateMs((rule.value as any)?.from ?? (Array.isArray(rule.value) ? rule.value[0] : null));
      const to = toDateMs((rule.value as any)?.to ?? (Array.isArray(rule.value) ? rule.value[1] : null));
      if (from == null || to == null) return false;
      return valMs >= from && valMs <= to;
    }
    const amount = Number((rule.value as any)?.amount ?? (rule.value as any)?.value ?? 0);
    const unit = String((rule.value as any)?.unit ?? "days");
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
    return [
      { key: "customer.name", label: "Nombre", group: "Datos personales", type: "text", operators: ["equals", "contains", "startsWith", "endsWith", "exists", "isEmpty"] },
      { key: "customer.email", label: "Email", group: "Datos personales", type: "text", operators: ["equals", "contains", "startsWith", "endsWith", "exists", "isEmpty"] },
      { key: "customer.phone", label: "Teléfono", group: "Datos personales", type: "phone", operators: ["equals", "contains", "startsWith", "endsWith", "exists"] },
      { key: "customer.createdAt", label: "Fecha creación", group: "Datos personales", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
      { key: "address.city", label: "Ciudad", group: "Dirección", type: "enum", operators: ["equals", "in", "notIn"], optionsSource: "customer_city" },
      { key: "address.dept", label: "Departamento", group: "Dirección", type: "enum", operators: ["equals", "in", "notIn"], optionsSource: "customer_dept" },
      { key: "address.line1", label: "Dirección", group: "Dirección", type: "text", operators: ["contains", "equals"] },
      { key: "id.type", label: "Tipo identificación", group: "Identificación", type: "enum", operators: ["equals", "in"], optionsSource: "id_type" },
      { key: "id.number", label: "Número identificación", group: "Identificación", type: "text", operators: ["equals", "contains"] },
      { key: "subscription.status", label: "Estado suscripción", group: "Plan/Suscripción", type: "enum", operators: ["equals", "in"], options: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"].map((v) => ({ value: v, label: v })) },
      { key: "plan.name", label: "Plan", group: "Plan/Suscripción", type: "enum", operators: ["equals", "in"], optionsSource: "plan_names" },
      { key: "plan.priceInCents", label: "Precio plan (cents)", group: "Plan/Suscripción", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "plan.intervalUnit", label: "Unidad periodicidad", group: "Plan/Suscripción", type: "enum", operators: ["equals", "in"], options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })) },
      { key: "plan.intervalCount", label: "Cada (intervalo)", group: "Plan/Suscripción", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
      { key: "subscription.nextBillingDate", label: "Próximo pago", group: "Plan/Suscripción", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
      { key: "subscription.daysPastDue", label: "Días en mora", group: "Plan/Suscripción", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
      { key: "subscription.inMora", label: "En mora", group: "Plan/Suscripción", type: "boolean", operators: ["equals"] },
      { key: "payments.lastStatus", label: "Estado último pago", group: "Pagos", type: "enum", operators: ["equals", "in"], options: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"].map((v) => ({ value: v, label: v })) },
      { key: "payments.lastPaidAt", label: "Fecha último pago", group: "Pagos", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
      { key: "payments.approvedCount", label: "Pagos aprobados", group: "Pagos", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
      { key: "payments.totalCount", label: "Pagos totales", group: "Pagos", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] }
    ];
  }

  if (scope === "products") {
    return [
      { key: "product.name", label: "Nombre", group: "Producto", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "product.sku", label: "SKU", group: "Producto", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "product.priceInCents", label: "Precio (cents)", group: "Producto", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "product.currency", label: "Moneda", group: "Producto", type: "enum", operators: ["equals", "in"], options: ["COP"].map((v) => ({ value: v, label: v })) },
      { key: "product.intervalUnit", label: "Unidad periodicidad", group: "Producto", type: "enum", operators: ["equals", "in"], options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })) },
      { key: "product.intervalCount", label: "Cada (intervalo)", group: "Producto", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
      { key: "product.kind", label: "Tipo", group: "Producto", type: "enum", operators: ["equals", "in"], options: ["PRODUCT", "SERVICE"].map((v) => ({ value: v, label: v })) },
      { key: "product.productType", label: "Categoría", group: "Producto", type: "enum", operators: ["equals", "in"], optionsSource: "product_type" },
      { key: "product.vendor", label: "Marca", group: "Producto", type: "enum", operators: ["equals", "in"], optionsSource: "product_vendor" },
      { key: "product.requiresShipping", label: "Requiere envío", group: "Producto", type: "boolean", operators: ["equals"] },
      { key: "product.taxable", label: "Aplica impuestos", group: "Producto", type: "boolean", operators: ["equals"] }
    ];
  }

  if (scope === "billing") {
    return [
      { key: "customer.name", label: "Nombre cliente", group: "Cliente", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "customer.email", label: "Email cliente", group: "Cliente", type: "text", operators: ["equals", "contains"] },
      { key: "customer.phone", label: "Teléfono cliente", group: "Cliente", type: "phone", operators: ["equals", "contains"] },
      { key: "address.city", label: "Ciudad", group: "Cliente", type: "enum", operators: ["equals", "in"], optionsSource: "customer_city" },
      { key: "address.dept", label: "Departamento", group: "Cliente", type: "enum", operators: ["equals", "in"], optionsSource: "customer_dept" },
      { key: "plan.name", label: "Plan", group: "Plan", type: "enum", operators: ["equals", "in"], optionsSource: "plan_names" },
      { key: "plan.priceInCents", label: "Precio plan (cents)", group: "Plan", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "plan.intervalUnit", label: "Unidad periodicidad", group: "Plan", type: "enum", operators: ["equals", "in"], options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })) },
      { key: "plan.intervalCount", label: "Cada (intervalo)", group: "Plan", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
      { key: "subscription.status", label: "Estado suscripción", group: "Suscripción", type: "enum", operators: ["equals", "in"], options: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"].map((v) => ({ value: v, label: v })) },
      { key: "subscription.nextBillingDate", label: "Próximo pago", group: "Suscripción", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
      { key: "subscription.daysPastDue", label: "Días en mora", group: "Suscripción", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
      { key: "payments.lastStatus", label: "Estado último pago", group: "Pago", type: "enum", operators: ["equals", "in"], options: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"].map((v) => ({ value: v, label: v })) },
      { key: "payments.lastPaidAt", label: "Fecha último pago", group: "Pago", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] }
    ];
  }

  if (scope === "logs") {
    return [
      { key: "log.level", label: "Nivel", group: "Log", type: "enum", operators: ["equals", "in"], options: ["INFO", "WARN", "ERROR"].map((v) => ({ value: v, label: v })) },
      { key: "log.source", label: "Fuente", group: "Log", type: "text", operators: ["equals", "contains", "startsWith"] },
      { key: "log.message", label: "Mensaje", group: "Log", type: "text", operators: ["contains"] },
      { key: "log.createdAt", label: "Fecha", group: "Log", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] }
    ];
  }

  if (scope === "payments") {
    return [
      { key: "payment.status", label: "Estado", group: "Pago", type: "enum", operators: ["equals", "in"], options: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"].map((v) => ({ value: v, label: v })) },
      { key: "payment.amountInCents", label: "Monto (cents)", group: "Pago", type: "number", operators: ["equals", "gt", "gte", "lt", "lte", "between"] },
      { key: "payment.createdAt", label: "Fecha creación", group: "Pago", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
      { key: "payment.reference", label: "Referencia", group: "Pago", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "payment.wompiTransactionId", label: "Wompi Tx", group: "Pago", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "payment.wompiPaymentLinkId", label: "Wompi Link", group: "Pago", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "customer.name", label: "Cliente", group: "Cliente", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "customer.email", label: "Email", group: "Cliente", type: "text", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "customer.phone", label: "Teléfono", group: "Cliente", type: "phone", operators: ["equals", "contains", "startsWith", "endsWith"] },
      { key: "plan.name", label: "Plan", group: "Plan", type: "enum", operators: ["equals", "in"], optionsSource: "plan_names" }
    ];
  }

  return [
    { key: "campaign.name", label: "Nombre", group: "Campaña", type: "text", operators: ["equals", "contains"] },
    { key: "campaign.status", label: "Estado", group: "Campaña", type: "enum", operators: ["equals", "in"], options: ["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "FAILED"].map((v) => ({ value: v, label: v })) },
    { key: "campaign.createdAt", label: "Fecha creación", group: "Campaña", type: "date", operators: ["before", "after", "between", "within_last", "within_next", "older_than", "newer_than"] },
    { key: "campaign.sentCount", label: "Enviados", group: "Campaña", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] },
    { key: "campaign.failedCount", label: "Fallidos", group: "Campaña", type: "number", operators: ["equals", "gt", "gte", "lt", "lte"] }
  ];
}

export async function getSmartViewOptions(scope: SmartViewScope, field: string, tenantId: string | null) {
  if (field === "address.city") {
    const rows = await prisma.customer.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      select: { metadata: true }
    });
    const set = new Set<string>();
    rows.forEach((r: any) => {
      const city = r?.metadata?.address?.city || r?.metadata?.city;
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
    rows.forEach((r: any) => {
      const dept = r?.metadata?.address?.dept || r?.metadata?.dept;
      if (dept) set.add(String(dept));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  if (field === "plan.name") {
    const rows = await prisma.subscriptionPlan.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {},
      select: { name: true }
    });
    return rows.map((r: any) => ({ value: String(r.name), label: String(r.name) }));
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
    rows.forEach((r: any) => {
      const v = r?.metadata?.productType;
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
    rows.forEach((r: any) => {
      const v = r?.metadata?.vendor;
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
    rows.forEach((r: any) => {
      const v = r?.metadata?.identificacionTipo;
      if (v) set.add(String(v));
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }

  return [];
}

export async function computeSmartViewIds(scope: SmartViewScope, tenantId: string | null, rules: SmartViewRule) {
  if (scope === "customers") {
    const [customers, approvedCounts, paymentCounts] = await Promise.all([
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
      })
    ]);

    const approvedByCustomer = new Map<string, number>();
    approvedCounts.forEach((row) => approvedByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
    const paymentsByCustomer = new Map<string, number>();
    paymentCounts.forEach((row) => paymentsByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));

    const now = Date.now();

    return customers
      .filter((customer: any) => {
        const sub = customer.subscriptions?.[0] || null;
        const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;
        const approvedCount = approvedByCustomer.get(String(customer.id)) || 0;
        const totalPayments = paymentsByCustomer.get(String(customer.id)) || 0;
        const currentPeriodEndAt = sub?.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
        const daysPastDue =
          currentPeriodEndAt && currentPeriodEndAt.getTime() < now
            ? Math.floor((now - currentPeriodEndAt.getTime()) / 86_400_000)
            : 0;

        const ctx: Record<string, any> = {
          customer: {
            name: customer.name || "",
            email: customer.email || "",
            phone: customer.phone || "",
            createdAt: customer.createdAt
          },
          address: {
            city: customer.metadata?.address?.city || customer.metadata?.city || null,
            dept: customer.metadata?.address?.dept || customer.metadata?.dept || null,
            line1: customer.metadata?.address?.line1 || null
          },
          id: {
            type: customer.metadata?.identificacionTipo || null,
            number: customer.metadata?.identificacionNumero || null
          },
          subscription: {
            status: sub?.status ?? null,
            nextBillingDate: currentPeriodEndAt,
            daysPastDue,
            inMora: sub?.status === SubscriptionStatus.PAST_DUE || daysPastDue > 0
          },
          plan: {
            name: sub?.plan?.name ?? null,
            priceInCents: sub?.plan?.priceInCents ?? null,
            intervalUnit: sub?.plan?.intervalUnit ?? null,
            intervalCount: sub?.plan?.intervalCount ?? null
          },
          payments: {
            lastStatus: latestPayment?.status ?? null,
            lastPaidAt: latestPayment?.paidAt ?? null,
            approvedCount,
            totalCount: totalPayments
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
    return items
      .filter((p: any) => {
        const ctx = {
          product: {
            name: (p.metadata as any)?.displayName || p.name,
            sku: (p.metadata as any)?.sku || "",
            priceInCents: p.priceInCents,
            currency: p.currency,
            intervalUnit: p.intervalUnit,
            intervalCount: p.intervalCount,
            kind: (p.metadata as any)?.itemKind || "PRODUCT",
            productType: (p.metadata as any)?.productType || null,
            vendor: (p.metadata as any)?.vendor || null,
            requiresShipping: (p.metadata as any)?.requiresShipping ?? false,
            taxable: (p.metadata as any)?.taxable ?? true
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
        const ctx = {
          customer: {
            name: s.customer?.name || "",
            email: s.customer?.email || "",
            phone: s.customer?.phone || ""
          },
          address: {
            city: s.customer?.metadata?.address?.city || s.customer?.metadata?.city || null,
            dept: s.customer?.metadata?.address?.dept || s.customer?.metadata?.dept || null
          },
          plan: {
            name: s.plan?.name ?? null,
            priceInCents: s.plan?.priceInCents ?? null,
            intervalUnit: s.plan?.intervalUnit ?? null,
            intervalCount: s.plan?.intervalCount ?? null
          },
          subscription: {
            status: s.status,
            nextBillingDate: currentPeriodEndAt,
            daysPastDue
          },
          payments: {
            lastStatus: s.payments?.[0]?.status ?? null,
            lastPaidAt: s.payments?.[0]?.paidAt ?? null
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
        const ctx = {
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
        const ctx = {
          payment: {
            status: p.status,
            amountInCents: p.amountInCents,
            createdAt: p.createdAt,
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
      const ctx = {
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
