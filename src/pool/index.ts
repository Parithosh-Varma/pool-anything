import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH =
  process.env.LOCAL_DB_PATH ?? path.join(process.cwd(), "data", "pool-anything.db");

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
  cartesia: 20000,
  custom: null,
};

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
  const quota = QUOTA[pool.provider] ?? null;
  const perKey = sdb
    .prepare(
      `SELECT k.id, k.label, COALESCE(SUM(u.tokens),0) AS used
       FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id
       WHERE k.pool_id = ? GROUP BY k.id ORDER BY k.id`
    )
    .all(poolId) as { id: number; label: string; used: number }[];
  return { ...pool, keys, used, quota, remaining: quota === null ? null : quota * keys - used, perKey };
}
