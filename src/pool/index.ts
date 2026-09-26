import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "../config/env.js";

export { DB_PATH };

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const sdb = new DatabaseSync(DB_PATH);

sdb.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;`);

sdb.exec(`
  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
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
`);

export type Provider = {
  id: string;
  name: string;
  quota: string;
  keyFields: string[];
  hint: string;
  baseUrl: string;
  keyHeader: string;
  keyPrefix: string;
  extraHeaders: Record<string, string>;
  docsUrl?: string;
  logoFile?: string;
  poolable?: boolean | string;
};

const FALLBACK_PROVIDERS: Provider[] = [
  {
    id: "cartesia",
    name: "Cartesia",
    quota: "20,000 free tokens",
    keyFields: ["api_key"],
    hint: "Paste a Cartesia API key. Add key 1, key 2… to pool them.",
    baseUrl: "https://api.cartesia.ai",
    keyHeader: "X-API-Key",
    keyPrefix: "",
    extraHeaders: { "Cartesia-Version": "2024-06-10" },
  },
  {
    id: "groq",
    name: "Groq",
    quota: "free tier",
    keyFields: ["api_key"],
    hint: "Paste a Groq API key (gsk_…). Add key 1, key 2… to pool them.",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHeader: "Authorization",
    keyPrefix: "Bearer ",
    extraHeaders: {},
  },
  {
    id: "custom",
    name: "Custom",
    quota: "bring your own",
    keyFields: ["api_key"],
    hint: "Anything we don't provide: name it, add keys + info.",
    baseUrl: "",
    keyHeader: "X-API-Key",
    keyPrefix: "",
    extraHeaders: {},
  },
];

function loadProviders(): Provider[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "providers.json"), "utf8")) as Record<string, unknown>[];
    if (!Array.isArray(raw)) throw new Error("not an array");
    return raw
      .filter((p) => typeof p.id === "string" && typeof p.name === "string" && typeof p.baseUrl === "string")
      .map((p) => ({
        id: p.id as string,
        name: p.name as string,
        quota: String(p.quota ?? ""),
        keyFields: Array.isArray(p.keyFields) && (p.keyFields as unknown[]).every((k) => typeof k === "string") ? (p.keyFields as string[]) : ["api_key"],
        hint: String(p.hint ?? ""),
        baseUrl: p.baseUrl as string,
        keyHeader: String(p.keyHeader ?? "X-API-Key"),
        keyPrefix: String(p.keyPrefix ?? ""),
        extraHeaders:
          p.extraHeaders !== null && typeof p.extraHeaders === "object" && !Array.isArray(p.extraHeaders)
            ? (Object.fromEntries(Object.entries(p.extraHeaders as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>)
            : {},
        docsUrl: typeof p.docsUrl === "string" ? p.docsUrl : undefined,
        logoFile: typeof p.logo === "string" && p.logo ? path.basename(p.logo) : undefined,
        poolable: (p.poolable ?? true) as boolean | string,
      }));
  } catch (e) {
    console.warn(`[warn] failed to load data/providers.json, using fallback providers: ${(e as Error).message}`);
    return FALLBACK_PROVIDERS;
  }
}

export const PROVIDERS: Provider[] = loadProviders();

export function mask(key: unknown): string {
  if (typeof key !== "string" || key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
}

export type KeyFields = string[];

export function providerKeyFields(provider: string): string[] {
  return PROVIDERS.find((x) => x.id === provider)?.keyFields ?? ["api_key"];
}

export function isMultiFieldProvider(provider: string): boolean {
  const f = providerKeyFields(provider);
  return !(f.length === 1 && (f[0] === "api_key" || f[0] === "apiToken"));
}

function cleanFieldValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 4096 || /[\r\n\0]/.test(t)) return null;
  return t;
}

/** Validate + normalize a credentials object for a provider. Returns normalized or error. */
export function normalizeCredentials(
  provider: string,
  input: unknown
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const fields = providerKeyFields(provider);
  if (input === undefined || input === null) return { ok: false, error: `missing credentials: ${fields.join(", ")} required` };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "credentials must be an object" };
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = cleanFieldValue((input as Record<string, unknown>)[f]);
    if (v === null) return { ok: false, error: `field ${f} required (non-empty, <=4096 chars, no CR/LF)` };
    out[f] = v;
  }
  return { ok: true, value: out };
}

export function parseCredentials(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw || raw === "{}") return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o !== null && typeof o === "object" && !Array.isArray(o)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(k)) out[k] = v;
      }
      return out;
    }
  } catch { /* fall through */ }
  return {};
}

export function maskCredentials(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) out[k] = mask(v);
  return out;
}

export const QUOTA: Record<string, number | null> = {
  cartesia: 20000, // "20,000 free tokens" — countable tokens
  elevenlabs: 10000, // "10k credits/mo free" — countable credits
  tavily: 1000, // "1,000 credits/mo free" — countable credits
  "brave-search": 2000, // "2,000 queries/mo free" — countable queries
  serper: 2500, // "2,500 queries one-time" — countable queries
  scrapingbee: 1000, // "1,000 free credits" — countable credits
  resend: 3000, // "3,000/mo ... free" — countable emails/mo
  mailgun: 5000, // "5k/3mo trial" — countable emails per trial
  postmark: 100, // "100/mo trial" — countable emails/mo
  upstash: 500000, // "500k cmds/mo free" — countable commands/mo
  custom: null,
  // Null with reason — rate-limits belong to cooldown, not QUOTA:
  groq: null, // "30 req/min, 14.4k req/day" — rate-limit only
  openrouter: null, // "~20 RPM / 200 RPD" — rate-limit only
  gemini: null, // "15 RPM / 1500 RPD" — rate-limit only
  finnhub: null, // "60/min free" — rate-limit only
  openweather: null, // "1,000/day, 60/min" — daily/minute rate, belongs to cooldown
  sendgrid: null, // "100/day free (60-day trial)" — daily rate + time-boxed trial
  cloudflare: null, // "100k req/day" — daily rate, belongs to cooldown
  huggingface: null, // "hourly limits" — rate-limit, no countable total
  cohere: null, // "trial key, rate-limited" — no numeric total
  // Null with reason — dollar-denominated, not comparable to token/credit/request counts:
  fireworks: null, // "$1 credit" — dollars, not countable units
  together: null, // "$1 credit" — dollars
  replicate: null, // "~$5 trial, per-second GPU" — dollars + usage-based
  openai: null, // "PAYG, $5 min prepay" — PAYG dollars
  anthropic: null, // "$5 credit" — dollars
  perplexity: null, // "$5 credit" — dollars
  deepgram: null, // "$200 credit" — dollars
  twilio: null, // "$15 credit trial" — dollars
  // Null with reason — non-countable, vague, or mixed units:
  mistral: null, // "trial credits, then PAYG" — no numeric total
  anyscale: null, // "legacy, deprecated" — no quota
  supabase: null, // "500MB DB, 5GB egress, 50k MAU" — storage/bandwidth/users, not tokens/credits/emails/queries
  neon: null, // "0.5GB, 100 CU-hrs/mo" — storage/compute, not comparable units
  turso: null, // "5-9GB, 500M reads/mo" — mixed storage range + reads, no single quota
  appwrite: null, // "75k MAU, 2 projects" — users/projects, not countable consumption units
  mapbox: null, // "100k geocode/mo, 50k loads/mo" — mixed units, no single quota
  googlemaps: null, // "~10k/SKU/mo under $200 credit" — approximate, SKU-varying, dollar-backed
};

/** Quota window: "month" resets each calendar month (UTC), "day" resets each UTC day, "all" accumulates lifetime. */
export type QuotaWindow = "month" | "day" | "all";

export const QUOTA_WINDOW: Record<string, QuotaWindow> = {
  cartesia: "all", // token grant per key, no monthly reset documented
  elevenlabs: "month",
  tavily: "month",
  "brave-search": "month",
  serper: "all", // one-time grant
  scrapingbee: "all", // one-time credits
  resend: "month",
  mailgun: "all", // trial grant
  postmark: "month",
  upstash: "month",
  custom: "all",
  // Null-quota providers: window is irrelevant (no limit enforced), recorded as "all".
  groq: "all",
  openrouter: "all",
  gemini: "all",
  finnhub: "all",
  openweather: "all",
  sendgrid: "all",
  cloudflare: "all",
  huggingface: "all",
  cohere: "all",
  fireworks: "all",
  together: "all",
  replicate: "all",
  openai: "all",
  anthropic: "all",
  perplexity: "all",
  deepgram: "all",
  twilio: "all",
  mistral: "all",
  anyscale: "all",
  supabase: "all",
  neon: "all",
  turso: "all",
  appwrite: "all",
  mapbox: "all",
  googlemaps: "all",
};

export function quotaForProvider(provider: string): { limit: number | null; window: QuotaWindow } {
  return { limit: QUOTA[provider] ?? null, window: QUOTA_WINDOW[provider] ?? "all" };
}

/**
 * Daily caps enforced in addition to the primary quota. A key is eligible
 * only when it is under *every* applicable limit (e.g. resend: 3000/mo AND
 * 100/day). Primary `QUOTA` stays the legacy single-limit view; this table
 * adds the second dimension without breaking `quotaForProvider` callers.
 */
export const QUOTA_DAILY: Record<string, number> = {
  groq: 14400, // "14.4k req/day"
  openrouter: 200, // "~200 RPD"
  gemini: 1500, // "1500 RPD"
  openweather: 1000, // "1,000/day"
  sendgrid: 100, // "100/day"
  cloudflare: 100000, // "100k req/day"
  resend: 100, // "100/day" in addition to 3000/mo
};

/** All enforceable limits for a provider (primary + daily). Empty = unlimited. */
export function quotaLimitsForProvider(provider: string): { limit: number; window: QuotaWindow }[] {
  const out: { limit: number; window: QuotaWindow }[] = [];
  const primary = quotaForProvider(provider);
  if (primary.limit !== null) out.push({ limit: primary.limit, window: primary.window });
  const daily = QUOTA_DAILY[provider];
  if (typeof daily === "number" && daily > 0) {
    // Avoid duplicating when the primary limit already is the daily one.
    if (!(primary.limit === daily && primary.window === "day")) out.push({ limit: daily, window: "day" });
  }
  return out;
}

/** SQL fragment restricting joined usage rows to the quota window (UTC, matches datetime('now')). */
export function quotaWindowFilter(window: QuotaWindow, column = "u.created_at"): string {
  if (column !== "u.created_at" && column !== "created_at") throw new Error("invalid quota column");
  if (window === "month") return ` AND ${column} >= date('now','start of month')`;
  if (window === "day") return ` AND ${column} >= date('now')`;
  return "";
}

export function getPool(poolId: number) {
  return sdb.prepare("SELECT * FROM pools WHERE id = ?").get(poolId) as
    | { id: number; provider: string; name: string; cursor: number; base_url: string; key_header: string; key_prefix: string; created_at: string }
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
for (const col of ["cooldown_until INTEGER NOT NULL DEFAULT 0", "latency_ms REAL", "consec_fail INTEGER NOT NULL DEFAULT 0"] as const) {
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
