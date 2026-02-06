import { z } from "zod";

const contactCreateSchema = z.object({
  payload: z
    .object({
      contact: z.object({ id: z.number().int().positive() }).passthrough(),
      contact_inbox: z.object({ source_id: z.string().min(1) }).passthrough().optional()
    })
    .passthrough()
});

const conversationCreateSchema = z.object({
  id: z.number().int().positive()
});

export class ChatwootClient {
  constructor(
    private readonly opts: {
      baseUrl: string;
      accountId: number;
      apiAccessToken: string;
      inboxId: number;
    }
  ) {}

  private async request(path: string, init: RequestInit) {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        api_access_token: this.opts.apiAccessToken,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  }

  async createContact(input: { name?: string; email?: string; phoneNumber?: string }) {
    const body: any = {
      inbox_id: this.opts.inboxId,
      name: input.name,
      email: input.email,
      phone_number: input.phoneNumber
    };
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Chatwoot create contact failed: ${res.status} ${JSON.stringify(res.json)}`);
    const parsed = contactCreateSchema.safeParse(res.json);
    if (!parsed.success) throw new Error("Chatwoot create contact: unexpected response");
    return {
      contactId: parsed.data.payload.contact.id,
      sourceId: parsed.data.payload.contact_inbox?.source_id,
      raw: res.json
    };
  }

  async searchContact(q: string) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/search?q=${encodeURIComponent(q)}`, {
      method: "GET"
    });
    if (!res.ok) throw new Error(`Chatwoot search contact failed: ${res.status} ${JSON.stringify(res.json)}`);
    const items = (res.json?.payload ?? []) as any[];
    const first = items?.[0];
    return first?.id ? { contactId: Number(first.id), raw: res.json } : null;
  }

  async createConversation(input: { contactId: number; sourceId?: string; message?: string }) {
    const body: any = {
      inbox_id: this.opts.inboxId,
      contact_id: input.contactId,
      ...(input.sourceId ? { source_id: input.sourceId } : {}),
      ...(input.message ? { message: { content: input.message } } : {})
    };
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Chatwoot create conversation failed: ${res.status} ${JSON.stringify(res.json)}`);
    const parsed = conversationCreateSchema.safeParse(res.json);
    if (!parsed.success) throw new Error("Chatwoot create conversation: unexpected response");
    return { conversationId: parsed.data.id, raw: res.json };
  }

  async sendMessage(conversationId: number, content: string) {
    const body = { content, message_type: "outgoing", content_type: "text" };
    const res = await this.request(
      `/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Chatwoot send message failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async sendTemplate(conversationId: number, args: { content: string; templateParams: any }) {
    const body = {
      content: args.content,
      message_type: "outgoing",
      content_type: "text",
      template_params: args.templateParams
    };
    const res = await this.request(
      `/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Chatwoot send template failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }
}
