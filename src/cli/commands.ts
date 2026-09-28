/**
 * Presentation-free command core for the assistant CLI.
 * No console/readline/Ink here — dispatch() returns view-models and each
 * frontend (plain-text one-shot, Ink shell) renders them its own way.
 */
import fs from "node:fs";
import path from "node:path";
import { sdb, PROVIDERS, mask, poolSummary, isMultiFieldProvider, normalizeCredentials } from "../pool/index.js";
import { nextKey, recordUsage } from "../pool/rotation.js";
import { MAX_KEYS_PER_POOL, MAX_API_KEY_CHARS } from "../router/api.js";
import { PACKAGE_ROOT } from "../config/paths.js";
import { parse, suggest } from "./nl.js";
import type { PoolRow, UsageView } from "./ui.js";
import { fmtFull, helpBox } from "./ui.js";

export type PoolRef = { id: number; provider: string; name: string };

export type CmdResult =
  | { kind: "message"; tone: "ok" | "err" | "info"; text: string }
  | { kind: "pools"; pools: PoolRow[] }
  | { kind: "providers" }
  | { kind: "keys"; pool: PoolRef; keys: { id: number; label: string; masked: string }[] }
  | { kind: "usage"; view: UsageView; perKey: { label: string; masked: string; used: number }[] }
  | { kind: "watch"; pool: PoolRef }
  | { kind: "import"; pool: PoolRef; expected: number | null; hint: string }
  | { kind: "serve"; already: boolean }
  | { kind: "clear" }
  | { kind: "exit" };

export function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function allPools(): PoolRef[] {
  return sdb.prepare("SELECT id, provider, name FROM pools ORDER BY id").all() as PoolRef[];
}

/** Resolve free-text ref: numeric id, provider id, or name substring. */
export function resolvePool(ref: string): PoolRef | null {
  const pools = allPools();
  if (pools.length === 0) return null;
  const t = ref.trim().toLowerCase();
  if (!t) return pools[0]!;
  if (/^\d+$/.test(t)) {
    const hit = pools.find((p) => p.id === Number(t));
    if (hit) return hit;
  }
  const byProvider = pools.filter((p) => p.provider.toLowerCase() === t);
  if (byProvider.length > 0) return byProvider[0]!;
  const byName = pools.filter((p) => p.name.toLowerCase().includes(t));
  if (byName.length > 0) return byName[0]!;
  const byProviderSub = pools.filter((p) => p.provider.toLowerCase().includes(t));
  if (byProviderSub.length > 0) return byProviderSub[0]!;
  return null;
}

function needPool(ref: string): { pool: PoolRef } | { error: string } {
  const p = resolvePool(ref);
  if (!p) {
    return { error: ref.trim() ? `No pool matches "${ref.trim()}". Try 'list pools'.` : "No pools yet — try: create pool <name> for <provider>." };
  }
  return { pool: p };
}

function poolsResult(): CmdResult {
  const pools: PoolRow[] = (
    sdb.prepare("SELECT id, provider, name FROM pools ORDER BY id").all() as PoolRef[]
  ).map((p) => {
    const s = poolSummary(p.id);
    const keyCount = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(p.id) as { n: number }).n;
    return {
      id: p.id, name: p.name, provider: p.provider, keys: keyCount,
      used: s?.usedInWindow ?? 0, quota: s?.quota ?? null, active: keyCount > 0,
    };
  });
  return { kind: "pools", pools };
}

function keysResult(ref: string): CmdResult {
  const r = needPool(ref);
  if ("error" in r) return { kind: "message", tone: "err", text: r.error };
  const rows = sdb
    .prepare("SELECT id, label, api_key FROM pool_keys WHERE pool_id = ? ORDER BY id")
    .all(r.pool.id) as { id: number; label: string; api_key: string }[];
  return {
    kind: "keys", pool: r.pool,
    keys: rows.map((k) => ({ id: k.id, label: k.label, masked: mask(k.api_key) })),
  };
}

function usageResult(ref: string): CmdResult {
  const r = needPool(ref);
  if ("error" in r) return { kind: "message", tone: "err", text: r.error };
  const s = poolSummary(r.pool.id);
  if (!s) return { kind: "message", tone: "err", text: "Pool not found." };
  const cooling = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ? AND cooldown_until > ?").get(r.pool.id, Date.now()) as { n: number }).n;
  const perKey = s.perKey.map((k) => {
    const row = sdb.prepare("SELECT api_key FROM pool_keys WHERE id = ?").get(k.id) as { api_key: string } | undefined;
    return { label: k.label, masked: mask(row?.api_key ?? ""), used: k.used };
  });
  return {
    kind: "usage",
    view: { id: s.id, name: s.name, provider: s.provider, used: s.usedInWindow, quota: s.quota, remaining: s.remaining, keys: s.keys, cooling },
    perKey,
  };
}

function nextResult(ref: string): CmdResult {
  const r = needPool(ref);
  if ("error" in r) return { kind: "message", tone: "err", text: r.error };
  const sel = nextKey(r.pool.id);
  if ("error" in sel) return { kind: "message", tone: "err", text: `Error: ${sel.error}` };
  return { kind: "message", tone: "ok", text: `Next key in pool #${r.pool.id}: #${sel.key_id} ${sel.label} (${sel.masked})` };
}

function consumeResult(tokens: number, ref: string): CmdResult {
  const r = needPool(ref);
  if ("error" in r) return { kind: "message", tone: "err", text: r.error };
  const res = recordUsage(r.pool.id, tokens);
  if ("error" in res) return { kind: "message", tone: "err", text: `Error: ${res.error}` };
  return { kind: "message", tone: "ok", text: `Recorded ${fmtFull(tokens)} tokens on #${res.key_id} ${res.label} (${res.masked}).` };
}

async function createResult(name: string, provider: string, ask: (q: string) => Promise<string>): Promise<CmdResult> {
  const msg = (tone: "ok" | "err" | "info", text: string): CmdResult => ({ kind: "message", tone, text });
  let n = name.trim();
  let pv = provider.trim().toLowerCase();
  if (!pv) pv = (await ask("Provider id (e.g. groq)? ")).trim().toLowerCase();
  const known = PROVIDERS.find((p) => p.id === pv);
  if (!known) return msg("err", `Unknown provider "${pv}". Try 'list providers'.`);
  if (!n) n = (await ask(`Name for the new ${known.name} pool? `)).trim();
  if (!n) return msg("info", "Cancelled (empty name).");
  if (n.length > 80) return msg("err", "Name must be <= 80 characters.");
  const r = sdb.prepare("INSERT INTO pools (provider, name) VALUES (?, ?)").run(known.id, n);
  return msg("ok", `Created pool #${r.lastInsertRowid} "${n}" (${known.id}). Add keys with: add keys to ${known.id}`);
}

async function deleteResult(ref: string, ask: (q: string) => Promise<string>): Promise<CmdResult> {
  const msg = (tone: "ok" | "err" | "info", text: string): CmdResult => ({ kind: "message", tone, text });
  const r = needPool(ref);
  if ("error" in r) return msg("err", r.error);
  const ans = (await ask(`Delete pool #${r.pool.id} "${r.pool.name}" and its keys? [y/N] `)).trim().toLowerCase();
  if (ans !== "y" && ans !== "yes") return msg("info", "Cancelled.");
  sdb.exec("BEGIN IMMEDIATE");
  try {
    sdb.prepare("DELETE FROM usage WHERE pool_id = ?").run(r.pool.id);
    sdb.prepare("DELETE FROM pool_keys WHERE pool_id = ?").run(r.pool.id);
    sdb.prepare("DELETE FROM pools WHERE id = ?").run(r.pool.id);
    sdb.exec("COMMIT");
  } catch (e) {
    try { sdb.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
  return msg("ok", `Deleted pool #${r.pool.id} "${r.pool.name}".`);
}

/** Insert pasted lines as keys. Returns counts. Shared by interactive + piped import. */
export function insertKeys(pool: PoolRef, rawLines: string[]): { added: number; skipped: number } {
  const existing = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(pool.id) as { n: number }).n;
  const multi = isMultiFieldProvider(pool.provider);
  let added = 0;
  let skipped = 0;
  for (const raw of rawLines) {
    if (existing + added >= MAX_KEYS_PER_POOL) break;
    if (multi) {
      let obj: unknown;
      try { obj = JSON.parse(raw); } catch { skipped++; continue; }
      const norm = normalizeCredentials(pool.provider, obj);
      if (!norm.ok) { skipped++; continue; }
      const single = norm.value["apiKey"] ?? norm.value["api_key"] ?? norm.value["apiToken"] ?? Object.values(norm.value)[0] ?? "";
      sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key, credentials) VALUES (?, ?, ?, ?)").run(pool.id, `key ${existing + added + 1}`, single, JSON.stringify(norm.value));
      added++;
    } else {
      const key = raw.trim();
      if (!key || /[\r\n\0]/.test(key)) { skipped++; continue; }
      if (key.length > MAX_API_KEY_CHARS) { skipped++; continue; }
      const dup = sdb.prepare("SELECT id FROM pool_keys WHERE pool_id = ? AND api_key = ?").get(pool.id, key);
      if (dup) { skipped++; continue; }
      sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, ?, ?)").run(pool.id, `key ${existing + added + 1}`, key);
      added++;
    }
  }
  return { added, skipped };
}

export function importHint(pool: PoolRef, expected: number | null): string {
  const base = isMultiFieldProvider(pool.provider)
    ? "This provider needs multi-field credentials: paste one JSON object per line."
    : "Paste API keys (one per line, empty line to finish):";
  return expected !== null ? `${base} (expecting ~${expected})` : base;
}

export type LiveStats = { reqMin: number; tokMin: number; avgLatency: number | null; perKey: { id: number; label: string; apiKey: string; used: number }[] };

export function liveStats(poolId: number): LiveStats {
  const reqMin = (sdb.prepare("SELECT COUNT(*) AS n FROM usage WHERE pool_id = ? AND created_at >= datetime('now','-1 minute')").get(poolId) as { n: number }).n;
  const tokMin = (sdb.prepare("SELECT COALESCE(SUM(tokens),0) AS t FROM usage WHERE pool_id = ? AND created_at >= datetime('now','-1 minute')").get(poolId) as { t: number }).t;
  const lat = sdb.prepare("SELECT AVG(latency_ms) AS a FROM pool_keys WHERE pool_id = ? AND latency_ms IS NOT NULL").get(poolId) as { a: number | null };
  const perKey = sdb
    .prepare("SELECT k.id, k.label, k.api_key AS apiKey, COALESCE(SUM(u.tokens),0) AS used FROM pool_keys k LEFT JOIN usage u ON u.key_id = k.id WHERE k.pool_id = ? GROUP BY k.id ORDER BY k.id")
    .all(poolId) as LiveStats["perKey"];
  return { reqMin, tokMin, avgLatency: lat.a, perKey };
}

let serverStarted = false;

/** Execute one input line. No I/O except via ask(); returns a view-model. */
export async function dispatch(input: string, ask: (q: string) => Promise<string>): Promise<CmdResult> {
  const intent = parse(input);
  switch (intent.kind) {
    case "exit": return { kind: "exit" };
    case "help": return { kind: "message", tone: "info", text: helpBox() };
    case "clear": return { kind: "clear" };
    case "version": return { kind: "message", tone: "info", text: readVersion() };
    case "list-pools": return poolsResult();
    case "list-providers": return { kind: "providers" };
    case "list-keys": return keysResult(intent.ref);
    case "usage": return usageResult(intent.ref);
    case "next": return nextResult(intent.ref);
    case "consume": return consumeResult(intent.tokens, intent.ref);
    case "create-pool": return createResult(intent.name, intent.provider, ask);
    case "delete-pool": return deleteResult(intent.ref, ask);
    case "add-keys": {
      const r = needPool(intent.ref);
      if ("error" in r) return { kind: "message", tone: "err", text: r.error };
      return { kind: "import", pool: r.pool, expected: intent.count, hint: importHint(r.pool, intent.count) };
    }
    case "watch": {
      const r = needPool(intent.ref);
      if ("error" in r) return { kind: "message", tone: "err", text: r.error };
      return { kind: "watch", pool: r.pool };
    }
    case "serve": {
      if (serverStarted) return { kind: "serve", already: true };
      serverStarted = true;
      await import("../server.js");
      return { kind: "serve", already: false };
    }
    case "unknown": {
      const s = suggest(input, PROVIDERS.map((p) => p.id));
      return { kind: "message", tone: "err", text: `I didn't understand that.${s ? ` Did you mean '${s}'?` : ""} Type '.help' for commands.` };
    }
  }
}
