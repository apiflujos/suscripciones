type TemplateComponent = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getButtonComponents(components?: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(components) ? components : [];
  const buttonsBlock = list.find(
    (entry) => String(asRecord(entry)?.type || "").trim().toUpperCase() === "BUTTONS"
  );
  const rawButtons = Array.isArray(asRecord(buttonsBlock)?.buttons) ? (asRecord(buttonsBlock)?.buttons as unknown[]) : [];
  return rawButtons.map((entry) => asRecord(entry) || {}).filter(Boolean);
}

function inferButtonType(components: unknown, index: number, fallback?: unknown): string {
  const explicit = normalizeText(fallback).toLowerCase();
  if (explicit) return explicit;
  const buttons = getButtonComponents(components);
  const component = buttons[index] || null;
  const inferred = normalizeText(component?.type).toLowerCase();
  return inferred || "url";
}

function normalizeButtonParameter(components: unknown, index: number, parameter: string): string {
  const value = normalizeText(parameter);
  if (!value) return "";
  const button = getButtonComponents(components)[index] || null;
  const templateUrl = normalizeText(button?.url);
  if (!templateUrl || !/\{\{\s*\d+\s*\}\}/.test(templateUrl)) return value;

  const match = templateUrl.match(/^(.*)\{\{\s*\d+\s*\}\}(.*)$/);
  if (!match) return value;
  const prefix = match[1] || "";
  const suffix = match[2] || "";
  if (!/^https?:\/\//i.test(value)) return value;
  if (prefix && !value.startsWith(prefix)) return value;
  if (suffix && !value.endsWith(suffix)) return value;

  let extracted = value;
  if (prefix) extracted = extracted.slice(prefix.length);
  if (suffix) extracted = extracted.slice(0, extracted.length - suffix.length);
  return extracted || value;
}

function isHeaderMediaObject(value: Record<string, unknown>) {
  return Boolean(
    normalizeText(value.media_url) ||
      normalizeText(value.media_type) ||
      normalizeText(value.media_name) ||
      normalizeText(value.link)
  );
}

export function extractProcessedParamValues(
  value: unknown,
  kind: "body" | "header" | "buttons"
): string[] {
  if (!value) return [];
  if (kind === "buttons") {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          const rec = asRecord(entry);
          if (!rec) return normalizeText(entry);
          return normalizeText(rec.parameter ?? rec.value ?? rec.text);
        })
        .filter(Boolean);
    }
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
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
        if (!rec) return normalizeText(entry);
        return normalizeText(rec.value ?? rec.text);
      })
      .filter(Boolean);
  }

  const record = asRecord(value);
  if (!record) return [];
  if (kind === "header" && isHeaderMediaObject(record)) return [];
  return Object.entries(record)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, entry]) => normalizeText(entry))
    .filter(Boolean);
}

export function normalizeProcessedTemplateParams(
  processedParams: unknown,
  components?: unknown
): Record<string, unknown> | undefined {
  const record = asRecord(processedParams);
  if (!record) return undefined;

  const next: Record<string, unknown> = {};

  const normalizeSlotMap = (value: unknown, preserveMedia = false) => {
    if (!value) return undefined;
    if (Array.isArray(value)) {
      const out: Record<string, string> = {};
      value.forEach((entry, idx) => {
        const rec = asRecord(entry);
        const slot = normalizeText(rec?.key ?? rec?.index ?? idx + 1) || String(idx + 1);
        const rendered = normalizeText(rec?.value ?? rec?.text ?? entry);
        if (rendered) out[slot] = rendered;
      });
      return Object.keys(out).length ? out : undefined;
    }
    const rec = asRecord(value);
    if (!rec) return undefined;
    if (preserveMedia && isHeaderMediaObject(rec)) return rec;
    const out: Record<string, string> = {};
    for (const [slot, raw] of Object.entries(rec)) {
      const rendered = normalizeText(raw);
      if (rendered) out[String(slot)] = rendered;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const body = normalizeSlotMap(record.body);
  if (body) next.body = body;

  const header = normalizeSlotMap(record.header, true);
  if (header) next.header = header;

  if (record.buttons) {
    const rawButtons = Array.isArray(record.buttons)
      ? record.buttons
      : typeof record.buttons === "object"
        ? Object.entries(record.buttons as Record<string, unknown>)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, entry]) => entry)
        : [];
    const buttons = rawButtons
      .map((entry, idx) => {
        const rec = asRecord(entry);
        const parameter = normalizeButtonParameter(
          components,
          idx,
          normalizeText(rec?.parameter ?? rec?.value ?? rec?.text ?? entry)
        );
        if (!parameter) return null;
        return {
          type: inferButtonType(components, idx, rec?.type),
          parameter
        };
      })
      .filter(Boolean);
    if (buttons.length) next.buttons = buttons;
  }

  return Object.keys(next).length ? next : undefined;
}
