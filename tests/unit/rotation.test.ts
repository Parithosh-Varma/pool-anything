import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-rotation.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb } = await import("../../src/pool/index.js");
const { nextKey, markFailure, recordUsage } = await import("../../src/pool/rotation.js");

function mkPool(provider: string, name: string): number {
  const r = sdb.prepare("INSERT INTO pools (provider, name) VALUES (?, ?)").run(provider, name);
  return Number(r.lastInsertRowid);
}
function mkKey(poolId: number, label: string): number {
  const r = sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, ?, ?)").run(poolId, label, "sk-" + label);
  return Number(r.lastInsertRowid);
}

test("round-robin cycles key1, key2, key3, key1", () => {
  const pid = mkPool("custom", "rr");
  ["key 1", "key 2", "key 3"].forEach((l) => mkKey(pid, l));
  const got = [nextKey(pid), nextKey(pid), nextKey(pid), nextKey(pid)].map((s) => {
    assert.ok(!("error" in s));
    return (s as { label: string }).label;
  });
  assert.deepEqual(got, ["key 1", "key 2", "key 3", "key 1"]);
});

test("empty pool errors", () => {
  const pid = mkPool("custom", "empty");
  assert.equal((nextKey(pid) as { error: string }).error, "pool has no keys");
});

test("failed key cools down and rejoins after", () => {
  const pid = mkPool("custom", "cool");
  const a = mkKey(pid, "key 1");
  mkKey(pid, "key 2");
  markFailure(a);
  const first = nextKey(pid) as { label: string };
  assert.equal(first.label, "key 2");
  sdb.prepare("UPDATE pool_keys SET cooldown_until = 0 WHERE id = ?").run(a);
  const labels = [nextKey(pid), nextKey(pid)].map((s) => (s as { label: string }).label);
  assert.ok(labels.includes("key 1"));
});

test("quota-exhausted key is skipped (cartesia 20k)", () => {
  const pid = mkPool("cartesia", "quota");
  mkKey(pid, "key 1");
  mkKey(pid, "key 2");
  const r = recordUsage(pid, 20000);
  assert.equal((r as { label: string }).label, "key 1");
  const next = nextKey(pid) as { label: string };
  assert.equal(next.label, "key 2");
  const next2 = nextKey(pid) as { label: string };
  assert.equal(next2.label, "key 2");
});
