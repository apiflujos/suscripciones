"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatwootClient = void 0;
const zod_1 = require("zod");
const chatwootTemplates_1 = require("../../services/chatwootTemplates");
const contactCreateSchema = zod_1.z.object({
    payload: zod_1.z
        .object({
        contact: zod_1.z.object({ id: zod_1.z.number().int().positive() }).passthrough(),
        contact_inbox: zod_1.z.object({ source_id: zod_1.z.string().min(1) }).passthrough().optional()
    })
        .passthrough()
});
const contactShowSchema = zod_1.z.object({
    payload: zod_1.z
        .object({
        contact_inboxes: zod_1.z
            .array(zod_1.z.object({
            source_id: zod_1.z.string().min(1),
            inbox: zod_1.z.object({ id: zod_1.z.number().int().positive() }).passthrough()
        }).passthrough())
            .optional()
    })
        .passthrough()
});
const contactInboxCreateSchema = zod_1.z.object({
    source_id: zod_1.z.string().min(1)
});
const conversationCreateSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive()
});
class ChatwootClient {
    opts;
    static inboxCache = new Map();
    constructor(opts) {
        this.opts = opts;
    }
    normalizePhoneNumber(raw) {
        const value = String(raw ?? "").trim();
        if (!value)
            return undefined;
        const digits = value.replace(/\D/g, "");
        if (!digits)
            return undefined;
        let e164 = "";
        if (value.startsWith("+")) {
            e164 = `+${digits}`;
        }
        else if (value.startsWith("00")) {
            e164 = `+${digits.slice(2)}`;
        }
        else if (digits.length >= 11 && digits.length <= 15) {
            // Accept already-complete international numbers that come without '+'.
            e164 = `+${digits}`;
        }
        else {
            const defaultCode = String(process.env.CHATWOOT_DEFAULT_COUNTRY_CODE || process.env.DEFAULT_PHONE_COUNTRY_CODE || "").replace(/\D/g, "");
            const inferredCode = !defaultCode && digits.length === 10 && digits.startsWith("3") ? "57" : defaultCode;
            if (!inferredCode)
                return undefined;
            e164 = `+${inferredCode}${digits}`;
        }
        const len = e164.replace(/\D/g, "").length;
        if (len < 7 || len > 15)
            return undefined;
        return e164;
    }
    escapeHtml(raw) {
        return raw
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }
    looksLikeHtml(raw) {
        return /<\s*\/?\s*[a-z][^>]*>/i.test(raw);
    }
    linkify(raw) {
        const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
        return raw.replace(urlPattern, (match) => {
            let url = match;
            let suffix = "";
            while (/[)\].,!?:;]$/.test(url)) {
                suffix = url.slice(-1) + suffix;
                url = url.slice(0, -1);
            }
            if (!url)
                return match;
            const href = url.startsWith("http") ? url : `https://${url}`;
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${suffix}`;
        });
    }
    stripHtmlToText(raw) {
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
        text = text.replace(/<\s*a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/\s*a\s*>/gi, (_match, href, label) => {
            const cleanLabel = this.stripHtmlToText(String(label ?? "")).trim();
            if (cleanLabel && cleanLabel !== href)
                return `[${cleanLabel}](${href})`;
            return `[${href}](${href})`;
        });
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
    htmlToMarkdown(raw) {
        let text = String(raw ?? "");
        if (!text)
            return "";
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
            if (!cleanHref)
                return cleanLabel;
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
    linkifyMarkdown(raw) {
        const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
        return raw.replace(urlPattern, (match) => {
            let url = match;
            let suffix = "";
            while (/[)\].,!?:;]$/.test(url)) {
                suffix = url.slice(-1) + suffix;
                url = url.slice(0, -1);
            }
            if (!url)
                return match;
            const href = url.startsWith("http") ? url : `https://${url}`;
            return `[${url}](${href})${suffix}`;
        });
    }
    normalizePlainText(raw) {
        const input = String(raw ?? "");
        if (!input)
            return "";
        const normalized = input.replace(/\r\n?/g, "\n");
        let text = this.looksLikeHtml(normalized) ? this.htmlToMarkdown(normalized) : normalized;
        // Convert markdown links to "label url" so URLs stay clickable in WhatsApp.
        text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 $2");
        text = text.replace(/\[([^\]]+)\]\((www\.[^)\s]+)\)/g, "$1 https://$2");
        text = text.replace(/[ \t]+\n/g, "\n");
        text = text.replace(/\n{3,}/g, "\n\n");
        return text.trim();
    }
    formatChatwootText(content) {
        const raw = String(content ?? "");
        if (!raw)
            return "";
        return this.normalizePlainText(raw);
    }
    sanitizeTemplateParams(input) {
        if (!input || typeof input !== "object")
            return input;
        if (Array.isArray(input))
            return input.map((item) => this.sanitizeTemplateParams(item));
        const out = {};
        for (const [key, value] of Object.entries(input)) {
            const normalizedKey = String(key || "").toLowerCase();
            if (normalizedKey === "content_type" || normalizedKey === "contenttype" || normalizedKey === "content-type") {
                continue;
            }
            if (typeof value === "string") {
                out[key] = this.normalizePlainText(value);
            }
            else {
                out[key] = this.sanitizeTemplateParams(value);
            }
        }
        if ("processed_params" in out) {
            out.processed_params = (0, chatwootTemplates_1.normalizeProcessedTemplateParams)(out.processed_params);
        }
        return out;
    }
    buildSearchQueries(input) {
        const out = [];
        const email = String(input.email ?? "").trim().toLowerCase();
        if (email)
            out.push(email);
        const rawPhone = String(input.phoneNumber ?? "").trim();
        const normalized = this.normalizePhoneNumber(rawPhone);
        if (normalized)
            out.push(normalized);
        const digits = rawPhone.replace(/\D/g, "");
        if (digits) {
            out.push(digits);
            if (digits.length === 10 && digits.startsWith("3"))
                out.push(`57${digits}`);
            if (digits.length >= 10)
                out.push(digits.slice(-10));
        }
        if (rawPhone && rawPhone !== normalized)
            out.push(rawPhone);
        return Array.from(new Set(out.filter((q) => q)));
    }
    async request(path, init) {
        const base = this.opts.baseUrl.replace(/\/$/, "");
        const normalizedPath = base.endsWith("/api/v1") && path.startsWith("/api/v1/")
            ? path.replace(/^\/api\/v1/, "")
            : base.endsWith("/api") && path.startsWith("/api/")
                ? path.replace(/^\/api/, "")
                : path;
        const url = `${base}${normalizedPath}`;
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
    async requestMultipart(path, form) {
        const base = this.opts.baseUrl.replace(/\/$/, "");
        const normalizedPath = base.endsWith("/api/v1") && path.startsWith("/api/v1/")
            ? path.replace(/^\/api\/v1/, "")
            : base.endsWith("/api") && path.startsWith("/api/")
                ? path.replace(/^\/api/, "")
                : path;
        const url = `${base}${normalizedPath}`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                api_access_token: this.opts.apiAccessToken
            },
            body: form
        });
        const json = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, json };
    }
    async listWhatsappTemplates() {
        const normalizeList = (payload) => {
            const list = Array.isArray(payload?.whatsapp_templates)
                ? payload.whatsapp_templates
                : Array.isArray(payload?.templates)
                    ? payload.templates
                    : Array.isArray(payload)
                        ? payload
                        : [];
            return list
                .map((tpl) => ({
                id: tpl.id ?? tpl.template_id ?? tpl.uuid ?? tpl.name,
                name: String(tpl.name || tpl.template_name || "").trim(),
                language: String(tpl.language || tpl.locale || "es").trim(),
                category: String(tpl.category || tpl.template_category || "").trim(),
                status: String(tpl.status || "").trim(),
                components: tpl.components ?? tpl.content ?? null
            }))
                .filter((tpl) => tpl.name);
        };
        const rawShape = (json) => {
            if (json === null || json === undefined)
                return null;
            if (Array.isArray(json))
                return `array[${json.length}]`;
            if (typeof json === "object")
                return Object.keys(json);
            return typeof json;
        };
        const diag = {};
        let anyEndpointOk = false;
        let lastErrorStatus = null;
        let lastErrorBody = null;
        const primaryPath = `/api/v1/accounts/${this.opts.accountId}/whatsapp_templates`;
        const res = await this.request(primaryPath, { method: "GET" });
        diag.primary = { status: res.status, ok: res.ok, shape: rawShape(res.json) };
        if (res.ok) {
            const payload = (res.json && (res.json.payload ?? res.json.data ?? res.json)) || [];
            const result = normalizeList(payload);
            if (result.length)
                return { templates: result, _diag: { ...diag, usedEndpoint: "primary" } };
            anyEndpointOk = true;
        }
        else {
            lastErrorStatus = res.status;
            lastErrorBody = res.json;
        }
        if (this.opts.inboxId) {
            const fallback = await this.request(`/api/v1/accounts/${this.opts.accountId}/inboxes/${this.opts.inboxId}/whatsapp_templates`, {
                method: "GET"
            });
            diag.standard = { status: fallback.status, ok: fallback.ok, shape: rawShape(fallback.json) };
            if (fallback.ok) {
                const payload = (fallback.json && (fallback.json.payload ?? fallback.json.data ?? fallback.json)) || [];
                const result = normalizeList(payload);
                if (result.length)
                    return { templates: result, _diag: { ...diag, usedEndpoint: "standard" } };
                anyEndpointOk = true;
            }
            else {
                lastErrorStatus = fallback.status;
                lastErrorBody = fallback.json;
            }
            // Final fallback: read templates from inbox details if exposed there.
            const inboxRes = await this.request(`/api/v1/accounts/${this.opts.accountId}/inboxes/${this.opts.inboxId}`, { method: "GET" });
            diag.inbox = { status: inboxRes.status, ok: inboxRes.ok, shape: rawShape(inboxRes.json) };
            if (inboxRes.ok) {
                const data = inboxRes.json?.payload ?? inboxRes.json?.data ?? inboxRes.json ?? {};
                const inboxTemplates = data?.message_templates ||
                    data?.channel?.message_templates ||
                    data?.channel?.whatsapp_templates ||
                    data?.channel?.templates ||
                    data?.whatsapp_templates ||
                    data?.templates ||
                    [];
                const normalized = normalizeList(inboxTemplates);
                if (normalized.length)
                    return { templates: normalized, _diag: { ...diag, usedEndpoint: "inbox" } };
                anyEndpointOk = true;
                diag.inboxChannelKeys = typeof data?.channel === "object" && data?.channel ? Object.keys(data.channel) : null;
            }
        }
        if (anyEndpointOk)
            return { templates: [], _diag: { ...diag, usedEndpoint: "none_empty" } };
        throw new Error(`Chatwoot list templates failed: ${lastErrorStatus} ${JSON.stringify(lastErrorBody)}`);
    }
    async syncWhatsappTemplates() {
        if (!this.opts.inboxId)
            return { ok: false, error: "missing_inbox_id" };
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/inboxes/${this.opts.inboxId}/sync_templates`, {
            method: "POST"
        });
        if (!res.ok)
            return { ok: false, status: res.status, error: "sync_failed", details: res.json };
        return { ok: true };
    }
    async createContact(input) {
        const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
        const body = {
            inbox_id: this.opts.inboxId,
            name: input.name,
            email: input.email,
            phone_number: phoneNumber
        };
        if (!phoneNumber)
            delete body.phone_number;
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts`, {
            method: "POST",
            body: JSON.stringify(body)
        });
        if (!res.ok)
            throw new Error(`Chatwoot create contact failed: ${res.status} ${JSON.stringify(res.json)}`);
        const parsed = contactCreateSchema.safeParse(res.json);
        if (!parsed.success)
            throw new Error("Chatwoot create contact: unexpected response");
        return {
            contactId: parsed.data.payload.contact.id,
            sourceId: parsed.data.payload.contact_inbox?.source_id,
            raw: res.json
        };
    }
    async searchContact(q) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/search?q=${encodeURIComponent(q)}`, {
            method: "GET"
        });
        if (!res.ok)
            throw new Error(`Chatwoot search contact failed: ${res.status} ${JSON.stringify(res.json)}`);
        const items = (res.json?.payload ?? []);
        const first = items?.[0];
        return first?.id ? { contactId: Number(first.id), raw: res.json } : null;
    }
    async getContact(contactId, inboxId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}`, {
            method: "GET"
        });
        if (!res.ok)
            throw new Error(`Chatwoot get contact failed: ${res.status} ${JSON.stringify(res.json)}`);
        const parsed = contactShowSchema.safeParse(res.json);
        if (!parsed.success)
            throw new Error("Chatwoot get contact: unexpected response");
        const inboxes = parsed.data.payload.contact_inboxes || [];
        const targetInboxId = Number.isFinite(Number(inboxId)) ? Number(inboxId) : this.opts.inboxId;
        const match = inboxes.find((i) => Number(i?.inbox?.id) === targetInboxId);
        return {
            sourceId: match?.source_id,
            raw: res.json
        };
    }
    async listContactableInboxes(contactId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/contactable_inboxes`, { method: "GET" });
        if (!res.ok)
            throw new Error(`Chatwoot list contactable inboxes failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async listInboxes() {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/inboxes`, { method: "GET" });
        if (!res.ok)
            throw new Error(`Chatwoot list inboxes failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async createContactInbox(contactId, sourceId, inboxId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/contact_inboxes`, {
            method: "POST",
            body: JSON.stringify({
                inbox_id: inboxId ?? this.opts.inboxId,
                ...(sourceId ? { source_id: sourceId } : {})
            })
        });
        if (!res.ok)
            throw new Error(`Chatwoot create contact inbox failed: ${res.status} ${JSON.stringify(res.json)}`);
        const parsed = contactInboxCreateSchema.safeParse(res.json);
        if (!parsed.success)
            throw new Error("Chatwoot create contact inbox: unexpected response");
        return { sourceId: parsed.data.source_id, raw: res.json };
    }
    async updateContact(contactId, input) {
        const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
        const body = {
            name: input.name,
            email: input.email,
            phone_number: phoneNumber,
            identifier: input.identifier,
            additional_attributes: input.additionalAttributes,
            custom_attributes: input.customAttributes
        };
        if (!phoneNumber)
            delete body.phone_number;
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}`, {
            method: "PUT",
            body: JSON.stringify(body)
        });
        if (!res.ok)
            throw new Error(`Chatwoot update contact failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async listContactLabels(contactId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/labels`, {
            method: "GET"
        });
        if (!res.ok)
            throw new Error(`Chatwoot list contact labels failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async addContactLabels(contactId, labels) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels })
        });
        if (!res.ok)
            throw new Error(`Chatwoot add contact labels failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async setContactLabels(contactId, labels) {
        return this.addContactLabels(contactId, labels);
    }
    async removeContactLabels(contactId, labelsToRemove) {
        const current = await this.listContactLabels(contactId);
        const existing = Array.isArray(current.raw?.payload) ? current.raw.payload : [];
        const next = existing.filter((l) => !labelsToRemove.includes(l));
        return this.setContactLabels(contactId, next);
    }
    async createConversation(input) {
        const body = {
            inbox_id: input.inboxId ?? this.opts.inboxId,
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
        if (!res.ok)
            throw new Error(`Chatwoot create conversation failed: ${res.status} ${JSON.stringify(res.json)}`);
        const parsed = conversationCreateSchema.safeParse(res.json);
        if (!parsed.success)
            throw new Error("Chatwoot create conversation: unexpected response");
        return { conversationId: parsed.data.id, raw: res.json };
    }
    async getConversationDetails(conversationId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}`, {
            method: "GET"
        });
        if (!res.ok)
            throw new Error(`Chatwoot get conversation failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async listConversationMessages(conversationId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`, {
            method: "GET"
        });
        if (!res.ok)
            throw new Error(`Chatwoot list conversation messages failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async listConversationLabels(conversationId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/labels`, {
            method: "GET"
        });
        if (!res.ok)
            throw new Error(`Chatwoot list conversation labels failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async addConversationLabels(conversationId, labels) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels })
        });
        if (!res.ok)
            throw new Error(`Chatwoot add conversation labels failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async updateConversationCustomAttributes(conversationId, customAttributes) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/custom_attributes`, {
            method: "POST",
            body: JSON.stringify({ custom_attributes: customAttributes })
        });
        if (!res.ok)
            throw new Error(`Chatwoot update conversation custom attrs failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async listContactConversations(contactId) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/contacts/${contactId}/conversations`, {
            method: "GET"
        });
        if (!res.ok) {
            if (res.status === 404) {
                return { raw: { payload: [] }, notFound: true };
            }
            throw new Error(`Chatwoot list contact conversations failed: ${res.status} ${JSON.stringify(res.json)}`);
        }
        return { raw: res.json };
    }
    async sendMessage(conversationId, content) {
        const body = { content: this.formatChatwootText(content), message_type: "outgoing", content_type: "text" };
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify(body) });
        if (!res.ok)
            throw new Error(`Chatwoot send message failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async sendTemplate(conversationId, args) {
        const body = {
            content: this.formatChatwootText(args.content),
            message_type: "outgoing",
            content_type: "text",
            template_params: this.sanitizeTemplateParams(args.templateParams)
        };
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify(body) });
        if (!res.ok)
            throw new Error(`Chatwoot send template failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async sendMessageWithAttachment(conversationId, content, attachment) {
        const form = new FormData();
        form.append("content", this.formatChatwootText(content));
        form.append("message_type", "outgoing");
        form.append("content_type", "text");
        const bytes = new Uint8Array(attachment.buffer);
        const blob = new Blob([bytes], { type: attachment.mime });
        form.append("attachments[]", blob, attachment.filename);
        const res = await this.requestMultipart(`/api/v1/accounts/${this.opts.accountId}/conversations/${conversationId}/messages`, form);
        if (!res.ok)
            throw new Error(`Chatwoot send attachment failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async listCustomAttributes(model) {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/custom_attribute_definitions?attribute_model=${encodeURIComponent(model)}`, { method: "GET" });
        if (!res.ok)
            throw new Error(`Chatwoot list custom attributes failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async getAccount() {
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}`, { method: "GET" });
        if (!res.ok)
            throw new Error(`Chatwoot get account failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
    async getInbox(inboxId) {
        const cached = ChatwootClient.inboxCache.get(inboxId);
        const now = Date.now();
        if (cached && cached.expiresAt > now)
            return { raw: cached.raw };
        const res = await this.request(`/api/v1/accounts/${this.opts.accountId}/inboxes/${inboxId}`, { method: "GET" });
        if (!res.ok)
            throw new Error(`Chatwoot get inbox failed: ${res.status} ${JSON.stringify(res.json)}`);
        ChatwootClient.inboxCache.set(inboxId, { raw: res.json, expiresAt: now + 5 * 60 * 1000 });
        return { raw: res.json };
    }
    async createCustomAttribute(input) {
        const displayTypeMap = {
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
        const modelMap = { conversation: 0, contact: 1 };
        const displayType = typeof input.displayType === "number" ? input.displayType : displayTypeMap[String(input.displayType)] ?? 0;
        const model = typeof input.model === "number" ? input.model : modelMap[String(input.model)] ?? 0;
        const body = {
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
        if (!res.ok)
            throw new Error(`Chatwoot create custom attribute failed: ${res.status} ${JSON.stringify(res.json)}`);
        return { raw: res.json };
    }
}
exports.ChatwootClient = ChatwootClient;
