"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractProcessedParamValues = extractProcessedParamValues;
exports.normalizeProcessedTemplateParams = normalizeProcessedTemplateParams;
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function normalizeText(value) {
    if (typeof value === "string")
        return value.trim();
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return "";
}
function getButtonComponents(components) {
    const list = Array.isArray(components) ? components : [];
    const buttonsBlock = list.find((entry) => String(asRecord(entry)?.type || "").trim().toUpperCase() === "BUTTONS");
    const rawButtons = Array.isArray(asRecord(buttonsBlock)?.buttons) ? asRecord(buttonsBlock)?.buttons : [];
    return rawButtons.map((entry) => asRecord(entry) || {}).filter(Boolean);
}
function inferButtonType(components, index, fallback) {
    const explicit = normalizeText(fallback).toLowerCase();
    if (explicit)
        return explicit;
    const buttons = getButtonComponents(components);
    const component = buttons[index] || null;
    const inferred = normalizeText(component?.type).toLowerCase();
    return inferred || "url";
}
function stripUrlOrigin(raw) {
    const value = normalizeText(raw);
    if (!value)
        return "";
    if (!/^https?:\/\//i.test(value))
        return value;
    try {
        const parsed = new URL(value);
        return `${parsed.pathname || ""}${parsed.search || ""}${parsed.hash || ""}`;
    }
    catch {
        return value;
    }
}
function extractPublicCheckoutToken(raw) {
    const value = normalizeText(raw);
    if (!value)
        return "";
    const withoutOrigin = stripUrlOrigin(value).replace(/^\/+/, "");
    const match = withoutOrigin.match(/^public\/(?:plan|suscripcion|cart)\/(.+)$/i);
    return match?.[1] ? match[1] : "";
}
function normalizeButtonParameter(components, index, parameter) {
    const value = normalizeText(parameter);
    if (!value)
        return "";
    const button = getButtonComponents(components)[index] || null;
    const templateUrl = normalizeText(button?.url);
    const templateExpectsPublicToken = /\/public\/(?:plan|suscripcion|cart)\/\{\{\s*\d+\s*\}\}/i.test(templateUrl);
    const templateExpectsPath = /\{\{\s*\d+\s*\}\}/.test(templateUrl) && !templateExpectsPublicToken;
    const publicToken = extractPublicCheckoutToken(value);
    if (publicToken && templateExpectsPublicToken)
        return publicToken;
    if (publicToken && templateExpectsPath)
        return stripUrlOrigin(value).replace(/^\/+/, "");
    if (!templateUrl || !/\{\{\s*\d+\s*\}\}/.test(templateUrl))
        return value;
    const match = templateUrl.match(/^(.*)\{\{\s*\d+\s*\}\}(.*)$/);
    if (!match)
        return value;
    const prefix = match[1] || "";
    const suffix = match[2] || "";
    const candidates = [
        { source: value, sourcePrefix: prefix, sourceSuffix: suffix },
        { source: stripUrlOrigin(value), sourcePrefix: stripUrlOrigin(prefix), sourceSuffix: stripUrlOrigin(suffix) }
    ];
    for (const candidate of candidates) {
        if (!candidate.source)
            continue;
        if (candidate.sourcePrefix && !candidate.source.startsWith(candidate.sourcePrefix))
            continue;
        if (candidate.sourceSuffix && !candidate.source.endsWith(candidate.sourceSuffix))
            continue;
        let extracted = candidate.source;
        if (candidate.sourcePrefix)
            extracted = extracted.slice(candidate.sourcePrefix.length);
        if (candidate.sourceSuffix)
            extracted = extracted.slice(0, extracted.length - candidate.sourceSuffix.length);
        if (extracted)
            return extracted;
    }
    return value;
}
function isHeaderMediaObject(value) {
    return Boolean(normalizeText(value.media_url) ||
        normalizeText(value.media_type) ||
        normalizeText(value.media_name) ||
        normalizeText(value.link));
}
function extractProcessedParamValues(value, kind) {
    if (!value)
        return [];
    if (kind === "buttons") {
        if (Array.isArray(value)) {
            return value
                .map((entry) => {
                const rec = asRecord(entry);
                if (!rec)
                    return normalizeText(entry);
                return normalizeText(rec.parameter ?? rec.value ?? rec.text);
            })
                .filter(Boolean);
        }
        if (typeof value === "object") {
            return Object.entries(value)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, entry]) => normalizeText(entry))
                .filter(Boolean);
        }
        return [];
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => {
            const rec = asRecord(entry);
            if (!rec)
                return normalizeText(entry);
            return normalizeText(rec.value ?? rec.text);
        })
            .filter(Boolean);
    }
    const record = asRecord(value);
    if (!record)
        return [];
    if (kind === "header" && isHeaderMediaObject(record))
        return [];
    return Object.entries(record)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, entry]) => normalizeText(entry))
        .filter(Boolean);
}
function normalizeProcessedTemplateParams(processedParams, components) {
    const record = asRecord(processedParams);
    if (!record)
        return undefined;
    const next = {};
    const normalizeSlotMap = (value, preserveMedia = false) => {
        if (!value)
            return undefined;
        if (Array.isArray(value)) {
            const out = {};
            value.forEach((entry, idx) => {
                const rec = asRecord(entry);
                const slot = normalizeText(rec?.key ?? rec?.index ?? idx + 1) || String(idx + 1);
                const rendered = normalizeText(rec?.value ?? rec?.text ?? entry);
                if (rendered)
                    out[slot] = rendered;
            });
            return Object.keys(out).length ? out : undefined;
        }
        const rec = asRecord(value);
        if (!rec)
            return undefined;
        if (preserveMedia && isHeaderMediaObject(rec))
            return rec;
        const out = {};
        for (const [slot, raw] of Object.entries(rec)) {
            const rendered = normalizeText(raw);
            if (rendered)
                out[String(slot)] = rendered;
        }
        return Object.keys(out).length ? out : undefined;
    };
    const body = normalizeSlotMap(record.body);
    if (body)
        next.body = body;
    const header = normalizeSlotMap(record.header, true);
    if (header)
        next.header = header;
    if (record.buttons) {
        const rawButtons = Array.isArray(record.buttons)
            ? record.buttons
            : typeof record.buttons === "object"
                ? Object.entries(record.buttons)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([, entry]) => entry)
                : [];
        const buttons = rawButtons
            .map((entry, idx) => {
            const rec = asRecord(entry);
            const parameter = normalizeButtonParameter(components, idx, normalizeText(rec?.parameter ?? rec?.value ?? rec?.text ?? entry));
            if (!parameter)
                return null;
            return {
                type: inferButtonType(components, idx, rec?.type),
                parameter
            };
        })
            .filter(Boolean);
        if (buttons.length)
            next.buttons = buttons;
    }
    return Object.keys(next).length ? next : undefined;
}
