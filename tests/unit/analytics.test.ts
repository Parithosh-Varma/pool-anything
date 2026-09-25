import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-analytics.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb, getAnalytics } = await import("../../src/pool/index.js");

test("analytics totals + 14-day series", () => {
  const p = sdb.prepare("INSERT INTO pools (provider, name) VALUES ('custom','a')").run();
  const pid = Number(p.lastInsertRowid);
  const k = sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k1', 'x')").run(pid);
  const kid = Number(k.lastInsertRowid);
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(pid, kid, 25);
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(pid, kid, 10);
  const a = getAnalytics();
  assert.equal(a.requests, 2);
  assert.equal(a.tokens, 35);
  assert.equal(a.pools, 1);
  assert.equal(a.keys, 1);
  assert.equal(a.series.length, 14);
  assert.equal(a.keysSeries.length, 14);
  assert.equal(a.poolsSeries.length, 14);
  assert.equal(a.cooling, 0);
  assert.equal(a.avgTokens, 17.5);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(a.series[13].day, today);
  assert.equal(a.series[13].requests, 2);
});

test("empty pools are not counted", () => {
  sdb.prepare("INSERT INTO pools (provider, name) VALUES ('groq','empty')").run();
  const a = getAnalytics();
  assert.equal(a.pools, 1, "keyless pool must not count");
  assert.equal(a.poolsSeries.reduce((t, p) => t + p.count, 0), 1, "series must not count it either");
});
