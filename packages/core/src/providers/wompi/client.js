"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WompiClient = void 0;
const zod_1 = require("zod");
const wompiPaymentLinkResponseSchema = zod_1.z.object({
    data: zod_1.z.object({
        id: zod_1.z.string().min(1)
    })
});
const wompiMerchantResponseSchema = zod_1.z.object({
    data: zod_1.z.object({
        presigned_acceptance: zod_1.z.object({
            acceptance_token: zod_1.z.string().min(1),
            permalink: zod_1.z.string().url().optional()
        }),
        presigned_personal_data_auth: zod_1.z.object({
            acceptance_token: zod_1.z.string().min(1),
            permalink: zod_1.z.string().url().optional()
        })
    })
});
const wompiPaymentSourceResponseSchema = zod_1.z.object({
    data: zod_1.z.object({
        id: zod_1.z.number().int().nonnegative()
    })
});
const wompiTransactionResponseSchema = zod_1.z.object({
    data: zod_1.z.object({
        id: zod_1.z.string().min(1),
        status: zod_1.z.string().optional(),
        reference: zod_1.z.string().optional(),
        amount_in_cents: zod_1.z.number().int().optional(),
        currency: zod_1.z.string().optional(),
        payment_link_id: zod_1.z.string().optional(),
        customer_email: zod_1.z.string().optional()
    })
});
const wompiTransactionListResponseSchema = zod_1.z.object({
    data: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string().min(1),
        status: zod_1.z.string().optional(),
        reference: zod_1.z.string().optional(),
        amount_in_cents: zod_1.z.number().int().optional(),
        currency: zod_1.z.string().optional(),
        payment_link_id: zod_1.z.string().optional(),
        customer_email: zod_1.z.string().optional(),
        created_at: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
        finalized_at: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional()
    }))
});
class WompiClient {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    async getMerchant(publicKey) {
        const base = this.opts.apiBaseUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/merchants/${encodeURIComponent(publicKey)}`, { method: "GET" });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(`Wompi get merchant failed: ${res.status} ${JSON.stringify(json)}`);
        }
        const parsed = wompiMerchantResponseSchema.safeParse(json);
        if (!parsed.success)
            throw new Error("Wompi get merchant: unexpected response");
        return {
            acceptanceToken: parsed.data.data.presigned_acceptance.acceptance_token,
            acceptPersonalAuth: parsed.data.data.presigned_personal_data_auth.acceptance_token,
            acceptancePermalink: parsed.data.data.presigned_acceptance.permalink,
            personalDataPermalink: parsed.data.data.presigned_personal_data_auth.permalink,
            raw: json
        };
    }
    async createPaymentLink(input) {
        const res = await fetch(`${this.opts.apiBaseUrl.replace(/\/$/, "")}/payment_links`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.opts.privateKey}`,
                "content-type": "application/json"
            },
            body: JSON.stringify(input)
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(`Wompi create payment link failed: ${res.status} ${JSON.stringify(json)}`);
        }
        const parsed = wompiPaymentLinkResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error("Wompi create payment link: unexpected response");
        }
        const id = parsed.data.data.id;
        const checkoutBase = this.opts.checkoutLinkBaseUrl.replace(/\/$/, "") + "/";
        return { id, checkoutUrl: `${checkoutBase}${id}`, raw: json };
    }
    async createPaymentSource(input) {
        const res = await fetch(`${this.opts.apiBaseUrl.replace(/\/$/, "")}/payment_sources`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.opts.privateKey}`,
                "content-type": "application/json"
            },
            body: JSON.stringify(input)
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(`Wompi create payment source failed: ${res.status} ${JSON.stringify(json)}`);
        }
        const parsed = wompiPaymentSourceResponseSchema.safeParse(json);
        if (!parsed.success)
            throw new Error("Wompi create payment source: unexpected response");
        return { id: parsed.data.data.id, raw: json };
    }
    async createTransaction(input) {
        const res = await fetch(`${this.opts.apiBaseUrl.replace(/\/$/, "")}/transactions`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.opts.privateKey}`,
                "content-type": "application/json"
            },
            body: JSON.stringify(input)
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(`Wompi create transaction failed: ${res.status} ${JSON.stringify(json)}`);
        }
        const parsed = wompiTransactionResponseSchema.safeParse(json);
        if (parsed.success) {
            return { id: parsed.data.data.id, status: parsed.data.data.status, raw: json };
        }
        // Wompi has returned different response shapes over time.
        const data = (json && typeof json === "object"
            ? (json.data ?? json.transaction ?? null)
            : null);
        const fallbackId = data && (typeof data.id === "string" || typeof data.id === "number")
            ? String(data.id)
            : "";
        if (fallbackId) {
            return { id: fallbackId, status: typeof data?.status === "string" ? data.status : undefined, raw: json };
        }
        throw new Error(`Wompi create transaction: unexpected response ${JSON.stringify(json)}`);
    }
    async getTransaction(id, publicKey) {
        const res = await fetch(`${this.opts.apiBaseUrl.replace(/\/$/, "")}/transactions/${encodeURIComponent(id)}`, {
            method: "GET",
            headers: { authorization: `Bearer ${publicKey}` }
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(`Wompi get transaction failed: ${res.status} ${JSON.stringify(json)}`);
        }
        const parsed = wompiTransactionResponseSchema.safeParse(json);
        if (parsed.success) {
            return {
                id: parsed.data.data.id,
                status: parsed.data.data.status,
                reference: parsed.data.data.reference,
                amountInCents: parsed.data.data.amount_in_cents,
                currency: parsed.data.data.currency,
                paymentLinkId: parsed.data.data.payment_link_id,
                customerEmail: parsed.data.data.customer_email,
                raw: json
            };
        }
        const data = (json && typeof json === "object"
            ? (json.data ?? json.transaction ?? null)
            : null);
        if (data && typeof data.id === "string" && data.id.length > 0) {
            return {
                id: data.id,
                status: data.status,
                reference: data.reference,
                amountInCents: data.amount_in_cents,
                currency: data.currency,
                paymentLinkId: data.payment_link_id,
                customerEmail: data.customer_email,
                raw: json
            };
        }
        throw new Error(`Wompi get transaction: unexpected response ${JSON.stringify(json)}`);
    }
    async listTransactionsByReference(reference, authKey) {
        const ref = String(reference || "").trim();
        if (!ref)
            return [];
        const base = this.opts.apiBaseUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/transactions?reference=${encodeURIComponent(ref)}`, {
            method: "GET",
            headers: { authorization: `Bearer ${authKey}` }
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(`Wompi list transactions failed: ${res.status} ${JSON.stringify(json)}`);
        }
        const parsed = wompiTransactionListResponseSchema.safeParse(json);
        if (parsed.success) {
            return parsed.data.data.map((t) => ({
                id: t.id,
                status: t.status,
                reference: t.reference,
                amountInCents: t.amount_in_cents,
                currency: t.currency,
                paymentLinkId: t.payment_link_id,
                customerEmail: t.customer_email,
                createdAt: t.created_at,
                finalizedAt: t.finalized_at,
                raw: t
            }));
        }
        const data = (json && typeof json === "object" ? json.data : null);
        const list = Array.isArray(data) ? data : Array.isArray(json?.transactions) ? json.transactions : [];
        return list
            .filter((t) => t && (typeof t.id === "string" || typeof t.id === "number"))
            .map((t) => ({
            id: String(t.id),
            status: typeof t.status === "string" ? t.status : undefined,
            reference: typeof t.reference === "string" ? t.reference : undefined,
            amountInCents: typeof t.amount_in_cents === "number" ? t.amount_in_cents : undefined,
            currency: typeof t.currency === "string" ? t.currency : undefined,
            paymentLinkId: typeof t.payment_link_id === "string" ? t.payment_link_id : undefined,
            customerEmail: typeof t.customer_email === "string" ? t.customer_email : undefined,
            createdAt: t.created_at,
            finalizedAt: t.finalized_at,
            raw: t
        }));
    }
}
exports.WompiClient = WompiClient;
