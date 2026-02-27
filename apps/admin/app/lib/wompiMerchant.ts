export type WompiAcceptanceLinks = {
  termsUrl: string;
  personalDataUrl: string;
};

export async function fetchWompiAcceptanceLinks(args: {
  apiBaseUrl: string;
  publicKey: string;
}): Promise<WompiAcceptanceLinks | null> {
  const apiBaseUrl = String(args.apiBaseUrl || "").trim();
  const publicKey = String(args.publicKey || "").trim();
  if (!apiBaseUrl || !publicKey) return null;
  const base = apiBaseUrl.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/merchants/${encodeURIComponent(publicKey)}`, { cache: "no-store" });
  } catch {
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) return null;
  const termsUrl = String(json?.data?.presigned_acceptance?.permalink || "").trim();
  const personalDataUrl = String(json?.data?.presigned_personal_data_auth?.permalink || "").trim();
  if (!termsUrl || !personalDataUrl) return null;
  return { termsUrl, personalDataUrl };
}
