import express from "express";
import { z } from "zod";
import { CredentialProvider, LogLevel } from "@prisma/client";
import { getCredential, setCredential } from "../services/credentials";
import { systemLog } from "../services/systemLog";

function maskSecret(value: string | undefined) {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 4) return "****";
  return `${"*".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

async function getOrEnv(provider: CredentialProvider, key: string, envVal: string | undefined) {
  const fromDb = await getCredential(provider, key);
  return (fromDb ?? (envVal || "").trim()) || undefined;
}

const wompiUpdateSchema = z.object({
  publicKey: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  integritySecret: z.string().min(1).optional(),
  eventsSecret: z.string().min(1).optional(),
  apiBaseUrl: z.string().url().optional(),
  checkoutLinkBaseUrl: z.string().url().optional(),
  redirectUrl: z.string().url().optional().or(z.literal(""))
});

const shopifyUpdateSchema = z.object({
  forwardUrl: z.string().url().optional().or(z.literal("")),
  forwardSecret: z.string().optional().or(z.literal(""))
});

const chatwootUpdateSchema = z.object({
  baseUrl: z.string().url().optional().or(z.literal("")),
  accountId: z.coerce.number().int().positive().optional(),
  apiAccessToken: z.string().optional().or(z.literal("")),
  inboxId: z.coerce.number().int().positive().optional()
});

export const settingsRouter = express.Router();

settingsRouter.get("/", async (_req, res) => {
  const wompiPublicKey = await getOrEnv(CredentialProvider.WOMPI, "PUBLIC_KEY", process.env.WOMPI_PUBLIC_KEY);
  const wompiPrivateKey = await getOrEnv(CredentialProvider.WOMPI, "PRIVATE_KEY", process.env.WOMPI_PRIVATE_KEY);
  const wompiIntegritySecret = await getOrEnv(
    CredentialProvider.WOMPI,
    "INTEGRITY_SECRET",
    process.env.WOMPI_INTEGRITY_SECRET
  );
  const wompiEventsSecret = await getOrEnv(CredentialProvider.WOMPI, "EVENTS_SECRET", process.env.WOMPI_EVENTS_SECRET);
  const wompiApiBaseUrl = await getOrEnv(CredentialProvider.WOMPI, "API_BASE_URL", process.env.WOMPI_API_BASE_URL);
  const wompiCheckoutLinkBaseUrl = await getOrEnv(
    CredentialProvider.WOMPI,
    "CHECKOUT_LINK_BASE_URL",
    process.env.WOMPI_CHECKOUT_LINK_BASE_URL
  );
  const wompiRedirectUrl = await getOrEnv(CredentialProvider.WOMPI, "REDIRECT_URL", process.env.WOMPI_REDIRECT_URL);

  const shopifyForwardUrl = await getOrEnv(CredentialProvider.SHOPIFY, "FORWARD_URL", process.env.SHOPIFY_FORWARD_URL);

  const chatwootBaseUrl = await getOrEnv(CredentialProvider.CHATWOOT, "BASE_URL", process.env.CHATWOOT_BASE_URL);
  const chatwootAccountId = await getOrEnv(
    CredentialProvider.CHATWOOT,
    "ACCOUNT_ID",
    process.env.CHATWOOT_ACCOUNT_ID ? String(process.env.CHATWOOT_ACCOUNT_ID) : undefined
  );
  const chatwootInboxId = await getOrEnv(
    CredentialProvider.CHATWOOT,
    "INBOX_ID",
    process.env.CHATWOOT_INBOX_ID ? String(process.env.CHATWOOT_INBOX_ID) : undefined
  );

  res.json({
    encryptionKeyConfigured: !!(process.env.CREDENTIALS_ENCRYPTION_KEY_B64 || "").trim(),
    wompi: {
      publicKey: wompiPublicKey ?? null,
      privateKey: maskSecret(wompiPrivateKey),
      integritySecret: maskSecret(wompiIntegritySecret),
      eventsSecret: maskSecret(wompiEventsSecret),
      apiBaseUrl: wompiApiBaseUrl ?? null,
      checkoutLinkBaseUrl: wompiCheckoutLinkBaseUrl ?? null,
      redirectUrl: wompiRedirectUrl ?? null
    },
    shopify: {
      forwardUrl: shopifyForwardUrl ?? null
    },
    chatwoot: {
      baseUrl: chatwootBaseUrl ?? null,
      accountId: chatwootAccountId ?? null,
      inboxId: chatwootInboxId ?? null
    }
  });
});

settingsRouter.put("/wompi", async (req, res) => {
  const parsed = wompiUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const { publicKey, privateKey, integritySecret, eventsSecret, apiBaseUrl, checkoutLinkBaseUrl, redirectUrl } = parsed.data;

  try {
    if (publicKey) await setCredential(CredentialProvider.WOMPI, "PUBLIC_KEY", publicKey);
    if (privateKey) await setCredential(CredentialProvider.WOMPI, "PRIVATE_KEY", privateKey);
    if (integritySecret) await setCredential(CredentialProvider.WOMPI, "INTEGRITY_SECRET", integritySecret);
    if (eventsSecret) await setCredential(CredentialProvider.WOMPI, "EVENTS_SECRET", eventsSecret);
    if (apiBaseUrl) await setCredential(CredentialProvider.WOMPI, "API_BASE_URL", apiBaseUrl);
    if (checkoutLinkBaseUrl) await setCredential(CredentialProvider.WOMPI, "CHECKOUT_LINK_BASE_URL", checkoutLinkBaseUrl);
    if (redirectUrl != null) await setCredential(CredentialProvider.WOMPI, "REDIRECT_URL", redirectUrl);
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "settings.wompi", "Wompi settings updated").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.put("/shopify", async (req, res) => {
  const parsed = shopifyUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    if (parsed.data.forwardUrl != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_URL", parsed.data.forwardUrl);
    if (parsed.data.forwardSecret != null)
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET", parsed.data.forwardSecret);
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "settings.shopify", "Shopify settings updated").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.put("/chatwoot", async (req, res) => {
  const parsed = chatwootUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    if (parsed.data.baseUrl != null) await setCredential(CredentialProvider.CHATWOOT, "BASE_URL", parsed.data.baseUrl);
    if (parsed.data.accountId != null) await setCredential(CredentialProvider.CHATWOOT, "ACCOUNT_ID", String(parsed.data.accountId));
    if (parsed.data.apiAccessToken != null)
      await setCredential(CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN", parsed.data.apiAccessToken);
    if (parsed.data.inboxId != null) await setCredential(CredentialProvider.CHATWOOT, "INBOX_ID", String(parsed.data.inboxId));
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "settings.chatwoot", "Chatwoot settings updated").catch(() => {});
  res.json({ ok: true });
});
