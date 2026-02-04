import { CredentialProvider } from "@prisma/client";
import { loadEnv } from "../config/env";
import { getCredential } from "./credentials";

export async function getWompiEventsSecret(): Promise<string | undefined> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "EVENTS_SECRET");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return (env.WOMPI_EVENTS_SECRET || "").trim() || undefined;
}

export async function getWompiPublicKey(): Promise<string | undefined> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "PUBLIC_KEY");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return (env.WOMPI_PUBLIC_KEY || "").trim() || undefined;
}

export async function getWompiPrivateKey(): Promise<string | undefined> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "PRIVATE_KEY");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return (env.WOMPI_PRIVATE_KEY || "").trim() || undefined;
}

export async function getWompiIntegritySecret(): Promise<string | undefined> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "INTEGRITY_SECRET");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return (env.WOMPI_INTEGRITY_SECRET || "").trim() || undefined;
}

export async function getWompiApiBaseUrl(): Promise<string> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "API_BASE_URL");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return env.WOMPI_API_BASE_URL;
}

export async function getWompiCheckoutLinkBaseUrl(): Promise<string> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "CHECKOUT_LINK_BASE_URL");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return env.WOMPI_CHECKOUT_LINK_BASE_URL;
}

export async function getWompiRedirectUrl(): Promise<string | undefined> {
  const fromDb = await getCredential(CredentialProvider.WOMPI, "REDIRECT_URL");
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  return (env.WOMPI_REDIRECT_URL || "").trim() || undefined;
}

export async function getShopifyForward(): Promise<{ url?: string; secret?: string }> {
  const url = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_URL")) || loadEnv(process.env).SHOPIFY_FORWARD_URL || "";
  const secret =
    (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET")) || loadEnv(process.env).SHOPIFY_FORWARD_SECRET || "";
  return { url: url.trim() || undefined, secret: secret.trim() || undefined };
}

export async function getChatwootConfig(): Promise<
  | { configured: false }
  | { configured: true; baseUrl: string; accountId: number; apiAccessToken: string; inboxId: number }
> {
  const env = loadEnv(process.env);
  const baseUrl = (await getCredential(CredentialProvider.CHATWOOT, "BASE_URL")) || env.CHATWOOT_BASE_URL || "";
  const accessToken =
    (await getCredential(CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN")) || env.CHATWOOT_API_ACCESS_TOKEN || "";
  const accountIdStr = (await getCredential(CredentialProvider.CHATWOOT, "ACCOUNT_ID")) || (env.CHATWOOT_ACCOUNT_ID ? String(env.CHATWOOT_ACCOUNT_ID) : "");
  const inboxIdStr = (await getCredential(CredentialProvider.CHATWOOT, "INBOX_ID")) || (env.CHATWOOT_INBOX_ID ? String(env.CHATWOOT_INBOX_ID) : "");

  const accountId = Number(accountIdStr);
  const inboxId = Number(inboxIdStr);

  if (!baseUrl.trim() || !accessToken.trim() || !Number.isFinite(accountId) || !Number.isFinite(inboxId)) return { configured: false };
  return { configured: true, baseUrl: baseUrl.trim(), apiAccessToken: accessToken.trim(), accountId, inboxId };
}
