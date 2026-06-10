import { getCivilDateAnchorUtc, getCivilDateKey } from "@suscripciones/core/lib/dates";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import {
  fmtEvery,
  formatPlanTitle,
  getActivo,
  getCollectionStatusLabel,
  getEstado,
  getTipo,
  getTipoPago,
  hasUsablePaymentSource,
  normalizeImageUrl,
  readPlanPricing,
  subscriptionRank,
  templateMatchesProduct,
  templateMatchesTenant
} from "./billingDisplayHelpers";
import type { BillingCardHelpers, BillingRow } from "./billingTypes";

type BuildBillingRowsArgs = {
  subItems: any[];
  productById: Map<string, any>;
  tenantById: Map<string, string>;
  renderNowDate: Date;
  q: string;
  tipo: string;
  estado: string;
  ordenar: string;
};

export function buildBillingRows(args: BuildBillingRowsArgs): BillingRow[] {
  const { subItems, productById, tenantById, renderNowDate, q, tipo, estado, ordenar } = args;

  return subItems
    .map((s) => {
      const plan = s.plan;
      const customer = (s.customer as any) || {};
      const customerMeta = (customer?.metadata ?? {}) as any;
      const collectionMode = String(s?.collectionModeResolved || "").trim().toUpperCase() || resolveSubscriptionCollectionMode({ metadata: s?.metadata, plan });
      const tipoTx = getTipo(collectionMode);
      const activo = getActivo(s.status);
      const estadoInfo = getEstado(s.status);
      const ident =
        customerMeta?.identificacion ||
        customerMeta?.identificationNumber ||
        customerMeta?.documentNumber ||
        customerMeta?.document ||
        "";

      const tenantIds = Array.isArray(s.tenantIds) && s.tenantIds.length ? s.tenantIds : [s.tenantId || plan?.tenantId].filter(Boolean);
      const tenantNameList = tenantIds.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
      const subscriptionPricing = readPlanPricing((s?.metadata as any) ?? {});
      const planPricing = readPlanPricing((plan?.metadata as any) ?? {});
      const resolvedProductId = String((s as any)?.productId || (plan as any)?.catalogProductId || (plan?.metadata as any)?.catalog?.itemId || "");
      const catalogProduct = productById.get(resolvedProductId);
      const totalInCents = Number(subscriptionPricing?.totalInCents || plan?.priceInCents || 0);
      const shippingInCents = Number(subscriptionPricing?.shippingInCents ?? planPricing?.shippingInCents ?? 0);
      const requiresShipping =
        String(catalogProduct?.kind || "PRODUCT").toUpperCase() !== "SERVICE" &&
        (catalogProduct?.requiresShipping !== false);
      const shippingAppliedInCents = requiresShipping ? Math.max(0, shippingInCents) : 0;
      const baseValueInCents = Math.max(0, totalInCents - shippingAppliedInCents);
      const dueAtDate = s.nextBillingDate ? new Date(s.nextBillingDate) : null;
      const currentCollectionDueAtDate = s.currentCollectionDueAt ? new Date(s.currentCollectionDueAt) : dueAtDate;
      const collectionCyclePaid = typeof s?.collectionCyclePaid === "boolean" ? s.collectionCyclePaid : false;
      const graceDays = Number(s.graceDays || 5);
      const paymentCollectionState = getCollectionStatusLabel({
        status: String(s.status || ""),
        dueAt: dueAtDate ? dueAtDate.toISOString() : null,
        graceDays,
        collectionCyclePaid,
        nowDate: renderNowDate
      });
      const inGrace = paymentCollectionState === "En gracia";
      const inArrears = paymentCollectionState === "En mora";
      const daysLate =
        collectionCyclePaid || !dueAtDate || getCivilDateKey(renderNowDate) <= getCivilDateKey(dueAtDate)
          ? 0
          : Math.ceil((getCivilDateAnchorUtc(renderNowDate).getTime() - getCivilDateAnchorUtc(dueAtDate).getTime()) / (24 * 60 * 60 * 1000));

      return {
        id: String(s.id),
        planId: String(plan?.id || ""),
        intervalUnit: String(plan?.intervalUnit || "MONTH"),
        intervalCount: Number(plan?.intervalCount || 1),
        planIntervalUnit: String(plan?.intervalUnit || "MONTH"),
        planIntervalCount: Number(plan?.intervalCount || 1),
        tenantId: String(s.tenantId || plan?.tenantId || ""),
        productId: resolvedProductId,
        productName: String((s as any)?.productName || catalogProduct?.name || formatPlanTitle(plan) || "Producto"),
        tenantIds,
        customerId: String(s.customerId || ""),
        customerName: String(customer?.name || customer?.email || s.customerId || "—"),
        customerEmail: String(customer?.email || ""),
        customerPhone: String(customer?.phone || customerMeta?.phone || customerMeta?.telefono || ""),
        customerTokenized: typeof s?.customerTokenized === "boolean" ? s.customerTokenized : hasUsablePaymentSource(customerMeta),
        customerMetadata: customerMeta || {},
        identificacion: String(ident || "—"),
        tipoTx,
        tipoPago: getTipoPago(collectionMode),
        activo,
        status: String(s.status || "—"),
        estadoInfo,
        planName: formatPlanTitle(plan),
        planImageUrl: normalizeImageUrl((plan?.metadata as any)?.imageUrl || (catalogProduct?.imageUrl ?? "")),
        montoInCents: totalInCents,
        valorBaseInCents: baseValueInCents,
        totalInCents,
        moneda: String(plan?.currency || "COP"),
        cada: fmtEvery(plan?.intervalUnit, plan?.intervalCount),
        pagoAt: s.lastPayment?.paidAt || null,
        pagoTxId: s.lastPayment?.wompiTransactionId || null,
        pagoMonto: s.lastPayment?.amountInCents || null,
        lastPaymentLink: s.lastPaymentLink || null,
        vencimientoAt: dueAtDate ? dueAtDate.toISOString() : null,
        periodoInicioAt: s.activeCycleStartAt || null,
        periodoFinAt: s.activeCycleEndAt || null,
        cycleStartDay: Number(s.cycleStartDay || 1),
        paymentDay: Number(s.paymentDay || 1),
        paymentTiming: String(s.paymentTiming || "EN_CURSO"),
        graceDays: Number(s.graceDays || 5),
        daysLate,
        inGrace,
        inArrears,
        nextRetryAt: s.nextRetryAtEffective || s.nextRetryJob?.runAt || (s.metadata as any)?.manualRetry?.nextRetryAt || (s.metadata as any)?.autoRetry?.nextRetryAt || null,
        nextRetryAtEffective: s.nextRetryAtEffective || null,
        mode: collectionMode,
        autoChargeEnabled: typeof s?.autoChargeEnabled === "boolean" ? s.autoChargeEnabled : undefined,
        retryAutomationEnabled: typeof s?.retryAutomationEnabled === "boolean" ? s.retryAutomationEnabled : undefined,
        currentCollectionDueAt: currentCollectionDueAtDate ? currentCollectionDueAtDate.toISOString() : null,
        canManualCharge: typeof s?.canManualCharge === "boolean" ? s.canManualCharge : undefined,
        canManualMarkPaid: typeof s?.canManualMarkPaid === "boolean" ? s.canManualMarkPaid : undefined,
        canManualUnmarkPaid: typeof s?.canManualUnmarkPaid === "boolean" ? s.canManualUnmarkPaid : undefined,
        manualChargeEnabled: typeof s?.manualChargeEnabled === "boolean" ? s.manualChargeEnabled : undefined,
        manualMarkPaidEnabled: typeof s?.manualMarkPaidEnabled === "boolean" ? s.manualMarkPaidEnabled : undefined,
        chargeDue: typeof s?.chargeDue === "boolean" ? s.chargeDue : undefined,
        lastPaidInCurrentPeriod: typeof s?.lastPaidInCurrentPeriod === "boolean" ? s.lastPaidInCurrentPeriod : false,
        collectionCyclePaid,
        tenantName: tenantNameList.length ? tenantNameList.join(", ") : "—",
        currentShippingInCents: shippingAppliedInCents,
        currentRequiresShipping: requiresShipping
      };
    })
    .filter((row) => {
      if (tipo === "planes" && row.tipoTx !== "Link de pago") return false;
      if (tipo === "suscripciones" && row.tipoTx !== "Débito automático") return false;
      if (estado === "si" && row.estadoInfo.key !== "si") return false;
      if (estado === "no" && row.estadoInfo.key !== "no") return false;
      if (estado === "mora" && row.estadoInfo.key !== "mora") return false;
      if (q) {
        const term = q.toLowerCase();
        const matches =
          row.customerName.toLowerCase().includes(term) ||
          row.customerEmail.toLowerCase().includes(term) ||
          String(row.identificacion || "").toLowerCase().includes(term);
        if (!matches) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (ordenar === "pago") {
        const ad = a.pagoAt ? new Date(a.pagoAt).getTime() : 0;
        const bd = b.pagoAt ? new Date(b.pagoAt).getTime() : 0;
        return bd - ad;
      }
      if (ordenar === "monto") return (b.montoInCents || 0) - (a.montoInCents || 0);
      const ad = a.vencimientoAt ? new Date(a.vencimientoAt).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.vencimientoAt ? new Date(b.vencimientoAt).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
}

type CreateBillingCardHelpersArgs = {
  rows: BillingRow[];
  checkoutTemplates: any[];
  checkoutConfig: Record<string, unknown>;
  planBaseUrl: string;
  subscriptionBaseUrl: string;
  renderNowDate: Date;
  actionSubscriptionId: string;
  checkoutCustomerId: string;
  checkoutUrl: string;
};

export function createBillingCardHelpers(args: CreateBillingCardHelpersArgs): BillingCardHelpers {
  const {
    rows,
    checkoutTemplates,
    checkoutConfig,
    planBaseUrl,
    subscriptionBaseUrl,
    renderNowDate,
    actionSubscriptionId,
    checkoutCustomerId,
    checkoutUrl
  } = args;

  const findCheckoutTemplateForRow = (kind: "PLAN" | "SUBSCRIPTION", row: BillingRow) => {
    const tenantId = String(row?.tenantId || "").trim();
    const productId = String(row?.productId || "").trim();
    const candidates = checkoutTemplates.filter((template: any) => {
      return Boolean(template?.active) && String(template?.kind || "") === kind && templateMatchesTenant(template, tenantId);
    });
    if (productId) {
      const exactTenantMatch =
        candidates.find((template: any) => String(template?.tenantId || "").trim() === tenantId && templateMatchesProduct(template, productId)) || null;
      if (exactTenantMatch) return exactTenantMatch;
      const productMatch = candidates.find((template: any) => templateMatchesProduct(template, productId)) || null;
      if (productMatch) return productMatch;
    }
    const defaultTemplateId =
      kind === "PLAN"
        ? String(checkoutConfig?.defaultPlanTemplateId || "").trim()
        : String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim();
    if (!defaultTemplateId) return null;
    const exactDefault =
      candidates.find((template: any) => String(template?.tenantId || "").trim() === tenantId && String(template?.id || "").trim() === defaultTemplateId) || null;
    if (exactDefault) return exactDefault;
    return candidates.find((template: any) => String(template?.id || "").trim() === defaultTemplateId) || null;
  };

  const getPaymentLinkBlockedReason = (row: BillingRow) => {
    if (!findCheckoutTemplateForRow("PLAN", row)) return "No hay checkout público de link de pago asociado al producto de esta suscripción.";
    if (!planBaseUrl) return "Falta configurar la URL base de link de pago en Checkout público.";
    return "";
  };

  const getTokenizationBlockedReason = (row: BillingRow) => {
    if (!String(row?.productId || "").trim()) return "No hay producto asociado a esta suscripción para generar tokenización.";
    if (!subscriptionBaseUrl) return "Falta configurar la URL base de suscripción en Checkout público.";
    return "";
  };

  const resolveDuplicateKey = (row: BillingRow) => {
    const customerId = String(row?.customerId || "").trim();
    const productOrPlanId = String(row?.productId || row?.planId || "").trim();
    if (!customerId || !productOrPlanId) return "";
    return `${customerId}:${productOrPlanId}`;
  };

  const duplicateCountByKey = rows.reduce((acc, row) => {
    const key = resolveDuplicateKey(row);
    if (!key) return acc;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  const duplicateKeepByKey = rows.reduce((acc, row) => {
    const key = resolveDuplicateKey(row);
    if (!key) return acc;
    const prev = acc.get(key);
    if (!prev) {
      acc.set(key, row);
      return acc;
    }
    const prevRank = subscriptionRank(prev.status);
    const currRank = subscriptionRank(row.status);
    if (currRank < prevRank) {
      acc.set(key, row);
      return acc;
    }
    if (currRank === prevRank) {
      const prevCutoff = prev.vencimientoAt ? new Date(prev.vencimientoAt).getTime() : 0;
      const currCutoff = row.vencimientoAt ? new Date(row.vencimientoAt).getTime() : 0;
      if (currCutoff >= prevCutoff) acc.set(key, row);
    }
    return acc;
  }, new Map<string, BillingRow>());

  const resolveRowTokenUrl = (row: BillingRow, transientUrl = "") => {
    const tokenMeta = (row.customerMetadata?.tokenizationLink as any) || {};
    const tokenMetaUrl = String(tokenMeta?.url || "").trim();
    const tokenMetaUsedAt = tokenMeta?.usedAt ? Date.parse(String(tokenMeta.usedAt)) : NaN;
    const tokenMetaExpiresAt = tokenMeta?.expiresAt ? Date.parse(String(tokenMeta.expiresAt)) : NaN;
    const now = renderNowDate.getTime();
    const tokenMetaValid =
      Boolean(tokenMetaUrl) &&
      !Number.isFinite(tokenMetaUsedAt) &&
      (!Number.isFinite(tokenMetaExpiresAt) || tokenMetaExpiresAt > now);
    return transientUrl || (tokenMetaValid ? tokenMetaUrl : "");
  };

  const matchesTransientSubscription = (row: BillingRow) => {
    if (actionSubscriptionId) return actionSubscriptionId === row.id;
    return Boolean(checkoutCustomerId && checkoutCustomerId === row.customerId);
  };

  const resolveRowCheckoutUrl = (row: BillingRow) => {
    if (!checkoutUrl) return "";
    return matchesTransientSubscription(row) ? checkoutUrl : "";
  };

  return {
    findCheckoutTemplateForRow,
    getPaymentLinkBlockedReason,
    getTokenizationBlockedReason,
    resolveDuplicateKey,
    resolveRowTokenUrl,
    resolveRowCheckoutUrl,
    matchesTransientSubscription,
    duplicateCountByKey,
    duplicateKeepByKey
  };
}
