import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "../config/env.js";

export { DB_PATH };

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const sdb = new DatabaseSync(DB_PATH);

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
        keyFields: Array.isArray(p.keyFields) ? (p.keyFields as string[]) : ["api_key"],
        hint: String(p.hint ?? ""),
        baseUrl: p.baseUrl as string,
        keyHeader: String(p.keyHeader ?? "X-API-Key"),
        keyPrefix: String(p.keyPrefix ?? ""),
        extraHeaders: (p.extraHeaders ?? {}) as Record<string, string>,
        docsUrl: typeof p.docsUrl === "string" ? p.docsUrl : undefined,
        logoFile: typeof p.logo === "string" ? path.basename(p.logo) : undefined,
        poolable: (p.poolable ?? true) as boolean | string,
      }));
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

export const PROVIDERS: Provider[] = loadProviders();

export function mask(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
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

/** Quota window: "month" resets each calendar month (UTC), "all" accumulates lifetime. */
export type QuotaWindow = "month" | "all";

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

/** SQL fragment restricting joined usage rows to the quota window (UTC, matches datetime('now')). */
export function quotaWindowFilter(window: QuotaWindow, column = "u.created_at"): string {
  return window === "month" ? ` AND ${column} >= date('now','start of month')` : "";
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
} catch {}
try {
  sdb.exec(`ALTER TABLE pools ADD COLUMN key_header TEXT NOT NULL DEFAULT 'X-API-Key'`);
} catch {}
try {
  sdb.exec(`ALTER TABLE pools ADD COLUMN key_prefix TEXT NOT NULL DEFAULT ''`);
} catch {}
for (const col of ["cooldown_until INTEGER NOT NULL DEFAULT 0", "latency_ms REAL", "consec_fail INTEGER NOT NULL DEFAULT 0"]) {
  try {
    sdb.exec(`ALTER TABLE pool_keys ADD COLUMN ${col}`);
  } catch {}
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
  return { ...pool, keys, used, usedInWindow: windowed, quota, quotaWindow: window, remaining: quota === null ? null : quota * keys - windowed, perKey };
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
