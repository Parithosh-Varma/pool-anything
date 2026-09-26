import { sdb, getPool, mask, maskCredentials, parseCredentials, quotaForProvider, quotaLimitsForProvider, quotaWindowFilter } from "./index.js";

const MAX_TOKENS = 1_000_000;

export type KeyRow = {
  key_id: number;
  label: string;
  api_key: string;
  credentials: string;
  info: string;
  used: number;
};

/** Per-key windowed total for one quota limit. */
function keyWindowedTotal(keyId: number, window: "month" | "day" | "all"): number {
  return (
    sdb.prepare(`SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE key_id = ?${quotaWindowFilter(window, "created_at")}`).get(keyId) as { t: number }
  ).t;
}

/** Eligible keys: not cooling down, under every quota limit. Ordered by latency (unknown first), id. */
export function eligibleKeys(poolId: number): (KeyRow & { masked: string })[] {
  const pool = getPool(poolId);
  if (!pool) return [];
  const now = Date.now();
  const { limit: quota, window } = quotaForProvider(pool.provider);
  const rows = sdb
    .prepare(
      `SELECT k.id AS key_id, k.label, k.api_key, COALESCE(k.credentials,'{}') AS credentials, k.info, COALESCE(SUM(u.tokens),0) AS used
       FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id${quotaWindowFilter(window)}
       WHERE k.pool_id = ? AND k.cooldown_until <= ?
       GROUP BY k.id ORDER BY k.latency_ms ASC, k.id ASC`
    )
    .all(poolId, now) as (KeyRow & { latency_ms: number | null })[];
  const limits = quotaLimitsForProvider(pool.provider);
  return rows
    .filter((k) => quota === null || k.used < quota)
    .filter((k) => {
      // Primary-window check above covers the primary limit; enforce the rest (daily).
      for (const { limit, window: w } of limits) {
        if (w === window) continue;
        if (keyWindowedTotal(k.key_id, w) >= limit) return false;
      }
      return true;
    })
    .map(({ latency_ms: _l, ...k }) => {
      const creds = parseCredentials(k.credentials);
      return {
        ...k,
        masked: mask(k.api_key),
        maskedCredentials: Object.keys(creds).length > 0 ? maskCredentials(creds) : undefined,
      };
    });
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
  const cursor = Number.isSafeInteger(pool.cursor) && pool.cursor >= 0 ? pool.cursor : 0;
  const pick = keys[((cursor % keys.length) + keys.length) % keys.length]!;
  advance(poolId);
  return pick;
}

export function nextKey(poolId: number) {
  const sel = nextKeyRaw(poolId);
  if ("error" in sel) return sel;
  const { api_key: _raw, credentials: _creds, ...masked } = sel;
  return masked;
}

function validTokens(tokens: unknown): tokens is number {
  return Number.isInteger(tokens) && (tokens as number) > 0 && (tokens as number) <= MAX_TOKENS;
}

export function recordUsage(poolId: number, tokens: number, keyId?: number) {
  if (!validTokens(tokens)) return { error: "tokens must be a positive integer <= 1000000" } as const;
  const pool = getPool(poolId);
  if (!pool) return { error: "pool not found" } as const;
  const limits = quotaLimitsForProvider(pool.provider);
  if (keyId !== undefined) {
    // Attribute to a specific key without advancing the rotation cursor.
    // Still enforces eligibility: no writing to cooling or quota-exhausted keys.
    const row = sdb
      .prepare("SELECT id, label, api_key, cooldown_until FROM pool_keys WHERE id = ? AND pool_id = ?")
      .get(keyId, poolId) as { id: number; label: string; api_key: string; cooldown_until: number } | undefined;
    if (!row) return { error: "key not found" } as const;
    if (row.cooldown_until > Date.now()) return { error: "key is cooling down" } as const;
    for (const { limit, window } of limits) {
      const used = keyWindowedTotal(keyId, window);
      if (used >= limit) return { error: "key quota-exhausted" } as const;
      if (used + tokens > limit) return { error: "tokens would exceed key quota" } as const;
    }
    sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, keyId, tokens);
    return { key_id: row.id, label: row.label, masked: mask(row.api_key), tokens };
  }
  const sel = nextKey(poolId);
  if ("error" in sel) return sel;
  for (const { limit, window } of limits) {
    if (keyWindowedTotal(sel.key_id, window) + tokens > limit) return { error: "tokens would exceed key quota" } as const;
  }
  sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, sel.key_id, tokens);
  return { ...sel, tokens };
}

export function markSuccess(keyId: number, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  sdb.prepare("UPDATE pool_keys SET latency_ms = ?, consec_fail = 0, cooldown_until = 0 WHERE id = ?").run(ms, keyId);
}

export function markFailure(keyId: number): void {
  // Atomic increment: avoids lost updates on concurrent failover paths.
  sdb.prepare("UPDATE pool_keys SET consec_fail = consec_fail + 1 WHERE id = ?").run(keyId);
  const row = sdb.prepare("SELECT consec_fail AS f FROM pool_keys WHERE id = ?").get(keyId) as { f: number } | undefined;
  if (!row) return;
  const fails = row.f;
  const backoff = Math.min(30 * 2 ** (Math.min(fails, 10) - 1), 600) * 1000;
  sdb.prepare("UPDATE pool_keys SET cooldown_until = ? WHERE id = ?").run(Date.now() + backoff, keyId);
}
