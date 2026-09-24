import { sdb, QUOTA, getPool, mask } from "./index.js";

export type KeyRow = {
  key_id: number;
  label: string;
  api_key: string;
  info: string;
  used: number;
};

function quotaFor(provider: string): number | null {
  return QUOTA[provider] ?? null;
}

/** Eligible keys: not cooling down, quota not exhausted. Ordered by latency (unknown first), id. */
export function eligibleKeys(poolId: number): (KeyRow & { masked: string })[] {
  const pool = getPool(poolId);
  if (!pool) return [];
  const now = Date.now();
  const rows = sdb
    .prepare(
      `SELECT k.id AS key_id, k.label, k.api_key, k.info, COALESCE(SUM(u.tokens),0) AS used
       FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id
       WHERE k.pool_id = ? AND k.cooldown_until <= ?
       GROUP BY k.id ORDER BY k.latency_ms ASC, k.id ASC`
    )
    .all(poolId, now) as (KeyRow & { latency_ms: number | null })[];
  const quota = quotaFor(pool.provider);
  return rows
    .filter((k) => quota === null || k.used < quota)
    .map(({ latency_ms: _l, ...k }) => ({ ...k, masked: mask(k.api_key) }));
}

function advance(poolId: number): void {
  sdb.prepare("UPDATE pools SET cursor = cursor + 1 WHERE id = ?").run(poolId);
}

/** Round-robin over eligible keys. Raw key stays server-side; use nextKey for the masked form. */
export function nextKeyRaw(poolId: number) {
  const pool = getPool(poolId);
  if (!pool) return { error: "pool not found" } as const;
  const keys = eligibleKeys(poolId);
  if (keys.length === 0) {
    const total = sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(poolId) as { n: number };
    if (total.n === 0) return { error: "pool has no keys" } as const;
    return { error: "all keys cooling down or quota-exhausted" } as const;
  }
  const pick = keys[pool.cursor % keys.length];
  advance(poolId);
  return pick;
}

export function nextKey(poolId: number) {
  const sel = nextKeyRaw(poolId);
  if ("error" in sel) return sel;
  const { api_key: _raw, ...masked } = sel;
  return masked;
}

export function recordUsage(poolId: number, tokens: number) {
  const sel = nextKey(poolId);
  if ("error" in sel) return sel;
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, sel.key_id, tokens);
  return { ...sel, tokens };
}

export function markSuccess(keyId: number, ms: number): void {
  sdb.prepare("UPDATE pool_keys SET latency_ms = ?, consec_fail = 0, cooldown_until = 0 WHERE id = ?").run(ms, keyId);
}

export function markFailure(keyId: number): void {
  const row = sdb.prepare("SELECT consec_fail AS f FROM pool_keys WHERE id = ?").get(keyId) as { f: number };
  const fails = (row?.f ?? 0) + 1;
  const backoff = Math.min(30 * 2 ** (fails - 1), 600) * 1000;
  sdb.prepare("UPDATE pool_keys SET consec_fail = ?, cooldown_until = ? WHERE id = ?").run(fails, Date.now() + backoff, keyId);
}
