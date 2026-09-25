import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-quota.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb, poolSummary, QUOTA, QUOTA_WINDOW, quotaForProvider } = await import("../../src/pool/index.js");
const { recordUsage, nextKey } = await import("../../src/pool/rotation.js");

function mkPool(provider: string): number {
  const p = sdb.prepare("INSERT INTO pools (provider, name) VALUES (?, ?)").run(provider, "q");
  return Number(p.lastInsertRowid);
}
function mkKey(poolId: number, label: string): number {
  const r = sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, ?, ?)").run(poolId, label, "sk-" + label);
  return Number(r.lastInsertRowid);
}

test("cartesia remaining = quota * keys - used", () => {
  const pid = mkPool("cartesia");
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k1', 'a')").run(pid);
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k2', 'b')").run(pid);
  recordUsage(pid, 500);
  const s = poolSummary(pid);
  assert.ok(s);
  assert.equal(s.quota, 20000);
  assert.equal(s.used, 500);
  assert.equal(s.remaining, 20000 * 2 - 500);
});

test("custom quota is null (unlimited)", () => {
  const pid = mkPool("custom");
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k1', 'a')").run(pid);
  const s = poolSummary(pid);
  assert.ok(s);
  assert.equal(s.quota, null);
  assert.equal(s.remaining, null);
});

test("every provider id has a documented quota decision", async () => {
  const { PROVIDERS } = await import("../../src/pool/index.js");
  for (const p of PROVIDERS) {
    assert.ok(p.id in QUOTA, `missing QUOTA entry for ${p.id}`);
    assert.ok(p.id in QUOTA_WINDOW, `missing QUOTA_WINDOW entry for ${p.id}`);
  }
});

test("countable quotas enforce remaining = limit * keys - used", () => {
  const countable = Object.entries(QUOTA).filter(([, v]) => v !== null) as [string, number][];
  assert.ok(countable.length >= 10, `expected >= 10 countable quotas, got ${countable.length}`);
  for (const [provider, limit] of countable) {
    const pid = mkPool(provider);
    mkKey(pid, "k1");
    mkKey(pid, "k2");
    recordUsage(pid, 100);
    const s = poolSummary(pid)!;
    assert.equal(s.quota, limit, provider);
    const window = QUOTA_WINDOW[provider];
    assert.ok(window === "month" || window === "all", provider);
    assert.equal(s.remaining, limit * 2 - 100, `${provider} (${window})`);
  }
});

test("monthly quota resets: last-month usage does not exhaust", () => {
  const pid = mkPool("tavily"); // 1000/mo
  const kid = mkKey(pid, "k1");
  // Backdate usage into last month: over quota, but outside the window.
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens, created_at) VALUES (?, ?, ?, date('now','start of month','-1 day'))").run(pid, kid, 5000);
  const s = poolSummary(pid)!;
  assert.equal(s.remaining, 1000);
  assert.equal(s.used, 5000, "used stays all-time");
  assert.equal(s.usedInWindow, 0, "windowed total resets each month");
  const sel = nextKey(pid);
  assert.ok(!("error" in sel), "key must be eligible in the new month");
});

test("lifetime quota stays exhausted across months", () => {
  const pid = mkPool("cartesia");
  const kid = mkKey(pid, "k1");
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens, created_at) VALUES (?, ?, ?, date('now','start of month','-1 day'))").run(pid, kid, 20000);
  const sel = nextKey(pid);
  assert.equal((sel as { error: string }).error, "all keys cooling down or quota-exhausted");
});

test("unknown provider quota is null (unlimited)", () => {
  assert.deepEqual(quotaForProvider("no-such-provider"), { limit: null, window: "all" });
  const pid = mkPool("no-such-provider");
  mkKey(pid, "k1");
  recordUsage(pid, 10 ** 9);
  const s = poolSummary(pid)!;
  assert.equal(s.quota, null);
  assert.equal(s.remaining, null);
});
