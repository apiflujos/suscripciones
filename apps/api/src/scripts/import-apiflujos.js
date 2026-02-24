#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_BASE = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const ADMIN_TOKEN = String(process.env.ADMIN_API_TOKEN || "").replace(/^Bearer\s+/i, "").trim();
const CSV_PATH = process.env.CSV_PATH || path.resolve(process.cwd(), "Base de datos APIFLUJOS - Sheet1.csv");
const TENANT_NAME = "Mercado de vinos";
const DEFAULT_EMAIL_FOR_MISSING = "mdvgen@gmail.com";

if (!ADMIN_TOKEN) {
  console.error("Missing ADMIN_API_TOKEN");
  process.exit(1);
}

function moneyToCents(raw) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  return Number(digits) * 100;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (ch === "\r") {
        continue;
      } else {
        cur += ch;
      }
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function adminFetch(pathname, init) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      "x-admin-token": ADMIN_TOKEN,
      "content-type": "application/json",
      ...(init && init.headers ? init.headers : {})
    }
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.reason ? `${json?.error || "request_failed"}:${json.reason}` : json?.error || `request_failed_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsv(raw);
  if (!rows.length) throw new Error("csv_empty");

  const dataRows = rows.slice(1);
  const items = [];
  let category = "";
  for (const r of dataRows) {
    const idx = String(r[0] || "").trim();
    const name = String(r[1] || "").trim();
    if (idx && !/^\d+$/.test(idx)) {
      category = idx;
      continue;
    }
    if (!idx || !/^\d+$/.test(idx)) continue;
    items.push({
      categoria: category,
      idx,
      nombre: name,
      identificacion: String(r[2] || "").trim(),
      valor: String(r[3] || "").trim(),
      domicilio: String(r[4] || "").trim(),
      total: String(r[5] || "").trim(),
      plan: String(r[6] || "").trim(),
      direccion: String(r[7] || "").trim(),
      ciudad: String(r[8] || "").trim(),
      celular: String(r[9] || "").trim(),
      correo: String(r[10] || "").trim()
    });
  }

  const tenants = await adminFetch("/admin/tenants", { method: "GET" });
  const tenant = (tenants.items || []).find((t) => String(t.name || "").toLowerCase() === TENANT_NAME.toLowerCase());
  if (!tenant) {
    throw new Error(`tenant_not_found:${TENANT_NAME}`);
  }
  const tenantId = tenant.id;

  const [productsRes, plansRes, subsRes, settingsRes, templatesRes] = await Promise.all([
    adminFetch(`/admin/products?take=2000&tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" }),
    adminFetch(`/admin/plans?take=2000&tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" }),
    adminFetch(`/admin/subscriptions?take=2000&tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" }),
    adminFetch("/admin/settings", { method: "GET" }),
    adminFetch(`/admin/checkout-templates?tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" })
  ]);

  const existingProducts = new Map((productsRes.items || []).map((p) => [String(p.name || ""), p]));
  const existingPlans = new Map((plansRes.items || []).map((p) => [String(p.name || ""), p]));
  const existingSubs = new Set((subsRes.items || []).map((s) => `${s.customerId}:${s.planId}`));

  const checkoutConfig = settingsRes?.checkoutConfig || {};
  const templates = templatesRes.items || [];

  function pickTemplate(kind) {
    const k = kind === "PLAN" ? "PLAN" : "SUBSCRIPTION";
    const active = templates.find((t) => t.kind === k && t.active);
    return active || templates.find((t) => t.kind === k) || null;
  }

  // Build plan variants
  const totalsByPlan = new Map();
  for (const it of items) {
    const total = moneyToCents(it.total);
    if (!total) continue;
    const key = it.plan;
    const set = totalsByPlan.get(key) || new Set();
    set.add(total);
    totalsByPlan.set(key, set);
  }

  function planVariantName(planName, totalCents) {
    const totals = Array.from(totalsByPlan.get(planName) || []).sort((a, b) => a - b);
    if (totals.length <= 1) return planName;
    const min = totals[0];
    if (totalCents > min) {
      return `${planName} (Fuera Medellín)`;
    }
    return planName;
  }

  let createdCustomers = 0;
  let createdProducts = 0;
  let createdPlans = 0;
  let createdSubscriptions = 0;
  let createdLinks = 0;

  for (const it of items) {
    const totalCents = moneyToCents(it.total);
    if (!totalCents) continue;
    const basePlanName = it.plan;
    const variantName = planVariantName(basePlanName, totalCents);
    const isSubscription = basePlanName.toLowerCase().startsWith("suscripción");
    const collectionMode = isSubscription ? "AUTO_DEBIT" : "AUTO_LINK";

    // Ensure product
    let product = existingProducts.get(variantName);
    if (!product) {
      const sku = `MDV-${slugify(variantName)}`.slice(0, 40);
      const created = await adminFetch("/admin/products", {
        method: "POST",
        body: JSON.stringify({
          tenantIds: [tenantId],
          name: variantName,
          sku,
          kind: "SERVICE",
          currency: "COP",
          basePriceInCents: totalCents,
          taxPercent: 0,
          discountType: "NONE",
          discountValueInCents: 0,
          discountPercent: 0,
          taxable: false,
          requiresShipping: false
        })
      });
      product = created.product;
      existingProducts.set(variantName, product);
      createdProducts += 1;
    }

    // Ensure plan
    let plan = existingPlans.get(variantName);
    if (!plan) {
      const created = await adminFetch("/admin/plans", {
        method: "POST",
        body: JSON.stringify({
          tenantIds: [tenantId],
          name: variantName,
          priceInCents: totalCents,
          currency: "COP",
          intervalUnit: "MONTH",
          intervalCount: 1,
          collectionMode,
          metadata: {
            catalog: {
              itemId: product.id,
              sku: product.sku,
              name: product.name,
              kind: product.kind
            }
          }
        })
      });
      plan = created.plan;
      existingPlans.set(variantName, plan);
      createdPlans += 1;
    }

    // Ensure customer
    const email = it.correo || DEFAULT_EMAIL_FOR_MISSING;
    let customer = null;
    // Search by email
    if (email) {
      const customersRes = await adminFetch(`/admin/customers?take=200&tenantId=${encodeURIComponent(tenantId)}&q=${encodeURIComponent(email)}`, { method: "GET" }).catch(() => null);
      const found = (customersRes?.items || []).find((c) => String(c.email || "").toLowerCase() === email.toLowerCase());
      if (found) customer = found;
    }
    if (!customer) {
      const metadata = {
        identificacion: it.identificacion || null,
        identificacionNumero: it.identificacion || null,
        address: {
          line1: it.direccion || null,
          city: it.ciudad || null
        }
      };
      const created = await adminFetch("/admin/customers", {
        method: "POST",
        body: JSON.stringify({
          tenantId,
          name: it.nombre,
          email,
          phone: it.celular,
          metadata
        })
      });
      customer = created.customer;
      createdCustomers += 1;
    }

    const subKey = `${customer.id}:${plan.id}`;
    if (existingSubs.has(subKey)) continue;

    const template = pickTemplate(isSubscription ? "SUBSCRIPTION" : "PLAN");

    const now = new Date().toISOString();
    const subRes = await adminFetch("/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customerId: customer.id,
        planId: plan.id,
        tenantIds: [tenantId],
        createPaymentLink: true,
        metadata: template?.id ? { templateId: String(template.id) } : undefined,
        // Force link now for plans
        ...(collectionMode === "AUTO_LINK" ? { startAt: now, firstPeriodEndAt: now } : {})
      })
    });
    createdSubscriptions += 1;

    const checkoutUrl = String(subRes?.checkoutUrl || "");
    if (checkoutUrl) {
      const base = isSubscription
        ? String(checkoutConfig.subscriptionBaseUrl || "").trim()
        : String(checkoutConfig.planBaseUrl || "").trim();
      const token = crypto.randomBytes(18).toString("hex");
      const baseUrl = base ? `${base.replace(/\/$/, "")}/public/${isSubscription ? "suscripcion" : "plan"}/${token}` : `/public/${isSubscription ? "suscripcion" : "plan"}/${token}`;
      const utm = String(template?.utmParams || "").trim();
      const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\\?+/, "")}` : baseUrl;
      const templateExpiryHours = template?.expiryHours ?? null;
      const configExpiryHours =
        Number.isFinite(Number(checkoutConfig?.tokenExpiryHours)) && Number(checkoutConfig?.tokenExpiryHours) > 0
          ? Math.min(Math.max(Math.trunc(Number(checkoutConfig?.tokenExpiryHours)), 1), 168)
          : null;
      const expiryHours = template
        ? (Number.isFinite(Number(templateExpiryHours)) && Number(templateExpiryHours) > 0
            ? Math.min(Math.max(Math.trunc(Number(templateExpiryHours)), 1), 168)
            : null)
        : configExpiryHours;
      const expiresAt = expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : null;

      const prevMeta = customer?.metadata && typeof customer.metadata === "object" ? customer.metadata : {};
      const nextMeta = {
        ...prevMeta,
        ...(isSubscription
          ? {
              tokenizationLink: {
                url,
                token,
                planId: plan.id,
                kind: "SUBSCRIPTION",
                templateId: template?.id || null,
                utmParams: template?.utmParams || null,
                createdAt: new Date().toISOString(),
                expiresAt,
                usedAt: null
              }
            }
          : {
              paymentLink: {
                url,
                token,
                checkoutUrl,
                planId: plan.id,
                kind: "PLAN",
                templateId: template?.id || null,
                utmParams: template?.utmParams || null,
                createdAt: new Date().toISOString(),
                expiresAt,
                usedAt: null
              }
            })
      };
      await adminFetch(`/admin/customers/${customer.id}`, {
        method: "PUT",
        body: JSON.stringify({ metadata: nextMeta })
      });
      createdLinks += 1;
    }
  }

  console.log("Import finished.");
  console.log({
    createdCustomers,
    createdProducts,
    createdPlans,
    createdSubscriptions,
    createdLinks
  });
}

main().catch((err) => {
  console.error("Import failed:", err?.message || err);
  process.exit(1);
});
