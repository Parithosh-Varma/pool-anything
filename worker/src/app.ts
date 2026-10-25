// Cloudflare Worker app: same REST contract as the Node server, backed by one
// SQLite Durable Object. The hosted Pages UI (and the browser shim) can point
// at this Worker directly.

import { isMultiFieldProvider, mask, maskCredentials, normalizeCredentials, parseCredentials, providerKeyFields } from "../../src/shared/pool-core.js";
import { checkTarget } from "../../src/shared/proxy-rules.js";
import type { ProxyOpts } from "../../src/shared/proxy-rules.js";
import { STRATEGY_NAMES, isStrategyName } from "../../src/pool/strategy.js";
import { MAX_API_KEY_CHARS, MAX_KEYS_PER_POOL, MAX_POOLS, matchKeyRoute, matchPoolRoute } from "../../src/router/api.js";
import {
  createPool,
  deleteKey,
  deletePool,
  dbPing,
  ensureSchema,
  findDuplicateKey,
  getAnalytics,
  getKeyRow,
  getPool,
  insertKey,
  keyCount,
  listCalls,
  listKeyRows,
  listPools,
  nextKey,
  poolCount,
  poolSummary,
  recordUsage,
  updateKey,
  updatePoolStrategy,
  type KeyPatch,
} from "./db.js";
import type { DbEnv, Env } from "./env.js";
import {
  corsHeaders,
  errorResponse,
  isAuthorized,
  json,
  readJson,
  requiresAuth,
  text,
  withCors,
} from "./http.js";
import { DEFAULT_UI_URL, MAX_PROXY_BODY_BYTES, MAX_TOKENS_PER_REQUEST, WORKER_VERSION } from "./limits.js";
import { forward } from "./proxy.js";
import { PROVIDERS } from "./providers.js";
import { defaultStrategy, rotationOptions } from "./strategy-config.js";

const JSON_BODY_LIMIT = 1_000_000;

function allowPrivate(env: Env): boolean {
  return env.ALLOW_PRIVATE_UPSTREAM === "1";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Session key for sticky/shuffle-shard routing. Invalid values are ignored, not fatal. */
function stickyValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t || t.length > 256 || /[\r\n\x00]/.test(t)) return undefined;
  return t;
}

/** Rotation config for this request, bound to the Worker's env. */
function rotationOpts(env: Env) {
  return { defaultStrategy: defaultStrategy(env), options: rotationOptions(env) };
}

function uiUrl(env: Env, url: URL): string {
  const target = new URL(env.UI_URL || DEFAULT_UI_URL);
  target.searchParams.set("api", url.origin);
  return target.toString();
}

function analyticsFallback(): unknown {
  return {
    requests: 0,
    tokens: 0,
    pools: 0,
    keys: 0,
    cooling: 0,
    avgTokens: 0,
    series: [],
    keysSeries: [],
    poolsSeries: [],
    deltaRequestsPct: 0,
    deltaTokensPct: 0,
  };
}

async function route(request: Request, env: DbEnv, url: URL): Promise<Response> {
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/") {
    return json({
      name: "pool-anything",
      version: WORKER_VERSION,
      runtime: "cloudflare-workers",
      ui: uiUrl(env, url),
      health: "/health",
      api: "/api",
    });
  }
  if (method === "GET" && pathname === "/ui") {
    return new Response(null, { status: 302, headers: { location: uiUrl(env, url) } });
  }
  if (method === "GET" && pathname === "/health") return text("ok\n");

  if (method === "GET" && pathname === "/api/providers") return json(PROVIDERS);
  if (method === "GET" && pathname === "/api/version") {
    return json({ current: WORKER_VERSION, latest: null, updateAvailable: false, runtime: "cloudflare-workers" });
  }
  if (method === "POST" && pathname === "/api/update") {
    return json({ ok: false, error: "self-update is not available on Cloudflare Workers — deploy a new version instead" }, 501);
  }
  if (method === "GET" && pathname === "/api/analytics") {
    try {
      return json(await getAnalytics(env.DB));
    } catch {
      return json(analyticsFallback(), 500);
    }
  }
  if (method === "GET" && pathname === "/api/db/ping") {
    const r = await dbPing(env.DB);
    return json(r, r.ok ? 200 : 500);
  }

  if (method === "GET" && pathname === "/api/pools") {
    return json(await listPools(env.DB));
  }
  if (method === "POST" && pathname === "/api/pools") {
    const b = (await readJson(request, JSON_BODY_LIMIT)) as {
      provider?: string;
      name?: string;
      base_url?: string;
      key_header?: string;
      key_prefix?: string;
      strategy?: string;
    };
    const provider = typeof b.provider === "string" ? b.provider.trim() : "";
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!provider || !name) return json({ error: "provider + name required" }, 400);
    if (provider.length > 80 || name.length > 80) return json({ error: "provider + name must be <= 80 characters" }, 400);
    const strategy = typeof b.strategy === "string" ? b.strategy.trim().toLowerCase() : "";
    if (strategy && !isStrategyName(strategy))
      return json({ error: `unknown strategy; valid: ${STRATEGY_NAMES.join(", ")}` }, 400);
    if ((await poolCount(env.DB)) >= MAX_POOLS) return json({ error: `pool limit reached (${MAX_POOLS})` }, 400);
    // Fail fast on auth config the proxy could never use (forward-time check stays as backstop).
    const kh = typeof b.key_header === "string" ? b.key_header.trim() : "";
    if (kh) {
      const okHeader =
        /^[A-Za-z0-9-]+$/.test(kh) || (kh.startsWith("query:") && /^[A-Za-z0-9_-]+$/.test(kh.slice("query:".length)));
      if (!okHeader) return json({ error: "key_header invalid" }, 400);
      if (/[\r\n\x00]/.test(kh)) return json({ error: "key_header invalid" }, 400);
    }
    const baseUrl = typeof b.base_url === "string" ? b.base_url.trim() : "";
    const keyPrefix = typeof b.key_prefix === "string" ? b.key_prefix : "";
    if (/[\r\n\x00]/.test(keyPrefix)) return json({ error: "key_prefix invalid" }, 400);
    if (baseUrl) {
      const safe = checkTarget(baseUrl, kh || "X-API-Key", allowPrivate(env));
      if (!safe.ok) return json(safe, 400);
    }
    const created = await createPool(env.DB, {
      provider,
      name,
      base_url: baseUrl,
      key_header: kh,
      key_prefix: keyPrefix,
      strategy,
    });
    return json(created);
  }

  const poolR = matchPoolRoute(pathname);
  if (poolR) {
    const poolId = poolR.poolId;
    const sub = poolR.sub;

    if (method === "GET" && !sub) {
      const s = await poolSummary(env.DB, poolId);
      if (!s) return json({ error: "pool not found" }, 404);
      return json(s);
    }
    if (method === "DELETE" && !sub) {
      const ok = await deletePool(env.DB, poolId);
      if (!ok) return json({ error: "pool not found" }, 404);
      return json({ ok: true });
    }
    if (method === "PATCH" && !sub) {
      const b = (await readJson(request, JSON_BODY_LIMIT)) as { strategy?: string };
      if (b.strategy === undefined) return json({ error: "nothing to update" }, 400);
      const strategy = typeof b.strategy === "string" ? b.strategy.trim().toLowerCase() : null;
      if (strategy === null || (strategy && !isStrategyName(strategy)))
        return json({ error: `unknown strategy; valid: ${STRATEGY_NAMES.join(", ")}` }, 400);
      const updated = await updatePoolStrategy(env.DB, poolId, strategy);
      if (!updated) return json({ error: "pool not found" }, 404);
      return json(updated);
    }
    if (method === "GET" && sub === "/next") {
      const sel = await nextKey(env.DB, poolId, {
        ...rotationOpts(env),
        sticky: stickyValue(url.searchParams.get("sticky")),
      });
      if ("error" in sel) return json(sel, sel.error === "pool not found" ? 404 : 400);
      return json(sel);
    }
    if (method === "POST" && sub === "/consume") {
      const b = (await readJson(request, JSON_BODY_LIMIT)) as { tokens?: number; key_id?: number; sticky?: string };
      const tok = b.tokens;
      if (!Number.isInteger(tok) || (tok as number) <= 0 || (tok as number) > MAX_TOKENS_PER_REQUEST)
        return json({ error: `tokens must be a positive integer <= ${MAX_TOKENS_PER_REQUEST}` }, 400);
      if (b.key_id !== undefined && (!Number.isInteger(b.key_id) || b.key_id <= 0))
        return json({ error: "key_id must be a positive integer" }, 400);
      const sel = await recordUsage(env.DB, poolId, tok as number, b.key_id, {
        ...rotationOpts(env),
        sticky: stickyValue(b.sticky),
      });
      if ("error" in sel) {
        const code = sel.error === "pool not found" || sel.error === "key not found" ? 404 : 400;
        return json(sel, code);
      }
      return json(sel);
    }
    if (method === "GET" && sub === "/usage") {
      const s = await poolSummary(env.DB, poolId);
      if (!s) return json({ error: "pool not found" }, 404);
      return json({
        pool_id: s.id,
        used: s.used,
        usedInWindow: s.usedInWindow,
        quota: s.quota,
        quotaWindow: s.quotaWindow,
        remaining: s.remaining,
        perKey: s.perKey,
        limits: s.limits,
      });
    }
    if (method === "GET" && sub === "/calls") {
      const pool = await getPool(env.DB, poolId);
      if (!pool) return json({ error: "pool not found" }, 404);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
      return json(await listCalls(env.DB, poolId, limit));
    }
    if (method === "POST" && sub === "/proxy") {
      // Media-aware limit: base64 image/audio/video payloads ride inside JSON.
      const raw = await readJson(request, MAX_PROXY_BODY_BYTES);
      const b = asRecord(raw);
      if (!b) return json({ error: "proxy body must be an object" }, 400);
      const sticky =
        stickyValue(request.headers.get("x-pool-sticky")) ?? stickyValue(b.sticky);
      const r = await forward(env.DB, poolId, b as ProxyOpts, env, { sticky });
      if ("error" in r) return json(r, r.status === 200 ? 400 : r.status);
      return json({
        key_id: r.key_id,
        label: r.label,
        masked: r.masked,
        status: r.upstreamStatus,
        body: r.body,
        encoding: r.encoding,
        contentType: r.contentType,
        truncated: r.truncated,
        tried: r.tried,
      });
    }
  }

  // README alias: POST /proxy/:id is the same handler as /api/pools/:id/proxy.
  const proxyAlias = pathname.match(/^\/proxy\/(\d+)$/);
  if (method === "POST" && proxyAlias) {
    const b = asRecord(await readJson(request, MAX_PROXY_BODY_BYTES));
    if (!b) return json({ error: "proxy body must be an object" }, 400);
    const sticky = stickyValue(request.headers.get("x-pool-sticky")) ?? stickyValue(b.sticky);
    const r = await forward(env.DB, Number(proxyAlias[1]), b as ProxyOpts, env, { sticky });
    if ("error" in r) return json(r, r.status === 200 ? 400 : r.status);
    return json({
      key_id: r.key_id,
      label: r.label,
      masked: r.masked,
      status: r.upstreamStatus,
      body: r.body,
      encoding: r.encoding,
      contentType: r.contentType,
      truncated: r.truncated,
      tried: r.tried,
    });
  }

  const keyR = matchKeyRoute(pathname);
  if (keyR) {
    const poolId = keyR.poolId;
    const keyId = keyR.keyId === null ? undefined : keyR.keyId;

    if (method === "GET" && keyId === undefined) {
      const pool = await getPool(env.DB, poolId);
      if (!pool) return json({ error: "pool not found" }, 404);
      const fields = providerKeyFields(PROVIDERS, pool.provider);
      const now = Date.now();
      const rows = await listKeyRows(env.DB, poolId);
      return json(
        rows.map((k) => {
          const creds = parseCredentials(k.credentials);
          return {
            id: k.id,
            label: k.label,
            masked: mask(k.api_key),
            info: k.info,
            created_at: k.created_at,
            cooling: k.cooldown_until > now,
            weight: k.weight,
            priority: k.priority,
            picks: k.picks,
            last_used_at: k.last_used_at,
            keyFields: fields,
            credentials: Object.keys(creds).length > 0 ? maskCredentials(creds) : undefined,
          };
        })
      );
    }

    if (method === "POST" && keyId === undefined) {
      const pool = await getPool(env.DB, poolId);
      if (!pool) return json({ error: "pool not found" }, 404);
      const b = (await readJson(request, JSON_BODY_LIMIT)) as {
        label?: string;
        api_key?: string;
        credentials?: unknown;
        info?: string;
        weight?: number;
        priority?: number;
      };
      const label = typeof b.label === "string" ? b.label.trim() : "";
      if (!label) return json({ error: "label required" }, 400);
      if (label.length > 80) return json({ error: "label must be <= 80 characters" }, 400);
      if (/[\r\n\x00]/.test(label)) return json({ error: "label must not contain CR/LF" }, 400);
      if (b.info !== undefined && typeof b.info !== "string") return json({ error: "info must be a string" }, 400);
      const weight = b.weight === undefined ? 1 : b.weight;
      if (!Number.isInteger(weight) || weight < 0 || weight > 1000)
        return json({ error: "weight must be an integer 0..1000" }, 400);
      const priority = b.priority === undefined ? 0 : b.priority;
      if (!Number.isInteger(priority) || priority < 0 || priority > 1000)
        return json({ error: "priority must be an integer 0..1000 (lower wins)" }, 400);

      const fields = providerKeyFields(PROVIDERS, pool.provider);
      const multi = isMultiFieldProvider(PROVIDERS, pool.provider);
      let apiKey = "";
      let credJson = "{}";
      if (multi) {
        // Multi-field providers require a credentials object; api_key alone is rejected
        // so partial secrets are never stored.
        if (b.credentials === undefined) return json({ error: `credentials required: ${fields.join(", ")}` }, 400);
        const norm = normalizeCredentials(fields, b.credentials);
        if (!norm.ok) return json({ error: norm.error }, 400);
        credJson = JSON.stringify(norm.value);
        // api_key stays a non-empty dedup/display handle: prefer a conventional
        // single-secret field, else the first field value.
        const single = (norm.value["apiKey"] ??
          norm.value["api_key"] ??
          norm.value["apiToken"] ??
          norm.value["platformToken"] ??
          norm.value["anonKey"] ??
          norm.value["authToken"] ??
          fields.map((f) => norm.value[f]).find(Boolean) ??
          "") as string;
        apiKey = single;
        if (/[\r\n\x00]/.test(apiKey)) return json({ error: "credentials must not contain CR/LF" }, 400);
      } else {
        apiKey = typeof b.api_key === "string" ? b.api_key.trim() : "";
        if (b.credentials !== undefined) {
          const norm = normalizeCredentials(fields, b.credentials);
          if (!norm.ok) return json({ error: norm.error }, 400);
          credJson = JSON.stringify(norm.value);
          const v = norm.value[fields[0]!] ?? apiKey;
          if (!apiKey) apiKey = v;
        }
        if (!apiKey) return json({ error: "label + api_key required" }, 400);
        if (/[\r\n\x00]/.test(apiKey)) return json({ error: "label + api_key must not contain CR/LF" }, 400);
      }
      if (apiKey.length > MAX_API_KEY_CHARS) return json({ error: `api_key must be <= ${MAX_API_KEY_CHARS} characters` }, 400);
      if ((await keyCount(env.DB, poolId)) >= MAX_KEYS_PER_POOL)
        return json({ error: `key limit reached (${MAX_KEYS_PER_POOL} per pool)` }, 400);
      if (await findDuplicateKey(env.DB, poolId, apiKey)) return json({ error: "duplicate api_key in this pool" }, 400);
      const id = await insertKey(env.DB, {
        poolId,
        label,
        apiKey,
        credentials: credJson,
        info: ((b.info ?? "") as string).slice(0, 200),
        weight,
        priority,
      });
      return json({ id });
    }

    if (method === "GET" && keyId !== undefined) {
      const row = await getKeyRow(env.DB, poolId, keyId);
      if (!row) return json({ error: "key not found" }, 404);
      const creds = parseCredentials(row.credentials);
      return json({
        id: row.id,
        label: row.label,
        api_key: row.api_key,
        credentials: Object.keys(creds).length > 0 ? creds : undefined,
        info: row.info,
        created_at: row.created_at,
        cooldown_until: row.cooldown_until,
        cooling: row.cooldown_until > Date.now(),
        weight: row.weight,
        priority: row.priority,
        picks: row.picks,
        last_used_at: row.last_used_at,
        masked: mask(row.api_key),
        maskedCredentials: Object.keys(creds).length > 0 ? maskCredentials(creds) : undefined,
      });
    }

    if (method === "PATCH" && keyId !== undefined) {
      const b = (await readJson(request, JSON_BODY_LIMIT)) as {
        label?: string;
        api_key?: string;
        credentials?: unknown;
        info?: string;
        weight?: number;
        priority?: number;
      };
      const cur = await getKeyRow(env.DB, poolId, keyId);
      if (!cur) return json({ error: "key not found" }, 404);
      if (
        b.label === undefined &&
        b.api_key === undefined &&
        b.credentials === undefined &&
        b.info === undefined &&
        b.weight === undefined &&
        b.priority === undefined
      )
        return json({ error: "nothing to update" }, 400);

      const patch: KeyPatch = {};
      if (b.weight !== undefined) {
        if (!Number.isInteger(b.weight) || b.weight < 0 || b.weight > 1000)
          return json({ error: "weight must be an integer 0..1000" }, 400);
        patch.weight = b.weight;
      }
      if (b.priority !== undefined) {
        if (!Number.isInteger(b.priority) || b.priority < 0 || b.priority > 1000)
          return json({ error: "priority must be an integer 0..1000 (lower wins)" }, 400);
        patch.priority = b.priority;
      }
      if (b.label !== undefined) {
        if (typeof b.label !== "string" || !b.label.trim() || b.label.trim().length > 80)
          return json({ error: "label must be a non-empty string <= 80 characters" }, 400);
        if (/[\r\n\x00]/.test(b.label)) return json({ error: "label must not contain CR/LF" }, 400);
        patch.label = b.label.trim();
      }
      if (b.api_key !== undefined) {
        if (typeof b.api_key !== "string" || !b.api_key.trim()) return json({ error: "api_key must not be empty" }, 400);
        if (b.api_key.trim().length > MAX_API_KEY_CHARS)
          return json({ error: `api_key must be <= ${MAX_API_KEY_CHARS} characters` }, 400);
        if (/[\r\n\x00]/.test(b.api_key)) return json({ error: "api_key must not contain CR/LF" }, 400);
        patch.api_key = b.api_key.trim();
      }
      if (b.credentials !== undefined) {
        const pool = await getPool(env.DB, poolId);
        if (!pool) return json({ error: "pool not found" }, 404);
        const norm = normalizeCredentials(providerKeyFields(PROVIDERS, pool.provider), b.credentials);
        if (!norm.ok) return json({ error: norm.error }, 400);
        patch.credentials = JSON.stringify(norm.value);
        // Keep api_key in sync when the update carries a conventional single secret.
        const single = norm.value["apiKey"] ?? norm.value["api_key"] ?? norm.value["apiToken"] ?? norm.value["platformToken"] ?? norm.value["anonKey"];
        if (typeof single === "string" && single) patch.api_key = single;
      }
      if (b.info !== undefined) {
        if (typeof b.info !== "string") return json({ error: "info must be a string" }, 400);
        patch.info = b.info.slice(0, 200);
      }

      await updateKey(env.DB, keyId, patch);
      const row = await getKeyRow(env.DB, poolId, keyId);
      if (!row) return json({ error: "key not found" }, 404);
      return json({
        id: row.id,
        label: row.label,
        masked: mask(row.api_key),
        maskedCredentials: maskCredentials(parseCredentials(row.credentials)),
        info: row.info,
        weight: row.weight,
        priority: row.priority,
      });
    }

    if (method === "DELETE" && keyId !== undefined) {
      const ok = await deleteKey(env.DB, poolId, keyId);
      if (!ok) return json({ error: "key not found" }, 404);
      return json({ ok: true });
    }
  }

  return pathname.startsWith("/api/") ? json({ error: "not found" }, 404) : text("not found\n", 404);
}

export async function handleRequest(request: Request, env: DbEnv): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    await ensureSchema(env.DB);
    const url = new URL(request.url);
    if (requiresAuth(request.method, url.pathname) && !isAuthorized(request, env)) {
      return withCors(json({ error: "unauthorized: missing or invalid bearer token" }, 401), cors);
    }
    return withCors(await route(request, env, url), cors);
  } catch (err) {
    return withCors(errorResponse(err), cors);
  }
}
