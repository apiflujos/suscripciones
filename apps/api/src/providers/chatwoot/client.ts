import { z } from "zod";

const contactCreateSchema = z.object({
  payload: z
    .object({
      contact: z.object({ id: z.number().int().positive() }).passthrough(),
      contact_inbox: z.object({ source_id: z.string().min(1) }).passthrough().optional()
    })
    .passthrough()
});

const contactShowSchema = z.object({
  payload: z
    .object({
      contact_inboxes: z
        .array(
          z.object({
            source_id: z.string().min(1),
            inbox: z.object({ id: z.number().int().positive() }).passthrough()
          }).passthrough()
        )
        .optional()
    })
    .passthrough()
});

const contactInboxCreateSchema = z.object({
  source_id: z.string().min(1)
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

  private normalizePhoneNumber(raw?: string) {
    const value = String(raw ?? "").trim();
    if (!value) return undefined;

    const digits = value.replace(/\D/g, "");
    if (!digits) return undefined;

    let e164 = "";
    if (value.startsWith("+")) {
      e164 = `+${digits}`;
    } else if (value.startsWith("00")) {
      e164 = `+${digits.slice(2)}`;
    } else {
      const defaultCode = String(
        process.env.CHATWOOT_DEFAULT_COUNTRY_CODE || process.env.DEFAULT_PHONE_COUNTRY_CODE || ""
      ).replace(/\D/g, "");
      if (!defaultCode) return undefined;
      e164 = `+${defaultCode}${digits}`;
    }

    const len = e164.replace(/\D/g, "").length;
    if (len < 7 || len > 15) return undefined;
    return e164;
  }

  private escapeHtml(raw: string) {
    return raw
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  private looksLikeHtml(raw: string) {
    return /<\s*\/?\s*[a-z][^>]*>/i.test(raw);
  }

  private linkify(raw: string) {
    const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
    return raw.replace(urlPattern, (match) => {
      let url = match;
      let suffix = "";
      while (/[)\].,!?:;]$/.test(url)) {
        suffix = url.slice(-1) + suffix;
        url = url.slice(0, -1);
      }
      if (!url) return match;
      const href = url.startsWith("http") ? url : `https://${url}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${suffix}`;
    });
  }

  private stripHtmlToText(raw: string) {
    let text = raw;
    text = text.replace(/<\s*br\s*\/?\s*>/gi, "\n");
    text = text.replace(/<\/\s*p\s*>/gi, "\n\n");
    text = text.replace(/<\s*p[^>]*>/gi, "");
    text = text.replace(/<\/\s*div\s*>/gi, "\n");
    text = text.replace(/<\s*div[^>]*>/gi, "");
    text = text.replace(/<\s*li[^>]*>/gi, "- ");
    text = text.replace(/<\/\s*li\s*>/gi, "\n");
    text = text.replace(/<\/?\s*ul[^>]*>/gi, "");
    text = text.replace(/<\/?\s*ol[^>]*>/gi, "");
    text = text.replace(/<\/?\s*(strong|b)[^>]*>/gi, "**");
    text = text.replace(/<\/?\s*(em|i)[^>]*>/gi, "*");
    text = text.replace(/<\/?\s*code[^>]*>/gi, "`");
    text = text.replace(
      /<\s*a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/\s*a\s*>/gi,
      (_match, href, label) => {
        const cleanLabel = this.stripHtmlToText(String(label ?? "")).trim();
        if (cleanLabel && cleanLabel !== href) return `[${cleanLabel}](${href})`;
        return `[${href}](${href})`;
      }
    );
    text = text.replace(/<[^>]+>/g, "");
    text = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'");
    text = text.replace(/\r\n?/g, "\n");
    text = text.replace(/[ \t]+\n/g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  private htmlToMarkdown(raw: string) {
    let text = String(raw ?? "");
    if (!text) return "";
    text = text.replace(/\r\n?/g, "\n");
    text = text.replace(/<\s*br\s*\/?>/gi, "\n");
    text = text.replace(/<\/\s*p\s*>/gi, "\n\n");
    text = text.replace(/<\s*p[^>]*>/gi, "");
    text = text.replace(/<\/\s*div\s*>/gi, "\n");
    text = text.replace(/<\s*div[^>]*>/gi, "");
    text = text.replace(/<\s*(strong|b)[^>]*>(.*?)<\/\s*\1\s*>/gi, "**$2**");
    text = text.replace(/<\s*(em|i)[^>]*>(.*?)<\/\s*\1\s*>/gi, "*$2*");
    text = text.replace(/<\s*a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/\s*a\s*>/gi, (_m, href, label) => {
      const cleanLabel = String(label || "").trim();
      const cleanHref = String(href || "").trim();
      if (!cleanHref) return cleanLabel;
      return cleanLabel ? `${cleanLabel} ${cleanHref}` : cleanHref;
    });
    text = text.replace(/<[^>]+>/g, "");
    text = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'");
    text = text.replace(/[ \t]+\n/g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  private linkifyMarkdown(raw: string) {
    const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
    return raw.replace(urlPattern, (match) => {
      let url = match;
      let suffix = "";
      while (/[)\].,!?:;]$/.test(url)) {
        suffix = url.slice(-1) + suffix;
        url = url.slice(0, -1);
      }
      if (!url) return match;
      const href = url.startsWith("http") ? url : `https://${url}`;
      return `[${url}](${href})${suffix}`;
    });
  }

  private ensureTextPrefix(raw: string) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return raw;
    const firstLine = trimmed.split("\n")[0]?.trim().toUpperCase() || "";
    if (
      firstLine.startsWith("TEXTO") ||
      firstLine.startsWith("TIPO TEXTO") ||
      firstLine.startsWith("TYPE TEXT") ||
      firstLine === "TEXT"
    ) {
      return trimmed;
    }
    return `TEXTO\n\n${trimmed}`;
  }

  private formatChatwootText(content: string) {
    const raw = String(content ?? "");
    if (!raw) return "";
    const normalized = raw.replace(/\r\n?/g, "\n");
    const prepared = this.looksLikeHtml(normalized) ? this.htmlToMarkdown(normalized) : normalized.trim();
    return this.linkifyMarkdown(this.ensureTextPrefix(prepared));
  }

  private sanitizeTemplateParams(input: any): any {
    if (!input || typeof input !== "object") return input;
    if (Array.isArray(input)) return input.map((item) => this.sanitizeTemplateParams(item));
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "content_type") continue;
      out[key] = this.sanitizeTemplateParams(value);
    }
    return out;
  }

  public buildSearchQueries(input: { email?: string; phoneNumber?: string }) {
    const out: string[] = [];
    const email = String(input.email ?? "").trim();
    if (email) out.push(email);
    const rawPhone = String(input.phoneNumber ?? "").trim();
    const normalized = this.normalizePhoneNumber(rawPhone);
    if (normalized) out.push(normalized);
    if (rawPhone && rawPhone !== normalized) out.push(rawPhone);
    return Array.from(new Set(out.filter((q) => q)));
  }

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
    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const body: any = {
      inbox_id: this.opts.inboxId,
      name: input.name,
      email: input.email,
      phone_number: phoneNumber
    };
    if (!phoneNumber) delete body.phone_number;
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

  async getContact(contactId: number) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}`, {
      method: "GET"
    });
    if (!res.ok) throw new Error(`Chatwoot get contact failed: ${res.status} ${JSON.stringify(res.json)}`);
    const parsed = contactShowSchema.safeParse(res.json);
    if (!parsed.success) throw new Error("Chatwoot get contact: unexpected response");
    const inboxes = parsed.data.payload.contact_inboxes || [];
    const match = inboxes.find((i) => Number(i?.inbox?.id) === this.opts.inboxId);
    return {
      sourceId: match?.source_id,
      raw: res.json
    };
  }

  async createContactInbox(contactId: number, sourceId?: string) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/contact_inboxes`, {
      method: "POST",
      body: JSON.stringify({
        inbox_id: this.opts.inboxId,
        ...(sourceId ? { source_id: sourceId } : {})
      })
    });
    if (!res.ok) throw new Error(`Chatwoot create contact inbox failed: ${res.status} ${JSON.stringify(res.json)}`);
    const parsed = contactInboxCreateSchema.safeParse(res.json);
    if (!parsed.success) throw new Error("Chatwoot create contact inbox: unexpected response");
    return { sourceId: parsed.data.source_id, raw: res.json };
  }

  async updateContact(
    contactId: number,
    input: {
      name?: string;
      email?: string;
      phoneNumber?: string;
      identifier?: string;
      additionalAttributes?: Record<string, any>;
      customAttributes?: Record<string, any>;
    }
  ) {
    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const body: any = {
      name: input.name,
      email: input.email,
      phone_number: phoneNumber,
      identifier: input.identifier,
      additional_attributes: input.additionalAttributes,
      custom_attributes: input.customAttributes
    };
    if (!phoneNumber) delete body.phone_number;
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Chatwoot update contact failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async listContactLabels(contactId: number) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/labels`, {
      method: "GET"
    });
    if (!res.ok) throw new Error(`Chatwoot list contact labels failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async addContactLabels(contactId: number, labels: string[]) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels })
    });
    if (!res.ok) throw new Error(`Chatwoot add contact labels failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async setContactLabels(contactId: number, labels: string[]) {
    return this.addContactLabels(contactId, labels);
  }

  async removeContactLabels(contactId: number, labelsToRemove: string[]) {
    const current = await this.listContactLabels(contactId);
    const existing = Array.isArray(current.raw?.payload) ? (current.raw.payload as string[]) : [];
    const next = existing.filter((l) => !labelsToRemove.includes(l));
    return this.setContactLabels(contactId, next);
  }

  async createConversation(input: { contactId: number; sourceId?: string; message?: string }) {
    const body: any = {
      inbox_id: this.opts.inboxId,
      contact_id: input.contactId,
      ...(input.sourceId ? { source_id: input.sourceId } : {}),
      ...(input.message
        ? { message: { content: this.formatChatwootText(input.message), content_type: "text" } }
        : {})
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

  async listConversationLabels(conversationId: number) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/labels`, {
      method: "GET"
    });
    if (!res.ok) throw new Error(`Chatwoot list conversation labels failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async addConversationLabels(conversationId: number, labels: string[]) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels })
    });
    if (!res.ok) throw new Error(`Chatwoot add conversation labels failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async updateConversationCustomAttributes(conversationId: number, customAttributes: Record<string, any>) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/custom_attributes`, {
      method: "POST",
      body: JSON.stringify({ custom_attributes: customAttributes })
    });
    if (!res.ok) throw new Error(`Chatwoot update conversation custom attrs failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async sendMessage(conversationId: number, content: string) {
    const body = { content: this.formatChatwootText(content), message_type: "outgoing", content_type: "text" };
    const res = await this.request(
      `/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Chatwoot send message failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async sendTemplate(conversationId: number, args: { content: string; templateParams: any }) {
    const body = {
      content: this.formatChatwootText(args.content),
      message_type: "outgoing",
      content_type: "text",
      template_params: this.sanitizeTemplateParams(args.templateParams)
    };
    const res = await this.request(
      `/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Chatwoot send template failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async listCustomAttributes(model: "contact" | "conversation") {
    const res = await this.request(
      `/api/v1/accounts/${this.opts.accountId}/custom_attribute_definitions?attribute_model=${encodeURIComponent(model)}`,
      { method: "GET" }
    );
    if (!res.ok) throw new Error(`Chatwoot list custom attributes failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async getAccount() {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}`, { method: "GET" });
    if (!res.ok) throw new Error(`Chatwoot get account failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async getInbox(inboxId: number) {
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/inboxes/${inboxId}`, { method: "GET" });
    if (!res.ok) throw new Error(`Chatwoot get inbox failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }

  async createCustomAttribute(input: {
    displayName: string;
    key: string;
    displayType: "text" | "number" | "currency" | "boolean" | "url" | "date" | "list" | "percent" | "checkbox" | number;
    model: "contact" | "conversation" | number;
    values?: string[];
    description?: string;
    regexPattern?: string;
    regexCue?: string;
  }) {
    const displayTypeMap: Record<string, number> = {
      text: 0,
      number: 1,
      currency: 2,
      percent: 3,
      url: 4,
      date: 5,
      list: 6,
      checkbox: 7,
      boolean: 7
    };
    const modelMap: Record<string, number> = { conversation: 0, contact: 1 };
    const displayType =
      typeof input.displayType === "number" ? input.displayType : displayTypeMap[String(input.displayType)] ?? 0;
    const model = typeof input.model === "number" ? input.model : modelMap[String(input.model)] ?? 0;

    const body: any = {
      attribute_display_name: input.displayName,
      attribute_key: input.key,
      attribute_display_type: displayType,
      attribute_model: model,
      attribute_values: input.values,
      attribute_description: input.description,
      attribute_regex_pattern: input.regexPattern,
      attribute_regex_cue: input.regexCue
    };
    const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/custom_attribute_definitions`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Chatwoot create custom attribute failed: ${res.status} ${JSON.stringify(res.json)}`);
    return { raw: res.json };
  }
}
