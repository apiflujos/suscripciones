import { z } from "zod";

const wompiPaymentLinkResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1)
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

export class WompiClient {
  constructor(
    private readonly opts: {
      apiBaseUrl: string;
      privateKey: string;
      checkoutLinkBaseUrl: string;
    }
  ) {}

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
}
