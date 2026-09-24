import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-quota.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb, poolSummary } = await import("../../src/pool/index.js");
const { recordUsage } = await import("../../src/pool/rotation.js");

test("cartesia remaining = quota * keys - used", () => {
  const p = sdb.prepare("INSERT INTO pools (provider, name) VALUES ('cartesia','q')").run();
  const pid = Number(p.lastInsertRowid);
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
  const p = sdb.prepare("INSERT INTO pools (provider, name) VALUES ('custom','q2')").run();
  const pid = Number(p.lastInsertRowid);
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k1', 'a')").run(pid);
  const s = poolSummary(pid);
  assert.ok(s);
  assert.equal(s.quota, null);
  assert.equal(s.remaining, null);
});
