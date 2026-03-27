import { NextResponse } from "next/server";
import { prisma } from "@suscripciones/database";
import { listChatwootMessages } from "../../admin/_services/logs";
import { requireApiSession } from "../_lib/requireApiSession";

function escapeCsv(value: unknown) {
  const raw = String(value ?? "");
  if (!raw.includes(",") && !raw.includes('"') && !raw.includes("\n") && !raw.includes("\r")) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const header = headers.join(",");
  const body = rows
    .map((row) => headers.map((h) => escapeCsv(row[h])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

export async function GET(req: Request) {
  try {
    const auth = await requireApiSession(req);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "").trim().toLowerCase();
    const q = String(searchParams.get("q") || "").trim();
    const tenantId = String(searchParams.get("tenantId") || "").trim();
    const tipo = String(searchParams.get("tipo") || "").trim();
    const estado = String(searchParams.get("estado") || "").trim();
    const ordenar = String(searchParams.get("ordenar") || "").trim();

    const effectiveTenantId = tenantId || auth.session.tenantId || "";

    if (scope === "customers") {
      const where: any = {};
      if (effectiveTenantId) {
        where.AND = [{ OR: [{ tenantId: effectiveTenantId }, { tenantLinks: { some: { tenantId: effectiveTenantId } } }] }];
      }
      if (q) {
        const digits = q.replace(/[^\d]/g, "");
        const or: any[] = [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } }
        ];
        if (digits.length >= 4) or.push({ phone: { contains: digits } });
        else or.push({ phone: { contains: q, mode: "insensitive" } });
        or.push({ metadata: { path: ["identificacion"], string_contains: q } } as any);
        or.push({ metadata: { path: ["identificacionNumero"], string_contains: q } } as any);
        or.push({ metadata: { path: ["documentNumber"], string_contains: q } } as any);
        where.OR = or;
      }
      const items = await prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000
      });
      const csv = toCsv(
        ["id", "name", "email", "phone", "identificacion", "tenantId", "createdAt"],
        items.map((c: any) => ({
          id: c?.id,
          name: c?.name,
          email: c?.email,
          phone: c?.phone,
          identificacion: c?.metadata?.identificacion || c?.metadata?.documentNumber || "",
          tenantId: c?.tenantId || "",
          createdAt: c?.createdAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="contactos.csv"`
        }
      });
    }

    if (scope === "products") {
      const where: any = { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } as any;
      if (effectiveTenantId) {
        where.AND = [{ OR: [{ tenantId: effectiveTenantId }, { tenantLinks: { some: { tenantId: effectiveTenantId } } }] }];
      }
      if (q) {
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { metadata: { path: ["displayName"], string_contains: q } } as any,
          { metadata: { path: ["sku"], string_contains: q } } as any
        ];
      }
      const items = await prisma.subscriptionPlan.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000
      });
      const csv = toCsv(
        ["id", "name", "sku", "kind", "price_cop", "currency", "requiresShipping", "taxPercent", "discountType", "createdAt"],
        items.map((p: any) => ({
          id: p?.id,
          name: (p?.metadata as any)?.displayName || p?.name,
          sku: (p?.metadata as any)?.sku || "",
          kind: (p?.metadata as any)?.itemKind || "PRODUCT",
          price_cop: Math.trunc(Number(p?.priceInCents || 0) / 100),
          currency: p?.currency || "COP",
          requiresShipping: (p?.metadata as any)?.requiresShipping ? "true" : "false",
          taxPercent: (p?.metadata as any)?.taxPercent || 0,
          discountType: (p?.metadata as any)?.discountType || "NONE",
          createdAt: p?.createdAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="productos.csv"`
        }
      });
    }

    if (scope === "companies") {
      const where: any = {};
      if (effectiveTenantId) {
        where.tenantId = effectiveTenantId;
      }
      if (q) {
        const digits = q.replace(/[^\d]/g, "");
        const or: any[] = [
          { nombre: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { direccion: { contains: q, mode: "insensitive" } },
          { sitioWeb: { contains: q, mode: "insensitive" } }
        ];
        if (digits.length >= 4) {
          or.push({ telefono: { contains: digits } });
          or.push({ telefono: { contains: q } });
        } else {
          or.push({ telefono: { contains: q, mode: "insensitive" } });
        }
        where.OR = or;
      }
      const items = await prisma.empresa.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: { _count: { select: { contactos: true } } }
      });
      const csv = toCsv(
        ["id", "nombre", "email", "telefono", "direccion", "sitioWeb", "contactos", "createdAt"],
        items.map((e: any) => ({
          id: e?.id,
          nombre: e?.nombre,
          email: e?.email,
          telefono: e?.telefono,
          direccion: e?.direccion,
          sitioWeb: e?.sitioWeb,
          contactos: Number(e?._count?.contactos || 0),
          createdAt: e?.createdAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="empresas.csv"`
        }
      });
    }

    if (scope === "billing") {
      const where: any = {};
      if (effectiveTenantId) {
        where.AND = [{ OR: [{ tenantId: effectiveTenantId }, { tenantLinks: { some: { tenantId: effectiveTenantId } } }] }];
      }
      if (estado && estado !== "todos") {
        where.status = estado.toUpperCase();
      }
      if (q) {
        where.OR = [
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { customer: { email: { contains: q, mode: "insensitive" } } },
          { plan: { name: { contains: q, mode: "insensitive" } } }
        ];
      }
      if (tipo === "suscripciones") {
        where.plan = { metadata: { path: ["collectionMode"], equals: "AUTO_DEBIT" } } as any;
      }
      if (tipo === "planes") {
        where.plan = { metadata: { path: ["collectionMode"], equals: "MANUAL_LINK" } } as any;
      }
      const items = await prisma.subscription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 3000,
        include: { customer: true, plan: true }
      });
      const csv = toCsv(
        ["id", "customerId", "customerName", "planId", "planName", "status", "collectionMode", "amount_cop", "currency", "periodEndAt"],
        items.map((s: any) => ({
          id: s?.id,
          customerId: s?.customerId || s?.customer?.id || "",
          customerName: s?.customer?.name || s?.customer?.email || "",
          planId: s?.planId || s?.plan?.id || "",
          planName: s?.plan?.name || "",
          status: s?.status || "",
          collectionMode: s?.plan?.metadata?.collectionMode || "",
          amount_cop: Math.trunc(Number(s?.plan?.priceInCents || 0) / 100),
          currency: s?.plan?.currency || "COP",
          periodEndAt: s?.currentPeriodEndAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="suscripciones.csv"`
        }
      });
    }

    if (scope === "payments") {
      const status = String(searchParams.get("status") || "").trim().toUpperCase();
      const where: any = {};
      if (effectiveTenantId) where.tenantId = effectiveTenantId;
      if (status) where.status = status;
      if (q) {
        where.OR = [
          { reference: { contains: q, mode: "insensitive" } },
          { wompiTransactionId: { contains: q, mode: "insensitive" } },
          { wompiPaymentLinkId: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { customer: { email: { contains: q, mode: "insensitive" } } },
          { customer: { phone: { contains: q, mode: "insensitive" } } }
        ];
      }
      const items = await prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: { customer: true, subscription: { include: { plan: true } } }
      });
      const csv = toCsv(
        ["id", "status", "amount_cents", "currency", "reference", "wompiTransactionId", "customer", "plan", "createdAt", "paidAt"],
        items.map((p: any) => ({
          id: p?.id,
          status: p?.status,
          amount_cents: p?.amountInCents ?? 0,
          currency: p?.currency || "COP",
          reference: p?.reference || "",
          wompiTransactionId: p?.wompiTransactionId || "",
          customer: p?.customer?.name || p?.customer?.email || "",
          plan: p?.subscription?.plan?.name || "",
          createdAt: p?.createdAt || "",
          paidAt: p?.paidAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="pagos.csv"`
        }
      });
    }

    if (scope === "notifications") {
      const status = String(searchParams.get("status") || "").trim();
      const type = String(searchParams.get("type") || "").trim();
      const from = String(searchParams.get("from") || "").trim();
      const to = String(searchParams.get("to") || "").trim();
      const { items } = await listChatwootMessages({
        take: 5000,
        skip: 0,
        q,
        status,
        type,
        from,
        to,
        withCount: false
      });
      const csv = toCsv(
        ["id", "status", "type", "to", "customer", "error", "createdAt"],
        items.map((m: any) => ({
          id: m?.id,
          status: m?.status,
          type: m?.type,
          to: m?.to || "",
          customer: m?.customer?.name || m?.customer?.email || m?.customer?.phone || "",
          error: m?.errorMessage || "",
          createdAt: m?.createdAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="notificaciones_whatsapp.csv"`
        }
      });
    }

    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || "csv_export_failed") }, { status: 500 });
  }
}
