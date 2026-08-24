"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAiChatCompletion = createAiChatCompletion;
const client_1 = require("@prisma/client");
const http_1 = require("../lib/http");
const logger_1 = require("../lib/logger");
const credentials_1 = require("./credentials");
const systemLog_1 = require("./systemLog");
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
function normalizeKey(value) {
    const v = String(value || "").trim();
    return v ? v : "";
}
function summarizeMessages(messages) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const raw = String(lastUser?.content || "").trim();
    if (!raw)
        return null;
    return raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
}
async function callProvider(args) {
    const endpoint = `${args.baseUrl}/chat/completions`;
    const payload = {
        model: args.model,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content }))
    };
    const res = await (0, http_1.postJson)(endpoint, payload, { Authorization: `Bearer ${args.apiKey}` });
    let json = null;
    if (res.text) {
        try {
            json = JSON.parse(res.text);
        }
        catch {
            json = null;
        }
    }
    if (!res.ok) {
        const details = json?.error?.message || json?.message || res.text || "unknown_error";
        const err = new Error(`ai_${args.provider.toLowerCase()}_${res.status}: ${details}`);
        err.status = res.status;
        throw err;
    }
    const content = String(json?.choices?.[0]?.message?.content || "").trim();
    if (!content)
        throw new Error(`ai_${args.provider.toLowerCase()}_empty_response`);
    return { provider: args.provider, model: args.model, content, raw: json };
}
async function createAiChatCompletion(messages, meta) {
    const openaiKey = normalizeKey(await (0, credentials_1.getCredential)(client_1.CredentialProvider.OPENAI, "API_KEY"));
    const deepseekKey = normalizeKey(await (0, credentials_1.getCredential)(client_1.CredentialProvider.DEEPSEEK, "API_KEY"));
    const providers = [];
    if (openaiKey) {
        providers.push({ provider: "OPENAI", apiKey: openaiKey, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL });
    }
    if (deepseekKey) {
        providers.push({ provider: "DEEPSEEK", apiKey: deepseekKey, model: DEEPSEEK_MODEL, baseUrl: DEEPSEEK_BASE_URL });
    }
    if (!providers.length) {
        throw new Error("ai_not_configured");
    }
    const promptPreview = summarizeMessages(messages);
    let lastError = null;
    for (let i = 0; i < providers.length; i += 1) {
        const p = providers[i];
        try {
            return await callProvider({ ...p, messages });
        }
        catch (err) {
            lastError = err;
            const msg = String(err?.message || err);
            const payload = { provider: p.provider, error: msg, prompt: promptPreview, meta: meta || null };
            if (i < providers.length - 1) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, `ai.${p.provider.toLowerCase()}`, "Proveedor falló, intentando respaldo", payload).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, provider: p.provider }, "aiClient: fallo escribiendo systemLog de fallback");
                });
                continue;
            }
            await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, `ai.${p.provider.toLowerCase()}`, "Fallo al procesar IA", payload).catch((logErr) => {
                logger_1.logger.warn({ err: logErr, provider: p.provider }, "aiClient: fallo escribiendo systemLog de error final");
            });
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || "ai_request_failed"));
}
