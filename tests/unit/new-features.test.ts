import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-newfeatures.db", import.meta.url).pathname;
try { fs.unlinkSync(process.env.LOCAL_DB_PATH); } catch {}
process.env.ALLOW_PRIVATE_UPSTREAM = "";

const { requiresAuth, isAuthorized } = await import("../../src/middleware/auth.js");
const { resolveAndCheck } = await import("../../src/proxy/dns.js");
const { normalizeCredentials, providerKeyFields, QUOTA_DAILY, quotaLimitsForProvider } = await import("../../src/pool/index.js");
const { effectiveApiKey } = await import("../../src/upstream/index.js");
const { matchPoolRoute, matchKeyRoute } = await import("../../src/router/api.js");
const { health, readiness } = await import("../../src/observability/health.js");

test("auth: raw key + writes require auth, masked reads do not", () => {
  assert.equal(requiresAuth("GET", "/api/pools/1/keys/2"), true);
  assert.equal(requiresAuth("POST", "/api/pools"), true);
  assert.equal(requiresAuth("PATCH", "/api/pools/1/keys/2"), true);
  assert.equal(requiresAuth("DELETE", "/api/pools/1"), true);
  assert.equal(requiresAuth("POST", "/api/pools/1/proxy"), true);
  assert.equal(requiresAuth("POST", "/api/pools/1/consume"), true);
  assert.equal(requiresAuth("GET", "/api/pools/1/next"), true);
  assert.equal(requiresAuth("GET", "/api/providers"), false);
  assert.equal(requiresAuth("GET", "/api/pools"), false);
  assert.equal(requiresAuth("GET", "/api/pools/1/keys"), false);
});

test("auth: open when token unset, enforced when set", async () => {
  delete process.env.POOL_API_TOKEN;
  assert.equal(isAuthorized({ headers: {} } as never), true);
  process.env.POOL_API_TOKEN = "test-token-1234567890";
  assert.equal(isAuthorized({ headers: {} } as never), false);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer wrong" } } as never), false);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer test-token-1234567890" } } as never), true);
  delete process.env.POOL_API_TOKEN;
});

test("dns: localhost + private literals blocked, single-label blocked", async () => {
  assert.deepEqual(await resolveAndCheck("localhost"), { ok: false, error: "upstream host blocked" });
  assert.deepEqual(await resolveAndCheck("127.0.0.1"), { ok: false, error: "upstream host blocked" });
  assert.deepEqual(await resolveAndCheck("127.0.0.1."), { ok: false, error: "upstream host blocked" });
  const r = await resolveAndCheck("intranet");
  assert.equal(r.ok, false);
});

test("multi-field: provider fields + validation", () => {
  assert.deepEqual(providerKeyFields("twilio"), ["accountSid", "authToken"]);
  assert.deepEqual(providerKeyFields("supabase"), ["url", "anonKey"]);
  assert.deepEqual(providerKeyFields("groq"), ["api_key"]);
  const bad = normalizeCredentials("twilio", { accountSid: "AC123" });
  assert.equal(bad.ok, false);
  const good = normalizeCredentials("twilio", { accountSid: "AC123", authToken: "tok" });
  assert.equal(good.ok, true);
});

test("multi-field: twilio synthesizes Basic", () => {
  const k = { api_key: "tok", credentials: JSON.stringify({ accountSid: "AC1", authToken: "T2" }) };
  assert.equal(effectiveApiKey({ provider: "twilio" }, k), Buffer.from("AC1:T2").toString("base64"));
  assert.equal(effectiveApiKey({ provider: "groq" }, { api_key: "gsk_x", credentials: "{}" }), "gsk_x");
});

test("daily quotas: limits table + enforcement", async () => {
  assert.ok(QUOTA_DAILY["sendgrid"] === 100);
  assert.ok(quotaLimitsForProvider("sendgrid").some((l) => l.window === "day" && l.limit === 100));
  assert.ok(quotaLimitsForProvider("resend").length === 2);
  const { sdb } = await import("../../src/pool/index.js");
  const { nextKey } = await import("../../src/pool/rotation.js");
  const pid = Number(sdb.prepare("INSERT INTO pools (provider, name) VALUES ('sendgrid','d')").run().lastInsertRowid);
  const kid = Number(sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k','SG.x')").run(pid).lastInsertRowid);
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(pid, kid, 100);
  const sel = nextKey(pid);
  assert.equal((sel as { error: string }).error, "all keys cooling down or quota-exhausted");
});

test("router matchers + health", () => {
  assert.deepEqual(matchPoolRoute("/api/pools/1/next"), { poolId: 1, sub: "/next" });
  assert.deepEqual(matchPoolRoute("/api/pools/1/keys"), null);
  assert.deepEqual(matchKeyRoute("/api/pools/1/keys/2"), { poolId: 1, keyId: 2 });
  assert.deepEqual(matchKeyRoute("/api/pools/1/keys"), { poolId: 1, keyId: null });
  assert.equal(health().status, 200);
  assert.equal(readiness().status, 200);
});
