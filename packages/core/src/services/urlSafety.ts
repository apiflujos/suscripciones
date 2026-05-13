import { normalizePublicUrl } from "./publicBase";

export function normalizeRenderablePublicUrl(raw?: string | null) {
  return normalizePublicUrl(raw, { allowLocalhost: false });
}
