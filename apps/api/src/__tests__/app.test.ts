import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../app";

type EnvSnapshot = Record<string, string | undefined>;

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: EnvSnapshot = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  const out = Promise.resolve(fn());
  return out.finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("healthz: returns ok without DB", async () => {
  const app = createApp();
  const res = await request(app).get("/healthz");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("chatwoot webhook: requires token in production", async () =>
  withEnv({ NODE_ENV: "production", CHATWOOT_WEBHOOK_TOKEN: "" }, async () => {
    const app = createApp();
    const res = await request(app).post("/webhooks/chatwoot").send({});
    assert.equal(res.status, 503);
    assert.equal(res.body?.error, "chatwoot_webhook_token_not_configured");
  }));

test("admin auth login: rate limit triggers after max attempts", async () =>
  withEnv({ ADMIN_API_TOKEN: "testtoken" }, async () => {
    const app = createApp();
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post("/admin/auth/login")
        .set("x-admin-token", "testtoken")
        .send({});
      assert.equal(res.status, 400);
    }
    const blocked = await request(app)
      .post("/admin/auth/login")
      .set("x-admin-token", "testtoken")
      .send({});
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error, "rate_limited");
  }));
