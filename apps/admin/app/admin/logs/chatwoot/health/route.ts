import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";
import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    return Response.json({ ok: false, error: "chatwoot_not_configured" }, { status: 503 });
  }

  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });

  const out: {
    ok: boolean;
    accountOk: boolean;
    inboxOk: boolean;
    baseUrl: string;
    accountId: number;
    inboxId: number;
    accountError?: string;
    inboxError?: string;
  } = {
    ok: false,
    accountOk: false,
    inboxOk: false,
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    inboxId: cfg.inboxId
  };

  try {
    await client.getAccount();
    out.accountOk = true;
  } catch (err: any) {
    out.accountError = String(err?.message || err || "account_check_failed");
  }

  try {
    await client.getInbox(cfg.inboxId);
    out.inboxOk = true;
  } catch (err: any) {
    out.inboxError = String(err?.message || err || "inbox_check_failed");
  }

  out.ok = out.accountOk && out.inboxOk;
  return Response.json(out, { status: out.ok ? 200 : 502 });
}
