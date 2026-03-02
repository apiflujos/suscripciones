import { z } from "zod";

const wompiPaymentLinkResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1)
  })
});

const wompiMerchantResponseSchema = z.object({
  data: z.object({
    presigned_acceptance: z.object({
      acceptance_token: z.string().min(1),
      permalink: z.string().url().optional()
    }),
    presigned_personal_data_auth: z.object({
      acceptance_token: z.string().min(1),
      permalink: z.string().url().optional()
    })
  })
});

const wompiPaymentSourceResponseSchema = z.object({
  data: z.object({
    id: z.number().int().nonnegative()
  })
});

const wompiTransactionResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    status: z.string().optional(),
    reference: z.string().optional(),
    amount_in_cents: z.number().int().optional(),
    currency: z.string().optional(),
    payment_link_id: z.string().optional(),
    customer_email: z.string().optional()
  })
});

export type WompiPaymentLinkCreateInput = {
  name: string;
  description?: string;
  single_use?: boolean;
  collect_shipping?: boolean;
  currency: string;
  amount_in_cents: number;
  expires_at?: string;
  redirect_url?: string;
  sku?: string;
};

export type WompiPaymentSourceCreateInput = {
  type: "CARD" | "NEQUI" | "PSE";
  token: string;
  customer_email: string;
  acceptance_token: string;
  accept_personal_auth: string;
};

export type WompiTransactionCreateInput = {
  amount_in_cents: number;
  currency: string;
  customer_email: string;
  reference: string;
  signature: string;
  acceptance_token: string;
  accept_personal_auth: string;
  payment_source_id: number;
  payment_method?: { installments?: number };
  recurrent?: boolean;
};

export class WompiClient {
  constructor(
    private readonly opts: {
      apiBaseUrl: string;
      privateKey: string;
      checkoutLinkBaseUrl: string;
    }
  ) {}

  async getMerchant(publicKey: string): Promise<{
    acceptanceToken: string;
    acceptPersonalAuth: string;
    acceptancePermalink?: string;
    personalDataPermalink?: string;
    raw: unknown;
  }> {
    const base = this.opts.apiBaseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/merchants/${encodeURIComponent(publicKey)}`, { method: "GET" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Wompi get merchant failed: ${res.status} ${JSON.stringify(json)}`);
    }
    const parsed = wompiMerchantResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("Wompi get merchant: unexpected response");
    return {
      acceptanceToken: parsed.data.data.presigned_acceptance.acceptance_token,
      acceptPersonalAuth: parsed.data.data.presigned_personal_data_auth.acceptance_token,
      acceptancePermalink: parsed.data.data.presigned_acceptance.permalink,
      personalDataPermalink: parsed.data.data.presigned_personal_data_auth.permalink,
      raw: json
    };
  }

  async createPaymentLink(input: WompiPaymentLinkCreateInput): Promise<{
    id: string;
    checkoutUrl: string;
    raw: unknown;
  }> {
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

  async createPaymentSource(input: WompiPaymentSourceCreateInput): Promise<{ id: number; raw: unknown }> {
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
    if (!parsed.success) throw new Error("Wompi create payment source: unexpected response");
    return { id: parsed.data.data.id, raw: json };
  }

  async createTransaction(input: WompiTransactionCreateInput): Promise<{ id: string; status?: string; raw: unknown }> {
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
      ? ((json as Record<string, any>).data ?? (json as Record<string, any>).transaction ?? null)
      : null) as Record<string, any> | null;
    const fallbackId =
      data && (typeof data.id === "string" || typeof data.id === "number")
        ? String(data.id)
        : "";
    if (fallbackId) {
      return { id: fallbackId, status: typeof data?.status === "string" ? data.status : undefined, raw: json };
    }
    throw new Error(`Wompi create transaction: unexpected response ${JSON.stringify(json)}`);
  }

  async getTransaction(id: string, publicKey: string): Promise<{
    id: string;
    status?: string;
    reference?: string;
    amountInCents?: number;
    currency?: string;
    paymentLinkId?: string;
    customerEmail?: string;
    raw: unknown;
  }> {
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
      ? ((json as Record<string, any>).data ?? (json as Record<string, any>).transaction ?? null)
      : null) as Record<string, any> | null;

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
}
