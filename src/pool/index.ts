import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "../config/env.js";
import { providersJsonPath } from "../config/paths.js";
import { FALLBACK_PROVIDERS, loadProviders as loadProviderRegistry, type Provider } from "../shared/providers.js";
import {
  callBodyForStorage as capCallBody,
  mask,
  maskCredentials,
  normalizeCredentials as normalizeCredentialsFor,
  parseCredentials,
  providerKeyFields as providerKeyFieldsFrom,
} from "../shared/pool-core.js";
import {
  QUOTA,
  QUOTA_DAILY,
  QUOTA_WINDOW,
  quotaForProvider,
  quotaLimitsForProvider,
  quotaWindowFilter,
  type QuotaWindow,
} from "../shared/quota.js";

export { DB_PATH };
export { mask, maskCredentials, parseCredentials, QUOTA, QUOTA_DAILY, QUOTA_WINDOW, quotaForProvider, quotaLimitsForProvider, quotaWindowFilter };
export type { Provider, QuotaWindow };

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const sdb = new DatabaseSync(DB_PATH);

sdb.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;`);

sdb.exec(`
  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    strategy TEXT NOT NULL DEFAULT '',
    strategy_state TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pool_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    api_key TEXT NOT NULL,
    info TEXT NOT NULL DEFAULT '',
    cooldown_until INTEGER NOT NULL DEFAULT 0,
    latency_ms REAL,
    consec_fail INTEGER NOT NULL DEFAULT 0,
    weight INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    picks INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL REFERENCES pool_keys(id) ON DELETE CASCADE,
    tokens INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pool_keys_pool ON pool_keys(pool_id);
  CREATE INDEX IF NOT EXISTS idx_usage_pool_created ON usage(pool_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_key_created ON usage(key_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_pools_provider ON pools(provider);
  CREATE TABLE IF NOT EXISTS calls (
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
  );
  CREATE INDEX IF NOT EXISTS idx_calls_pool_created ON calls(pool_id, created_at);
`);

function loadProviders(): Provider[] {
  try {
    const raw = JSON.parse(fs.readFileSync(providersJsonPath(), "utf8")) as unknown;
    return loadProviderRegistry(raw);
  } catch (e) {
    console.warn(`[warn] failed to load data/providers.json, using fallback providers: ${(e as Error).message}`);
    return FALLBACK_PROVIDERS;
  }
}

export const PROVIDERS: Provider[] = loadProviders();

export function providerKeyFields(provider: string): string[] {
  return providerKeyFieldsFrom(PROVIDERS, provider);
}

export function isMultiFieldProvider(provider: string): boolean {
  const f = providerKeyFields(provider);
  return !(f.length === 1 && (f[0] === "api_key" || f[0] === "apiToken"));
}

export function normalizeCredentials(
  provider: string,
  input: unknown
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  return normalizeCredentialsFor(providerKeyFields(provider), input);
}

/** Max response chars kept per call row — bounds DB growth (media relays are MBs). */
export const CALLS_BODY_CHARS = 4000;
/** Higher cap for binary media (audio/video/image base64) so generated files
 *  stay playable/renderable from History. Still bounded: ~2MB per row worst case. */
export const CALLS_MEDIA_CHARS = 2_000_000;

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

/** Pick the storage slice for a relay body: text stays small, binary media
 *  keeps enough bytes to stay playable/renderable. Pure (testable). */
export function callBodyForStorage(relayBody: string, encoding: string, truncated: boolean): { body: string; truncated: boolean } {
  return capCallBody(relayBody, encoding, truncated, { textChars: CALLS_BODY_CHARS, mediaChars: CALLS_MEDIA_CHARS });
}
export function logCall(c: CallRow): void {
  try {
    sdb
      .prepare(
        "INSERT INTO calls (pool_id, key_id, method, path, status, tokens, body, truncated, encoding, content_type, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        c.pool_id, c.key_id,
        c.method.slice(0, 16), c.path.slice(0, 2000), c.status, c.tokens,
        c.body.slice(0, CALLS_MEDIA_CHARS), c.truncated ? 1 : 0,
        c.encoding.slice(0, 16), c.contentType.slice(0, 256), c.error.slice(0, 500)
      );
  } catch {
    // Call logging must never break proxying.
  }
}

export function getPool(poolId: number) {
  return sdb.prepare("SELECT * FROM pools WHERE id = ?").get(poolId) as
    | { id: number; provider: string; name: string; cursor: number; strategy: string; strategy_state: string; base_url: string; key_header: string; key_prefix: string; created_at: string }
    | undefined;
}

export function keyCount(poolId: number): number {
  return (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(poolId) as { n: number }).n;
}

try {
  sdb.exec(`ALTER TABLE pools ADD COLUMN base_url TEXT NOT NULL DEFAULT ''`);
} catch (e) {
  if (!/duplicate column/i.test((e as Error).message)) throw e;
}
try {
  sdb.exec(`ALTER TABLE pools ADD COLUMN key_header TEXT NOT NULL DEFAULT 'X-API-Key'`);
} catch (e) {
  if (!/duplicate column/i.test((e as Error).message)) throw e;
}
try {
  sdb.exec(`ALTER TABLE pools ADD COLUMN key_prefix TEXT NOT NULL DEFAULT ''`);
} catch (e) {
  if (!/duplicate column/i.test((e as Error).message)) throw e;
}
for (const col of ["strategy TEXT NOT NULL DEFAULT ''", "strategy_state TEXT NOT NULL DEFAULT '{}'"] as const) {
  try {
    sdb.exec(`ALTER TABLE pools ADD COLUMN ${col}`);
  } catch (e) {
    if (!/duplicate column/i.test((e as Error).message)) throw e;
  }
}
for (const col of [
  "cooldown_until INTEGER NOT NULL DEFAULT 0",
  "latency_ms REAL",
  "consec_fail INTEGER NOT NULL DEFAULT 0",
  "weight INTEGER NOT NULL DEFAULT 1",
  "priority INTEGER NOT NULL DEFAULT 0",
  "picks INTEGER NOT NULL DEFAULT 0",
  "last_used_at INTEGER NOT NULL DEFAULT 0",
] as const) {
  try {
    sdb.exec(`ALTER TABLE pool_keys ADD COLUMN ${col}`);
  } catch (e) {
    if (!/duplicate column/i.test((e as Error).message)) throw e;
  }
}
try {
  sdb.exec(`ALTER TABLE pool_keys ADD COLUMN credentials TEXT NOT NULL DEFAULT '{}'`);
} catch (e) {
  if (!/duplicate column/i.test((e as Error).message)) throw e;
}

export function firstPoolWithKeys(provider: string) {
  const pools = sdb.prepare("SELECT * FROM pools WHERE provider = ? ORDER BY id").all(provider) as {
    id: number; provider: string; name: string; cursor: number; base_url: string; key_header: string; key_prefix: string; created_at: string
  }[];
  for (const p of pools) {
    if (keyCount(p.id) > 0) return p;
  }
  return null;
}

export function poolSummary(poolId: number) {
  const pool = getPool(poolId);
  if (!pool) return null;
  const keys = keyCount(poolId);
  const used = (sdb.prepare("SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ?").get(poolId) as { t: number }).t;
  const { limit: quota, window } = quotaForProvider(pool.provider);
  const windowed = (
    sdb.prepare(`SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ?${quotaWindowFilter(window, "created_at")}`).get(poolId) as { t: number }
  ).t;
  const perKey = sdb
    .prepare(
      `SELECT k.id, k.label, COALESCE(SUM(u.tokens),0) AS used
       FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id${quotaWindowFilter(window)}
       WHERE k.pool_id = ? GROUP BY k.id ORDER BY k.id`
    )
    .all(poolId) as { id: number; label: string; used: number }[];
  // All enforceable limits (primary + daily) with pool-level windowed totals.
  const limits = quotaLimitsForProvider(pool.provider).map(({ limit, window: w }) => {
    const wUsed = (
      sdb.prepare(`SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ?${quotaWindowFilter(w, "created_at")}`).get(poolId) as { t: number }
    ).t;
    return { limit, window: w, usedInWindow: wUsed, remaining: Math.max(0, limit * keys - wUsed) };
  });
  return { ...pool, keys, used, usedInWindow: windowed, quota, quotaWindow: window, remaining: quota === null ? null : Math.max(0, quota * keys - windowed), perKey, limits };
}

export type AnalyticsPoint = { day: string; requests: number; tokens: number };

/** Home-page analytics: totals + last-14-day daily series + 7d/7d deltas. */
export function getAnalytics(): {
  requests: number;
  tokens: number;
  pools: number;
  keys: number;
  cooling: number;
  avgTokens: number;
  series: AnalyticsPoint[];
  keysSeries: { day: string; count: number }[];
  poolsSeries: { day: string; count: number }[];
  deltaRequestsPct: number | null;
  deltaTokensPct: number | null;
} {
  const requests = (sdb.prepare("SELECT COUNT(*) AS n FROM usage").get() as { n: number }).n;
  const tokens = (sdb.prepare("SELECT COALESCE(SUM(tokens),0) AS t FROM usage").get() as { t: number }).t;
  // Empty pools (no keys) don't count as pools — same rule as the /pools page.
  const pools = (sdb.prepare("SELECT COUNT(*) AS n FROM pools p WHERE EXISTS (SELECT 1 FROM pool_keys k WHERE k.pool_id = p.id)").get() as { n: number }).n;
  const keys = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys").get() as { n: number }).n;
  const cooling = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE cooldown_until > ?").get(Date.now()) as { n: number }).n;
  const rows = sdb
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS requests, COALESCE(SUM(tokens),0) AS tokens
       FROM usage WHERE created_at >= date('now','-13 days') GROUP BY day`
    )
    .all() as { day: string; requests: number; tokens: number }[];
  const keyRows = sdb
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n
       FROM pool_keys WHERE created_at >= date('now','-13 days') GROUP BY day`
    )
    .all() as { day: string; n: number }[];
  const poolRows = sdb
    .prepare(
      `SELECT date(p.created_at) AS day, COUNT(*) AS n
       FROM pools p WHERE p.created_at >= date('now','-13 days')
       AND EXISTS (SELECT 1 FROM pool_keys k WHERE k.pool_id = p.id)
       GROUP BY day`
    )
    .all() as { day: string; n: number }[];
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
    series.push({ day, requests: hit?.requests ?? 0, tokens: hit?.tokens ?? 0 });
    keysSeries.push({ day, count: byKeyDay.get(day) ?? 0 });
    poolsSeries.push({ day, count: byPoolDay.get(day) ?? 0 });
  }
  const prevReq = series.slice(0, 7).reduce((a, p) => a + p.requests, 0);
  const lastReq = series.slice(7).reduce((a, p) => a + p.requests, 0);
  const deltaRequestsPct = prevReq === 0 ? (lastReq === 0 ? 0 : null) : ((lastReq - prevReq) / prevReq) * 100;
  const prevTok = series.slice(0, 7).reduce((a, p) => a + p.tokens, 0);
  const lastTok = series.slice(7).reduce((a, p) => a + p.tokens, 0);
  const deltaTokensPct = prevTok === 0 ? (lastTok === 0 ? 0 : null) : ((lastTok - prevTok) / prevTok) * 100;
  return {
    requests, tokens, pools, keys, cooling,
    avgTokens: requests === 0 ? 0 : Math.round((tokens / requests) * 10) / 10,
    series, keysSeries, poolsSeries,
    deltaRequestsPct, deltaTokensPct,
  };
}
