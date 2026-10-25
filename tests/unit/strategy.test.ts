import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  STRATEGY_NAMES,
  isStrategyName,
  parseRotationOptions,
  selectKey,
  type Candidate,
  type StrategyContext,
} from "../../src/pool/strategy.js";

process.env.LOCAL_DB_PATH = new URL("./tmp-strategy.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
delete process.env.POOL_ROTATION_STRATEGY;
delete process.env.POOL_ROTATION_OPTIONS;

const { sdb } = await import("../../src/pool/index.js");
const { nextKey } = await import("../../src/pool/rotation.js");
const { beginRequest, endRequest, inFlight } = await import("../../src/pool/inflight.js");
const env = await import("../../src/config/env.js");

function cand(id: number, over: Partial<Candidate> = {}): Candidate {
  return {
    key_id: id,
    weight: 1,
    priority: 0,
    picks: 0,
    last_used_at: 0,
    consec_fail: 0,
    latency_ms: null,
    in_flight: 0,
    ...over,
  };
}

function ctx(over: Partial<StrategyContext> = {}): StrategyContext {
  return {
    poolId: 1,
    cursor: 0,
    attempt: 0,
    now: 1_000,
    options: {},
    rng: () => 0,
    state: {},
    ...over,
  };
}

function mkPool(provider: string, name: string, strategy = ""): number {
  const r = sdb.prepare("INSERT INTO pools (provider, name, strategy) VALUES (?, ?, ?)").run(provider, name, strategy);
  return Number(r.lastInsertRowid);
}

function mkKey(poolId: number, label: string, weight = 1, priority = 0): number {
  const r = sdb
    .prepare("INSERT INTO pool_keys (pool_id, label, api_key, weight, priority) VALUES (?, ?, ?, ?, ?)")
    .run(poolId, label, `sk-${label}-${Math.random()}`, weight, priority);
  return Number(r.lastInsertRowid);
}

function labels(poolId: number, n: number): string[] {
  return Array.from({ length: n }, () => {
    const sel = nextKey(poolId);
    assert.ok(!("error" in sel), JSON.stringify(sel));
    return (sel as { label: string }).label;
  });
}

test("strategy names: every advertised name validates, typos do not", () => {
  for (const name of STRATEGY_NAMES) assert.equal(isStrategyName(name), true);
  assert.equal(isStrategyName("round_robin"), false);
  assert.equal(isStrategyName(""), false);
});

test("rotation options: defaults, merge, and malformed input", () => {
  const base = parseRotationOptions(undefined);
  assert.equal(base.ok, true);
  assert.equal(base.value["time-based"]!["everyN"], 50);

  const merged = parseRotationOptions('{"time-based":{"everyN":2},"shuffle-shard":{"shardSize":3}}');
  assert.equal(merged.ok, true);
  assert.equal(merged.value["time-based"]!["everyN"], 2);
  assert.equal(merged.value["time-based"]!["everyMs"], 30_000);
  assert.equal(merged.value["shuffle-shard"]!["shardSize"], 3);

  assert.equal(parseRotationOptions("{nope").ok, false);
  assert.equal(parseRotationOptions('["x"]').ok, false);
  assert.equal(parseRotationOptions('{"time-based":{"everyN":-1}}').ok, false);
});

test("random: deterministic from injected rng", () => {
  const list = [cand(1), cand(2), cand(3)];
  const seq = [0, 0.34, 0.67, 0.99];
  const got = seq.map((r) => selectKey("random", list, ctx({ rng: () => r })).key.key_id);
  assert.deepEqual(got, [1, 2, 3, 3]);
});

test("weighted-random: probability proportional to weight", () => {
  const list = [cand(1, { weight: 1 }), cand(2, { weight: 9 })];
  assert.equal(selectKey("weighted-random", list, ctx({ rng: () => 0.05 })).key.key_id, 1);
  assert.equal(selectKey("weighted-random", list, ctx({ rng: () => 0.5 })).key.key_id, 2);
  assert.equal(selectKey("weighted-random", list, ctx({ rng: () => 0.99 })).key.key_id, 2);
});

test("weighted-round-robin: 5:1 weights yield 5:1 picks, interleaved", () => {
  const list = [cand(1, { weight: 5, picks: 0 }), cand(2, { weight: 1, picks: 0 })];
  const order: number[] = [];
  for (let i = 0; i < 6; i++) {
    const pick = selectKey("weighted-round-robin", list, ctx()).key;
    order.push(pick.key_id);
    pick.picks += 1;
  }
  assert.deepEqual(order, [1, 2, 1, 1, 1, 1]);
  assert.equal(list[0]!.picks, 5);
  assert.equal(list[1]!.picks, 1);
});

test("least-used / LRU / least-connections pick the least loaded key", () => {
  assert.equal(selectKey("least-used", [cand(1, { picks: 3 }), cand(2, { picks: 1 })], ctx()).key.key_id, 2);
  assert.equal(selectKey("least-recently-used", [cand(1, { last_used_at: 500 }), cand(2, { last_used_at: 900 })], ctx()).key.key_id, 1);
  assert.equal(selectKey("least-connections", [cand(1, { in_flight: 2 }), cand(2, { in_flight: 1 })], ctx()).key.key_id, 2);
});

test("sticky: stable per session, state-free, round-robin without a session", () => {
  const list = [cand(1), cand(2), cand(3), cand(4)];
  const a = selectKey("sticky", list, ctx({ sticky: "user-42" })).key.key_id;
  const b = selectKey("sticky", list, ctx({ sticky: "user-42", cursor: 3 })).key.key_id;
  assert.equal(a, b);

  const sessions = Array.from({ length: 40 }, (_, i) => selectKey("sticky", list, ctx({ sticky: `u${i}` })).key.key_id);
  assert.ok(new Set(sessions).size > 1, "sessions spread across keys");

  const noSession = selectKey("sticky", list, ctx({ cursor: 1 }));
  assert.equal(noSession.key.key_id, 2);
  assert.equal(noSession.advanceCursor, true);
});

test("power-of-two: two samples, healthier wins", () => {
  const list = [cand(1, { in_flight: 5 }), cand(2, { in_flight: 0 })];
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    assert.equal(selectKey("power-of-two", list, ctx({ rng: () => r })).key.key_id, 2);
  }
});

test("tiered: best priority only, next tier when it leaves the pool", () => {
  const list = [cand(1, { priority: 0 }), cand(2, { priority: 1 })];
  assert.equal(selectKey("tiered", list, ctx({ cursor: 7 })).key.key_id, 1);
  list[0]!.priority = 2;
  assert.equal(selectKey("tiered", list, ctx()).key.key_id, 2);
});

test("shuffle-shard: stable shard per session, attempts can move it", () => {
  const list = Array.from({ length: 8 }, (_, i) => cand(i + 1));
  const first = selectKey("shuffle-shard", list, ctx({ sticky: "s1", options: { "shuffle-shard": { shardSize: 2 } } })).key.key_id;
  for (let i = 0; i < 10; i++) {
    const again = selectKey("shuffle-shard", list, ctx({ sticky: "s1", options: { "shuffle-shard": { shardSize: 2 } } })).key.key_id;
    assert.equal(again, first);
  }
  // Each attempt hashes to its own shard; at least one attempt across a wide
  // range differs, proving failover can escape a shard with two dead keys.
  const attempts = new Set(
    Array.from({ length: 20 }, (_, i) =>
      selectKey("shuffle-shard", list, ctx({ sticky: "s1", attempt: i, options: { "shuffle-shard": { shardSize: 1 } } })).key.key_id
    )
  );
  assert.ok(attempts.size > 1);
});

test("zero weight never picked while a positive weight exists", () => {
  const list = [cand(1, { weight: 0 }), cand(2, { weight: 1 })];
  for (const name of ["round-robin", "random", "weighted-random", "weighted-round-robin", "least-used"] as const) {
    for (let i = 0; i < 6; i++) {
      assert.equal(selectKey(name, list, ctx({ cursor: i, rng: () => 0.5 })).key.key_id, 2, name);
    }
  }
  // All-zero degrades to uniform instead of failing.
  const zero = [cand(1, { weight: 0 }), cand(2, { weight: 0 })];
  assert.equal(selectKey("weighted-random", zero, ctx({ rng: () => 0.9 })).key.key_id, 2);
});

test("time-based: parks for everyN then rotates", () => {
  const list = [cand(1), cand(2)];
  const options = { "time-based": { everyMs: 60_000, everyN: 2 } };
  let state: Record<string, unknown> = {};
  let cursor = 0;
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sel = selectKey("time-based", list, ctx({ options, state, cursor, now: 1_000 + i }));
    seen.push(sel.key.key_id);
    state = sel.state!;
    if (sel.advanceCursor) cursor++;
  }
  assert.deepEqual(seen, [1, 1, 2, 2]);
});

test("health-aware: clean keys first, all-flaky falls back", () => {
  const list = [cand(1, { consec_fail: 2 }), cand(2, { consec_fail: 0 })];
  assert.equal(selectKey("health-aware", list, ctx({ options: { "health-aware": { breakerAfter: 2 } } })).key.key_id, 2);
  list[1]!.consec_fail = 2;
  const sel = selectKey("health-aware", list, ctx({ options: { "health-aware": { breakerAfter: 2 } } }));
  assert.ok([1, 2].includes(sel.key.key_id));
});

test("integration: pool.strategy drives nextKey", () => {
  const pid = mkPool("custom", "random-pool", "random");
  mkKey(pid, "a");
  mkKey(pid, "b");
  assert.equal((nextKey(pid, { rng: () => 0 }) as { label: string }).label, "a");
  assert.equal((nextKey(pid, { rng: () => 0.99 }) as { label: string }).label, "b");
});

test("integration: sticky overrides the pool strategy and does not advance the cursor", () => {
  const pid = mkPool("custom", "sticky-pool", "round-robin");
  mkKey(pid, "a");
  mkKey(pid, "b");
  const first = nextKey(pid, { sticky: "session-1" }) as { label: string; key_id: number };
  const second = nextKey(pid, { sticky: "session-1" }) as { label: string; key_id: number };
  assert.equal(second.key_id, first.key_id);
  const cursor = (sdb.prepare("SELECT cursor FROM pools WHERE id = ?").get(pid) as { cursor: number }).cursor;
  assert.equal(cursor, 0);
});

test("integration: no session key falls back to round-robin on a sticky pool", () => {
  const pid = mkPool("custom", "sticky-fallback", "sticky");
  mkKey(pid, "a");
  mkKey(pid, "b");
  assert.deepEqual(labels(pid, 3), ["a", "b", "a"]);
});

test("integration: tiered fails over when the preferred tier is cooling", () => {
  const pid = mkPool("custom", "tiered-pool", "tiered");
  const free = mkKey(pid, "free", 1, 0);
  mkKey(pid, "paid", 1, 1);
  assert.equal((nextKey(pid) as { label: string }).label, "free");
  sdb.prepare("UPDATE pool_keys SET cooldown_until = ? WHERE id = ?").run(Date.now() + 60_000, free);
  assert.equal((nextKey(pid) as { label: string }).label, "paid");
});

test("integration: least-connections sees in-flight proxy requests", () => {
  const pid = mkPool("custom", "conn-pool", "least-connections");
  const a = mkKey(pid, "a");
  mkKey(pid, "b");
  beginRequest(a);
  assert.equal(inFlight(a), 1);
  assert.equal((nextKey(pid) as { label: string }).label, "b");
  endRequest(a);
  assert.equal(inFlight(a), 0);
});

test("integration: time-based state persists in the pool row", () => {
  process.env.POOL_ROTATION_OPTIONS = '{"time-based":{"everyMs":60000,"everyN":2}}';
  const pid = mkPool("custom", "park-pool", "time-based");
  mkKey(pid, "a");
  mkKey(pid, "b");
  assert.deepEqual(labels(pid, 4), ["a", "a", "b", "b"]);
  const state = (sdb.prepare("SELECT strategy_state FROM pools WHERE id = ?").get(pid) as { strategy_state: string }).strategy_state;
  assert.ok(state.includes("timeBase"));
  delete process.env.POOL_ROTATION_OPTIONS;
});

test("env: rotation strategy defaults, overrides, and rejects typos", () => {
  delete process.env.POOL_ROTATION_STRATEGY;
  assert.equal(env.rotationStrategy(), "round-robin");
  process.env.POOL_ROTATION_STRATEGY = "least-used";
  assert.equal(env.rotationStrategy(), "least-used");
  process.env.POOL_ROTATION_STRATEGY = "least_used";
  assert.throws(() => env.rotationStrategy(), /invalid/);
  delete process.env.POOL_ROTATION_STRATEGY;
});

test.after(() => {
  delete process.env.POOL_ROTATION_STRATEGY;
  delete process.env.POOL_ROTATION_OPTIONS;
});
