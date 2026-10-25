// D1 persistence + rotation. Async port of src/pool/index.ts + rotation.ts.
// Semantics intentionally match the Node server: identical schema, quota
// windows and failover rules; only the storage calls are awaited.

import {
  mask,
  maskCredentials,
  parseCredentials,
  callBodyForStorage,
  type CallCaps,
} from "../../src/shared/pool-core.js";
import {
  quotaForProvider,
  quotaLimitsForProvider,
  quotaWindowFilter,
  type QuotaWindow,
} from "../../src/shared/quota.js";
import {
  isStrategyName,
  parseStrategyState,
  selectKey,
  type Candidate,
  type RotationOptions,
  type Selection,
  type StrategyName,
} from "../../src/pool/strategy.js";
import { inFlight } from "./inflight.js";
import { CALLS_BODY_CHARS, CALLS_MEDIA_CHARS } from "./limits.js";

export type PoolRow = {
  id: number;
  provider: string;
  name: string;
  cursor: number;
  strategy: string;
  strategy_state: string;
  base_url: string;
  key_header: string;
  key_prefix: string;
  created_at: string;
};

export type StoredKey = {
  id: number;
  pool_id: number;
  label: string;
  api_key: string;
  credentials: string;
  info: string;
  cooldown_until: number;
  latency_ms: number | null;
  consec_fail: number;
  weight: number;
  priority: number;
  picks: number;
  last_used_at: number;
  created_at: string;
};

export type KeyRow = {
  key_id: number;
  label: string;
  api_key: string;
  credentials: string;
  info: string;
  used: number;
  weight: number;
  priority: number;
  picks: number;
  last_used_at: number;
  consec_fail: number;
  latency_ms: number | null;
};

export type EligibleKey = KeyRow & {
  masked: string;
  maskedCredentials?: Record<string, string>;
};

export type RawKey = Omit<KeyRow, "weight" | "priority" | "picks" | "last_used_at" | "consec_fail" | "latency_ms"> & {
  masked: string;
  maskedCredentials?: Record<string, string>;
  strategy: StrategyName;
};

export type NextKeyOpts = {
  /** Session affinity key. Forces the sticky strategy when present. */
  sticky?: string;
  /** Failover attempt index (0 on the first try). */
  attempt?: number;
  /** Pool strategy when the pool has none of its own. */
  defaultStrategy: StrategyName;
  options: RotationOptions;
  /** Injectable RNG for deterministic tests. */
  rng?: () => number;
};

export type CallRow = {
  pool_id: number;
  key_id: number;
  method: string;
  path: string;
  status: number | null;
  tokens: number;
  body: string;
  truncated: boolean;
  encoding: string;
  contentType: string;
  error: string;
};

const CALL_CAPS: CallCaps = { textChars: CALLS_BODY_CHARS, mediaChars: CALLS_MEDIA_CHARS };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    strategy TEXT NOT NULL DEFAULT '',
    strategy_state TEXT NOT NULL DEFAULT '{}',
    base_url TEXT NOT NULL DEFAULT '',
    key_header TEXT NOT NULL DEFAULT 'X-API-Key',
    key_prefix TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pool_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    api_key TEXT NOT NULL,
    credentials TEXT NOT NULL DEFAULT '{}',
    info TEXT NOT NULL DEFAULT '',
    cooldown_until INTEGER NOT NULL DEFAULT 0,
    latency_ms REAL,
    consec_fail INTEGER NOT NULL DEFAULT 0,
    weight INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    picks INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL REFERENCES pool_keys(id) ON DELETE CASCADE,
    tokens INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL REFERENCES pool_keys(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT 'POST',
    path TEXT NOT NULL DEFAULT '',
    status INTEGER,
    tokens INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    truncated INTEGER NOT NULL DEFAULT 0,
    encoding TEXT NOT NULL DEFAULT 'text',
    content_type TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_pool_keys_pool ON pool_keys(pool_id)",
  "CREATE INDEX IF NOT EXISTS idx_usage_pool_created ON usage(pool_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_usage_key_created ON usage(key_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_pools_provider ON pools(provider)",
  "CREATE INDEX IF NOT EXISTS idx_calls_pool_created ON calls(pool_id, created_at)",
];

let schemaReady = false;

/** Idempotent ALTERs for databases created before a column was added. */
const ALTERS = [
  "ALTER TABLE pools ADD COLUMN strategy TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE pools ADD COLUMN strategy_state TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE pool_keys ADD COLUMN weight INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE pool_keys ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE pool_keys ADD COLUMN picks INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE pool_keys ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0",
];

/**
 * Idempotent bootstrap so a fresh deploy works even before migrations are
 * applied. Runs at most once per isolate; migrations remain the source of truth.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  for (const sql of ALTERS) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  schemaReady = true;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function dbPing(db: D1Database): Promise<{ ok: boolean }> {
  try {
    await db.prepare("SELECT 1 AS ok").first();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function getPool(db: D1Database, poolId: number): Promise<PoolRow | null> {
  return db.prepare("SELECT * FROM pools WHERE id = ?").bind(poolId).first<PoolRow>();
}

export async function listPools(db: D1Database): Promise<PoolRow[]> {
  const r = await db.prepare("SELECT * FROM pools ORDER BY id DESC").all<PoolRow>();
  return r.results;
}

export async function createPool(
  db: D1Database,
  input: { provider: string; name: string; base_url: string; key_header: string; key_prefix: string; strategy: string }
): Promise<PoolRow | null> {
  return db
    .prepare(
      "INSERT INTO pools (provider, name, base_url, key_header, key_prefix, strategy) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
    )
    .bind(
      input.provider,
      input.name,
      input.base_url.slice(0, 500),
      input.key_header.slice(0, 80),
      input.key_prefix.slice(0, 40),
      input.strategy
    )
    .first<PoolRow>();
}

export async function updatePoolStrategy(db: D1Database, poolId: number, strategy: string): Promise<PoolRow | null> {
  return db.prepare("UPDATE pools SET strategy = ? WHERE id = ? RETURNING *").bind(strategy, poolId).first<PoolRow>();
}

export async function deletePool(db: D1Database, poolId: number): Promise<boolean> {
  const pool = await getPool(db, poolId);
  if (!pool) return false;
  await db.batch([
    db.prepare("DELETE FROM calls WHERE pool_id = ?").bind(poolId),
    db.prepare("DELETE FROM usage WHERE pool_id = ?").bind(poolId),
    db.prepare("DELETE FROM pool_keys WHERE pool_id = ?").bind(poolId),
    db.prepare("DELETE FROM pools WHERE id = ?").bind(poolId),
  ]);
  return true;
}

export async function keyCount(db: D1Database, poolId: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").bind(poolId).first<{ n: number }>();
  return num(r?.n);
}

export async function poolCount(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM pools").first<{ n: number }>();
  return num(r?.n);
}

export async function listKeyRows(db: D1Database, poolId: number): Promise<StoredKey[]> {
  const r = await db
    .prepare(
      "SELECT id, pool_id, label, api_key, COALESCE(credentials,'{}') AS credentials, info, created_at, cooldown_until, latency_ms, consec_fail, weight, priority, picks, last_used_at FROM pool_keys WHERE pool_id = ? ORDER BY id"
    )
    .bind(poolId)
    .all<StoredKey>();
  return r.results;
}

export async function getKeyRow(db: D1Database, poolId: number, keyId: number): Promise<StoredKey | null> {
  return db
    .prepare(
      "SELECT id, pool_id, label, api_key, COALESCE(credentials,'{}') AS credentials, info, created_at, cooldown_until, latency_ms, consec_fail, weight, priority, picks, last_used_at FROM pool_keys WHERE id = ? AND pool_id = ?"
    )
    .bind(keyId, poolId)
    .first<StoredKey>();
}

export async function insertKey(
  db: D1Database,
  input: { poolId: number; label: string; apiKey: string; credentials: string; info: string; weight: number; priority: number }
): Promise<number> {
  const r = await db
    .prepare(
      "INSERT INTO pool_keys (pool_id, label, api_key, credentials, info, weight, priority) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id"
    )
    .bind(input.poolId, input.label, input.apiKey, input.credentials, input.info, input.weight, input.priority)
    .first<{ id: number }>();
  return num(r?.id);
}

export async function findDuplicateKey(db: D1Database, poolId: number, apiKey: string): Promise<boolean> {
  const r = await db
    .prepare("SELECT id FROM pool_keys WHERE pool_id = ? AND api_key = ?")
    .bind(poolId, apiKey)
    .first<{ id: number }>();
  return r !== null;
}

export type KeyPatch = { label?: string; api_key?: string; credentials?: string; info?: string; weight?: number; priority?: number };

/** Apply a pre-validated patch. Changing secret material clears cooldown/failures. */
export async function updateKey(db: D1Database, keyId: number, patch: KeyPatch): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.weight !== undefined) {
    sets.push("weight = ?");
    binds.push(patch.weight);
  }
  if (patch.priority !== undefined) {
    sets.push("priority = ?");
    binds.push(patch.priority);
  }
  if (patch.label !== undefined) {
    sets.push("label = ?");
    binds.push(patch.label);
  }
  if (patch.api_key !== undefined) {
    sets.push("api_key = ?", "consec_fail = 0", "cooldown_until = 0");
    binds.push(patch.api_key);
  }
  if (patch.credentials !== undefined) {
    sets.push("credentials = ?", "consec_fail = 0", "cooldown_until = 0");
    binds.push(patch.credentials);
  }
  if (patch.info !== undefined) {
    sets.push("info = ?");
    binds.push(patch.info);
  }
  if (sets.length === 0) return;
  binds.push(keyId);
  await db.prepare(`UPDATE pool_keys SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
}

export async function deleteKey(db: D1Database, poolId: number, keyId: number): Promise<boolean> {
  const results = await db.batch([
    db.prepare("DELETE FROM calls WHERE key_id = ?").bind(keyId),
    db.prepare("DELETE FROM usage WHERE key_id = ?").bind(keyId),
    db.prepare("DELETE FROM pool_keys WHERE id = ? AND pool_id = ?").bind(keyId, poolId),
  ]);
  const last = results[results.length - 1];
  return num(last?.meta.changes) > 0;
}

export async function poolSummary(db: D1Database, poolId: number) {
  const pool = await getPool(db, poolId);
  if (!pool) return null;
  const { limit: quota, window } = quotaForProvider(pool.provider);
  const limits = quotaLimitsForProvider(pool.provider);
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").bind(poolId),
    db.prepare("SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ?").bind(poolId),
    db
      .prepare(`SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ?${quotaWindowFilter(window, "created_at")}`)
      .bind(poolId),
    db
      .prepare(
        `SELECT k.id, k.label, COALESCE(SUM(u.tokens),0) AS used
         FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id${quotaWindowFilter(window)}
         WHERE k.pool_id = ? GROUP BY k.id ORDER BY k.id`
      )
      .bind(poolId),
    ...limits.map((l) =>
      db
        .prepare(`SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ?${quotaWindowFilter(l.window, "created_at")}`)
        .bind(poolId)
    ),
  ]);
  const keys = num((results[0]?.results[0] as { n?: number } | undefined)?.n);
  const used = num((results[1]?.results[0] as { t?: number } | undefined)?.t);
  const usedInWindow = num((results[2]?.results[0] as { t?: number } | undefined)?.t);
  const perKey = (results[3]?.results ?? []) as { id: number; label: string; used: number }[];
  const summaryLimits = limits.map(({ limit, window: w }, i) => {
    const wUsed = num((results[4 + i]?.results[0] as { t?: number } | undefined)?.t);
    return { limit, window: w, usedInWindow: wUsed, remaining: Math.max(0, limit * keys - wUsed) };
  });
  return {
    ...pool,
    keys,
    used,
    usedInWindow,
    quota,
    quotaWindow: window,
    remaining: quota === null ? null : Math.max(0, quota * keys - usedInWindow),
    perKey,
    limits: summaryLimits,
  };
}

export type AnalyticsPoint = { day: string; requests: number; tokens: number };

export async function getAnalytics(db: D1Database) {
  const now = Date.now();
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM usage"),
    db.prepare("SELECT COALESCE(SUM(tokens),0) AS t FROM usage"),
    db.prepare("SELECT COUNT(*) AS n FROM pools p WHERE EXISTS (SELECT 1 FROM pool_keys k WHERE k.pool_id = p.id)"),
    db.prepare("SELECT COUNT(*) AS n FROM pool_keys"),
    db.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE cooldown_until > ?").bind(now),
    db.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS requests, COALESCE(SUM(tokens),0) AS tokens
       FROM usage WHERE created_at >= date('now','-13 days') GROUP BY day`
    ),
    db.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n
       FROM pool_keys WHERE created_at >= date('now','-13 days') GROUP BY day`
    ),
    db.prepare(
      `SELECT date(p.created_at) AS day, COUNT(*) AS n
       FROM pools p WHERE p.created_at >= date('now','-13 days')
       AND EXISTS (SELECT 1 FROM pool_keys k WHERE k.pool_id = p.id)
       GROUP BY day`
    ),
  ]);
  const requests = num((results[0]?.results[0] as { n?: number } | undefined)?.n);
  const tokens = num((results[1]?.results[0] as { t?: number } | undefined)?.t);
  const pools = num((results[2]?.results[0] as { n?: number } | undefined)?.n);
  const keys = num((results[3]?.results[0] as { n?: number } | undefined)?.n);
  const cooling = num((results[4]?.results[0] as { n?: number } | undefined)?.n);
  const rows = (results[5]?.results ?? []) as { day: string; requests: number; tokens: number }[];
  const keyRows = (results[6]?.results ?? []) as { day: string; n: number }[];
  const poolRows = (results[7]?.results ?? []) as { day: string; n: number }[];

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const byKeyDay = new Map(keyRows.map((r) => [r.day, r.n]));
  const byPoolDay = new Map(poolRows.map((r) => [r.day, r.n]));
  const series: AnalyticsPoint[] = [];
  const keysSeries: { day: string; count: number }[] = [];
  const poolsSeries: { day: string; count: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = d.toISOString().slice(0, 10);
    const hit = byDay.get(day);
    series.push({ day, requests: num(hit?.requests), tokens: num(hit?.tokens) });
    keysSeries.push({ day, count: num(byKeyDay.get(day)) });
    poolsSeries.push({ day, count: num(byPoolDay.get(day)) });
  }
  const prevReq = series.slice(0, 7).reduce((a, p) => a + p.requests, 0);
  const lastReq = series.slice(7).reduce((a, p) => a + p.requests, 0);
  const deltaRequestsPct = prevReq === 0 ? (lastReq === 0 ? 0 : null) : ((lastReq - prevReq) / prevReq) * 100;
  const prevTok = series.slice(0, 7).reduce((a, p) => a + p.tokens, 0);
  const lastTok = series.slice(7).reduce((a, p) => a + p.tokens, 0);
  const deltaTokensPct = prevTok === 0 ? (lastTok === 0 ? 0 : null) : ((lastTok - prevTok) / prevTok) * 100;
  return {
    requests,
    tokens,
    pools,
    keys,
    cooling,
    avgTokens: requests === 0 ? 0 : Math.round((tokens / requests) * 10) / 10,
    series,
    keysSeries,
    poolsSeries,
    deltaRequestsPct,
    deltaTokensPct,
  };
}

/** Per-key windowed totals for one quota limit, keyed by key id. */
async function keyWindowedSums(db: D1Database, keyIds: number[], window: QuotaWindow): Promise<Map<number, number>> {
  const sums = new Map<number, number>();
  for (let i = 0; i < keyIds.length; i += 90) {
    const chunk = keyIds.slice(i, i + 90);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const r = await db
      .prepare(
        `SELECT key_id, COALESCE(SUM(tokens),0) AS t FROM usage
         WHERE key_id IN (${placeholders})${quotaWindowFilter(window, "created_at")}
         GROUP BY key_id`
      )
      .bind(...chunk)
      .all<{ key_id: number; t: number }>();
    for (const row of r.results) sums.set(row.key_id, num(row.t));
  }
  return sums;
}

async function keyWindowedTotal(db: D1Database, keyId: number, window: QuotaWindow): Promise<number> {
  const r = await db
    .prepare(`SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE key_id = ?${quotaWindowFilter(window, "created_at")}`)
    .bind(keyId)
    .first<{ t: number }>();
  return num(r?.t);
}

/** Eligible keys: not cooling down, under every quota limit. Ordered by latency (unknown first), id. */
export async function eligibleKeys(db: D1Database, poolId: number, provider: string): Promise<EligibleKey[]> {
  const { limit: quota, window } = quotaForProvider(provider);
  const now = Date.now();
  const r = await db
    .prepare(
      `SELECT k.id AS key_id, k.label, k.api_key, COALESCE(k.credentials,'{}') AS credentials, k.info,
              k.weight, k.priority, k.picks, k.last_used_at, k.consec_fail, k.latency_ms,
              COALESCE(SUM(u.tokens),0) AS used
       FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id${quotaWindowFilter(window)}
       WHERE k.pool_id = ? AND k.cooldown_until <= ?
       GROUP BY k.id ORDER BY k.latency_ms ASC, k.id ASC`
    )
    .bind(poolId, now)
    .all<KeyRow>();
  let rows = r.results.filter((k) => quota === null || num(k.used) < quota);
  const extraLimits = quotaLimitsForProvider(provider).filter((l) => l.window !== window);
  if (extraLimits.length > 0 && rows.length > 0) {
    const ids = rows.map((k) => k.key_id);
    for (const { limit, window: w } of extraLimits) {
      const sums = await keyWindowedSums(db, ids, w);
      rows = rows.filter((k) => num(sums.get(k.key_id)) < limit);
    }
  }
  return rows.map((k) => {
    const creds = parseCredentials(k.credentials);
    return {
      ...k,
      used: num(k.used),
      weight: num(k.weight),
      priority: num(k.priority),
      picks: num(k.picks),
      last_used_at: num(k.last_used_at),
      consec_fail: num(k.consec_fail),
      latency_ms: k.latency_ms === null ? null : num(k.latency_ms),
      masked: mask(k.api_key),
      maskedCredentials: Object.keys(creds).length > 0 ? maskCredentials(creds) : undefined,
    };
  });
}

/** Pick a slot for a cursor value (0-based). Pure + testable. */
export function pickForCursor<T>(keys: T[], cursor: number): T | undefined {
  if (keys.length === 0) return undefined;
  const c = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  return keys[((c % keys.length) + keys.length) % keys.length];
}

/** Strip selection metadata before a key leaves the server. */
function publicKey(key: EligibleKey, strategy: StrategyName): RawKey {
  const {
    weight: _weight,
    priority: _priority,
    picks: _picks,
    last_used_at: _lastUsed,
    consec_fail: _fails,
    latency_ms: _latency,
    ...rest
  } = key;
  return { ...rest, strategy };
}

/**
 * Pick the next key for a pool using its configured strategy (or sticky when a
 * session key is supplied). Raw key stays server-side; use nextKey for the
 * masked form. Selection metadata (weight/priority/picks/latency) never leaves.
 */
export async function nextKeyRaw(
  db: D1Database,
  poolId: number,
  opts: NextKeyOpts
): Promise<RawKey | { error: string }> {
  const pool = await getPool(db, poolId);
  if (!pool) return { error: "pool not found" };
  const keys = await eligibleKeys(db, poolId, pool.provider);
  if (keys.length === 0) {
    const total = await keyCount(db, poolId);
    if (total === 0) return { error: "pool has no keys" };
    return { error: "all keys cooling down or quota-exhausted" };
  }
  const now = Date.now();
  const cursor = Number.isSafeInteger(pool.cursor) && pool.cursor >= 0 ? pool.cursor : 0;
  const sticky = typeof opts.sticky === "string" && opts.sticky.trim() ? opts.sticky.trim() : undefined;
  const strategy: StrategyName = sticky
    ? "sticky"
    : isStrategyName(pool.strategy)
      ? pool.strategy
      : opts.defaultStrategy;

  const candidates: Candidate[] = keys.map((k) => ({
    key_id: k.key_id,
    weight: k.weight,
    priority: k.priority,
    picks: k.picks,
    last_used_at: k.last_used_at,
    consec_fail: k.consec_fail,
    latency_ms: k.latency_ms,
    in_flight: inFlight(k.key_id),
  }));

  const selection: Selection = selectKey(strategy, candidates, {
    poolId,
    cursor,
    sticky,
    attempt: opts.attempt ?? 0,
    now,
    options: opts.options,
    rng: opts.rng ?? Math.random,
    state: parseStrategyState(pool.strategy_state),
  });

  const chosen = keys.find((k) => k.key_id === selection.key.key_id)!;
  if (selection.advanceCursor) {
    // Cursor advance is a single atomic UPDATE; concurrent isolates may still
    // read the same pre-bump cursor (same trade-off as the Node server).
    await db.prepare("UPDATE pools SET cursor = cursor + 1 WHERE id = ?").bind(poolId).run();
  }
  if (selection.state) {
    await db
      .prepare("UPDATE pools SET strategy_state = ? WHERE id = ?")
      .bind(JSON.stringify(selection.state).slice(0, 4000), poolId)
      .run();
  }
  await db.prepare("UPDATE pool_keys SET picks = picks + 1, last_used_at = ? WHERE id = ?").bind(now, chosen.key_id).run();
  return publicKey(chosen, strategy);
}

export async function nextKey(db: D1Database, poolId: number, opts: NextKeyOpts) {
  const sel = await nextKeyRaw(db, poolId, opts);
  if ("error" in sel) return sel;
  const { api_key: _raw, credentials: _creds, ...masked } = sel;
  return masked;
}

function validTokens(tokens: unknown): tokens is number {
  return Number.isInteger(tokens) && (tokens as number) > 0 && (tokens as number) <= 1_000_000;
}

export async function recordUsage(
  db: D1Database,
  poolId: number,
  tokens: number,
  keyId: number | undefined,
  opts: NextKeyOpts
) {
  if (!validTokens(tokens)) return { error: "tokens must be a positive integer <= 1000000" } as const;
  const pool = await getPool(db, poolId);
  if (!pool) return { error: "pool not found" } as const;
  const limits = quotaLimitsForProvider(pool.provider);
  if (keyId !== undefined) {
    // Attribute to a specific key without advancing the rotation cursor.
    // Still enforces eligibility: no writing to cooling or quota-exhausted keys.
    const row = await db
      .prepare("SELECT id, label, api_key, cooldown_until FROM pool_keys WHERE id = ? AND pool_id = ?")
      .bind(keyId, poolId)
      .first<{ id: number; label: string; api_key: string; cooldown_until: number }>();
    if (!row) return { error: "key not found" } as const;
    if (row.cooldown_until > Date.now()) return { error: "key is cooling down" } as const;
    for (const { limit, window } of limits) {
      const used = await keyWindowedTotal(db, keyId, window);
      if (used >= limit) return { error: "key quota-exhausted" } as const;
      if (used + tokens > limit) return { error: "tokens would exceed key quota" } as const;
    }
    await db.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").bind(poolId, keyId, tokens).run();
    return { key_id: row.id, label: row.label, masked: mask(row.api_key), tokens };
  }
  const sel = await nextKey(db, poolId, opts);
  if ("error" in sel) return sel;
  for (const { limit, window } of limits) {
    if ((await keyWindowedTotal(db, sel.key_id, window)) + tokens > limit) {
      return { error: "tokens would exceed key quota" } as const;
    }
  }
  await db.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").bind(poolId, sel.key_id, tokens).run();
  return { ...sel, tokens };
}

export async function markSuccess(db: D1Database, keyId: number, ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) return;
  await db
    .prepare("UPDATE pool_keys SET latency_ms = ?, consec_fail = 0, cooldown_until = 0 WHERE id = ?")
    .bind(ms, keyId)
    .run();
}

export async function markFailure(db: D1Database, keyId: number): Promise<void> {
  // Atomic increment: avoids lost updates on concurrent failover paths.
  const row = await db
    .prepare("UPDATE pool_keys SET consec_fail = consec_fail + 1 WHERE id = ? RETURNING consec_fail")
    .bind(keyId)
    .first<{ consec_fail: number }>();
  if (!row) return;
  const fails = num(row.consec_fail);
  const backoff = Math.min(30 * 2 ** (Math.min(fails, 10) - 1), 600) * 1000;
  await db.prepare("UPDATE pool_keys SET cooldown_until = ? WHERE id = ?").bind(Date.now() + backoff, keyId).run();
}

export async function logCall(db: D1Database, c: CallRow): Promise<void> {
  try {
    const stored = callBodyForStorage(c.body, c.encoding, c.truncated, CALL_CAPS);
    await db
      .prepare(
        "INSERT INTO calls (pool_id, key_id, method, path, status, tokens, body, truncated, encoding, content_type, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        c.pool_id,
        c.key_id,
        c.method.slice(0, 16),
        c.path.slice(0, 2000),
        c.status,
        c.tokens,
        stored.body,
        stored.truncated ? 1 : 0,
        c.encoding.slice(0, 16),
        c.contentType.slice(0, 256),
        c.error.slice(0, 500)
      )
      .run();
  } catch {
    // Call logging must never break proxying.
  }
}

export async function listCalls(db: D1Database, poolId: number, limit: number) {
  const r = await db
    .prepare(
      "SELECT id, pool_id, key_id, method, path, status, tokens, body, truncated, encoding, content_type, error, created_at FROM calls WHERE pool_id = ? ORDER BY id DESC LIMIT ?"
    )
    .bind(poolId, Math.min(Math.max(limit, 1), 200))
    .all();
  return r.results;
}
