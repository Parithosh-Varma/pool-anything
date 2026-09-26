import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { HOST, PORT, startupWarnings } from "./config/env.js";
import { readJson, send } from "./common/http.js";
import { isAuthorized, requiresAuth } from "./middleware/auth.js";
import { sdb, PROVIDERS, mask, maskCredentials, normalizeCredentials, parseCredentials, providerKeyFields, getPool, poolSummary } from "./pool/index.js";
import { nextKey, recordUsage } from "./pool/rotation.js";
import { forward, MAX_TOKENS_PER_REQUEST, checkTarget } from "./proxy/forward.js";
import { DOCS_URL } from "./admin/branding.js";
import { page, keysPage, poolsPage, analyticsPage, playgroundPage, providerPage } from "./admin/pages.js";
import { MAX_POOLS, MAX_KEYS_PER_POOL, MAX_API_KEY_CHARS, matchPoolRoute, matchKeyRoute } from "./router/api.js";
import { health, readiness, analyticsSnapshot } from "./observability/health.js";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (requiresAuth(req.method ?? "GET", url.pathname) && !isAuthorized(req)) {
      send(res, 401, { error: "unauthorized: missing or invalid bearer token" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
  if (req.method === "GET" && (url.pathname === "/logo.png" || url.pathname === "/favicon.ico" || url.pathname === "/favicon.png")) {
    try {
      const p = path.join(process.cwd(), "src", "logo.png");
      const buf = fs.readFileSync(p);
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      res.end(buf);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/providers") {
    send(res, 200, PROVIDERS);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/analytics") {
    const r = analyticsSnapshot();
    send(res, r.status, r.body);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/pools") {
    send(res, 200, sdb.prepare("SELECT * FROM pools ORDER BY id DESC").all());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/pools") {
    const b = (await readJson(req)) as { provider?: string; name?: string; base_url?: string; key_header?: string; key_prefix?: string };
    const provider = typeof b.provider === "string" ? b.provider.trim() : "";
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!provider || !name)
      return send(res, 400, { error: "provider + name required" });
    if (provider.length > 80 || name.length > 80)
      return send(res, 400, { error: "provider + name must be <= 80 characters" });
    const total = (sdb.prepare("SELECT COUNT(*) AS n FROM pools").get() as { n: number }).n;
    if (total >= MAX_POOLS) return send(res, 400, { error: `pool limit reached (${MAX_POOLS})` });
    // Fail fast on auth config the proxy could never use (forward-time check stays as backstop).
    const kh = typeof b.key_header === "string" ? b.key_header.trim() : "";
    if (kh) {
      const okHeader = /^[A-Za-z0-9-]+$/.test(kh) || (kh.startsWith("query:") && /^[A-Za-z0-9_-]+$/.test(kh.slice("query:".length)));
      if (!okHeader) return send(res, 400, { error: "key_header invalid" });
      if (/[\r\n\x00]/.test(kh)) return send(res, 400, { error: "key_header invalid" });
    }
    const baseUrl = typeof b.base_url === "string" ? b.base_url.trim() : "";
    const keyPrefix = typeof b.key_prefix === "string" ? b.key_prefix : "";
    if (/[\r\n\x00]/.test(keyPrefix)) return send(res, 400, { error: "key_prefix invalid" });
    if (baseUrl) {
      const safe = checkTarget(baseUrl, kh || "X-API-Key");
      if (!safe.ok) return send(res, 400, safe);
    }
    const r = sdb
      .prepare("INSERT INTO pools (provider, name, base_url, key_header, key_prefix) VALUES (?, ?, ?, ?, ?)")
      .run(
        provider,
        name,
        baseUrl.slice(0, 500),
        kh.slice(0, 80),
        keyPrefix.slice(0, 40)
      );
    send(res, 200, sdb.prepare("SELECT * FROM pools WHERE id = ?").get(r.lastInsertRowid));
    return;
  }
  const poolR = matchPoolRoute(url.pathname);
  if (poolR) {
    const poolId = poolR.poolId;
    const sub = poolR.sub;
    if (req.method === "GET" && !sub) {
      const s = poolSummary(poolId);
      if (!s) return send(res, 404, { error: "pool not found" });
      send(res, 200, s);
      return;
    }
    if (req.method === "DELETE" && !sub) {
      sdb.exec("BEGIN IMMEDIATE");
      try {
        sdb.prepare("DELETE FROM usage WHERE pool_id = ?").run(poolId);
        sdb.prepare("DELETE FROM pool_keys WHERE pool_id = ?").run(poolId);
        const r = sdb.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
        if (r.changes === 0) {
          sdb.exec("ROLLBACK");
          return send(res, 404, { error: "pool not found" });
        }
        sdb.exec("COMMIT");
      } catch (e) {
        try { sdb.exec("ROLLBACK"); } catch { /* already rolled back */ }
        throw e;
      }
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && sub === "/next") {
      const sel = nextKey(poolId);
      if ("error" in sel) return send(res, sel.error === "pool not found" ? 404 : 400, sel);
      send(res, 200, sel);
      return;
    }
    if (req.method === "POST" && sub === "/consume") {
      const b = (await readJson(req)) as { tokens?: number; key_id?: number };
      const tok = b.tokens;
      if (!Number.isInteger(tok) || (tok as number) <= 0 || (tok as number) > MAX_TOKENS_PER_REQUEST)
        return send(res, 400, { error: `tokens must be a positive integer <= ${MAX_TOKENS_PER_REQUEST}` });
      if (b.key_id !== undefined && (!Number.isInteger(b.key_id) || b.key_id <= 0))
        return send(res, 400, { error: "key_id must be a positive integer" });
      const sel = recordUsage(poolId, tok as number, b.key_id);
      if ("error" in sel) {
        const code = sel.error === "pool not found" || sel.error === "key not found" ? 404 : 400;
        return send(res, code, sel);
      }
      send(res, 200, sel);
      return;
    }
    if (req.method === "GET" && sub === "/usage") {
      const s = poolSummary(poolId);
      if (!s) return send(res, 404, { error: "pool not found" });
      send(res, 200, { pool_id: s.id, used: s.used, usedInWindow: s.usedInWindow, quota: s.quota, quotaWindow: s.quotaWindow, remaining: s.remaining, perKey: s.perKey });
      return;
    }
    if (req.method === "POST" && sub === "/proxy") {
      const b = (await readJson(req)) as { path?: string; method?: string; headers?: Record<string, string>; body?: unknown; tokens?: number };
      if (b === null || typeof b !== "object" || Array.isArray(b))
        return send(res, 400, { error: "proxy body must be an object" });
      const r = await forward(poolId, b);
      if ("error" in r) return send(res, r.status === 200 ? 400 : r.status, r);
      send(res, 200, { key_id: r.key_id, label: r.label, masked: r.masked, status: r.upstreamStatus, body: r.body, truncated: r.truncated ?? false, tried: r.tried });
      return;
    }
  }
  const keyR = matchKeyRoute(url.pathname);
  if (keyR) {
    const poolId = keyR.poolId;
    const keyId = keyR.keyId === null ? undefined : String(keyR.keyId);
    if (req.method === "GET" && keyId === undefined) {
      const pool = getPool(poolId);
      if (!pool) return send(res, 404, { error: "pool not found" });
      const fields = providerKeyFields(pool.provider);
      const rows = sdb
        .prepare("SELECT id, label, api_key, COALESCE(credentials,'{}') AS credentials, info, created_at FROM pool_keys WHERE pool_id = ? ORDER BY id")
        .all(poolId) as { id: number; label: string; api_key: string; credentials: string; info: string; created_at: string }[];
      send(res, 200, rows.map((k) => {
        const creds = parseCredentials(k.credentials);
        return {
          id: k.id, label: k.label, masked: mask(k.api_key), info: k.info, created_at: k.created_at,
          keyFields: fields,
          credentials: Object.keys(creds).length > 0 ? maskCredentials(creds) : undefined,
        };
      }));
      return;
    }
    if (req.method === "POST" && keyId === undefined) {
      const pool = getPool(poolId);
      if (!pool) return send(res, 404, { error: "pool not found" });
      const b = (await readJson(req)) as { label?: string; api_key?: string; credentials?: unknown; info?: string };
      const label = typeof b.label === "string" ? b.label.trim() : "";
      if (!label)
        return send(res, 400, { error: "label required" });
      if (label.length > 80)
        return send(res, 400, { error: "label must be <= 80 characters" });
      if (/[\r\n\x00]/.test(label))
        return send(res, 400, { error: "label must not contain CR/LF" });
      if (b.info !== undefined && typeof b.info !== "string")
        return send(res, 400, { error: "info must be a string" });
      const fields = providerKeyFields(pool.provider);
      const multi = !(fields.length === 1 && (fields[0] === "api_key" || fields[0] === "apiToken"));
      let apiKey = "";
      let credJson = "{}";
      if (multi) {
        // Multi-field providers require a credentials object; api_key alone is rejected
        // so partial secrets are never stored.
        if (b.credentials === undefined) return send(res, 400, { error: `credentials required: ${fields.join(", ")}` });
        const norm = normalizeCredentials(pool.provider, b.credentials);
        if (!norm.ok) return send(res, 400, { error: norm.error });
        credJson = JSON.stringify(norm.value);
        // api_key stays a non-empty dedup/display handle: prefer a conventional
        // single-secret field, else the first field value.
        const single = (norm.value["apiKey"] ?? norm.value["api_key"] ?? norm.value["apiToken"] ?? norm.value["platformToken"] ?? norm.value["anonKey"] ?? norm.value["authToken"] ?? fields.map((f) => norm.value[f]).find(Boolean) ?? "") as string;
        apiKey = single;
        if (/[\r\n\x00]/.test(apiKey)) return send(res, 400, { error: "credentials must not contain CR/LF" });
      } else {
        apiKey = typeof b.api_key === "string" ? b.api_key.trim() : "";
        if (b.credentials !== undefined) {
          const norm = normalizeCredentials(pool.provider, b.credentials);
          if (!norm.ok) return send(res, 400, { error: norm.error });
          credJson = JSON.stringify(norm.value);
          const v = norm.value[fields[0]!] ?? apiKey;
          if (!apiKey) apiKey = v;
        }
        if (!apiKey) return send(res, 400, { error: "label + api_key required" });
        if (/[\r\n\x00]/.test(apiKey))
          return send(res, 400, { error: "label + api_key must not contain CR/LF" });
      }
      if (apiKey.length > MAX_API_KEY_CHARS)
        return send(res, 400, { error: `api_key must be <= ${MAX_API_KEY_CHARS} characters` });
      const kc = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(poolId) as { n: number }).n;
      if (kc >= MAX_KEYS_PER_POOL) return send(res, 400, { error: `key limit reached (${MAX_KEYS_PER_POOL} per pool)` });
      const dup = sdb.prepare("SELECT id FROM pool_keys WHERE pool_id = ? AND api_key = ?").get(poolId, apiKey) as { id: number } | undefined;
      if (dup) return send(res, 400, { error: "duplicate api_key in this pool" });
      const r = sdb
        .prepare("INSERT INTO pool_keys (pool_id, label, api_key, credentials, info) VALUES (?, ?, ?, ?, ?)")
        .run(poolId, label, apiKey, credJson, ((b.info ?? "") as string).slice(0, 200));
      send(res, 200, { id: r.lastInsertRowid });
      return;
    }
    if (req.method === "GET" && keyId !== undefined) {
      const row = sdb
        .prepare("SELECT id, label, api_key, COALESCE(credentials,'{}') AS credentials, info, created_at FROM pool_keys WHERE id = ? AND pool_id = ?")
        .get(Number(keyId), poolId) as { id: number; label: string; api_key: string; credentials: string; info: string; created_at: string } | undefined;
      if (!row) return send(res, 404, { error: "key not found" });
      const creds = parseCredentials(row.credentials);
      send(res, 200, { ...row, credentials: Object.keys(creds).length > 0 ? creds : undefined, masked: mask(row.api_key), maskedCredentials: Object.keys(creds).length > 0 ? maskCredentials(creds) : undefined });
      return;
    }
    if (req.method === "PATCH" && keyId !== undefined) {
      const b = (await readJson(req)) as { label?: string; api_key?: string; credentials?: unknown; info?: string };
      const cur = sdb
        .prepare("SELECT id FROM pool_keys WHERE id = ? AND pool_id = ?")
        .get(Number(keyId), poolId) as { id: number } | undefined;
      if (!cur) return send(res, 404, { error: "key not found" });
      if (b.label === undefined && b.api_key === undefined && b.credentials === undefined && b.info === undefined)
        return send(res, 400, { error: "nothing to update" });
      if (b.label !== undefined) {
        if (typeof b.label !== "string" || !b.label.trim() || b.label.trim().length > 80)
          return send(res, 400, { error: "label must be a non-empty string <= 80 characters" });
        if (/[\r\n\x00]/.test(b.label)) return send(res, 400, { error: "label must not contain CR/LF" });
        sdb.prepare("UPDATE pool_keys SET label = ? WHERE id = ?").run(b.label.trim(), Number(keyId));
      }
      if (b.api_key !== undefined) {
        if (typeof b.api_key !== "string" || !b.api_key.trim()) return send(res, 400, { error: "api_key must not be empty" });
        if (b.api_key.trim().length > MAX_API_KEY_CHARS)
          return send(res, 400, { error: `api_key must be <= ${MAX_API_KEY_CHARS} characters` });
        if (/[\r\n\x00]/.test(b.api_key)) return send(res, 400, { error: "api_key must not contain CR/LF" });
        sdb.prepare("UPDATE pool_keys SET api_key = ?, consec_fail = 0, cooldown_until = 0 WHERE id = ?").run(b.api_key.trim(), Number(keyId));
      }
      if (b.credentials !== undefined) {
        const pool = getPool(poolId);
        if (!pool) return send(res, 404, { error: "pool not found" });
        const norm = normalizeCredentials(pool.provider, b.credentials);
        if (!norm.ok) return send(res, 400, { error: norm.error });
        sdb.prepare("UPDATE pool_keys SET credentials = ?, consec_fail = 0, cooldown_until = 0 WHERE id = ?").run(JSON.stringify(norm.value), Number(keyId));
        // Keep api_key in sync when the update carries a conventional single secret.
        const single = norm.value["apiKey"] ?? norm.value["api_key"] ?? norm.value["apiToken"] ?? norm.value["platformToken"] ?? norm.value["anonKey"];
        if (typeof single === "string" && single) sdb.prepare("UPDATE pool_keys SET api_key = ? WHERE id = ?").run(single, Number(keyId));
      }
      if (b.info !== undefined) {
        if (typeof b.info !== "string") return send(res, 400, { error: "info must be a string" });
        sdb.prepare("UPDATE pool_keys SET info = ? WHERE id = ?").run(b.info.slice(0, 200), Number(keyId));
      }
      const row = sdb
        .prepare("SELECT id, label, api_key, COALESCE(credentials,'{}') AS credentials, info, created_at FROM pool_keys WHERE id = ? AND pool_id = ?")
        .get(Number(keyId), poolId) as { id: number; label: string; api_key: string; credentials: string; info: string; created_at: string };
      send(res, 200, { id: row.id, label: row.label, masked: mask(row.api_key), maskedCredentials: maskCredentials(parseCredentials(row.credentials)), info: row.info });
      return;
    }
    if (req.method === "DELETE" && keyId !== undefined) {
      sdb.prepare("DELETE FROM usage WHERE key_id = ?").run(Number(keyId));
      const r = sdb.prepare("DELETE FROM pool_keys WHERE id = ? AND pool_id = ?").run(Number(keyId), poolId);
      if (r.changes === 0) return send(res, 404, { error: "key not found" });
      send(res, 200, { ok: true });
      return;
    }
  }
  if (req.method === "GET" && url.pathname.startsWith("/logos/")) {
    const name = url.pathname.slice("/logos/".length);
    if (!/^[a-z0-9-]+\.(svg|png)$/.test(name)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }
    try {
      const buf = fs.readFileSync(path.join(process.cwd(), "public", "logos", name));
      res.writeHead(200, {
        "content-type": name.endsWith(".png") ? "image/png" : "image/svg+xml",
        "cache-control": "public, max-age=3600",
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/keys") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(keysPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/pools") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(poolsPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/analytics") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(analyticsPage());
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/provider/")) {
    const pid = url.pathname.slice("/provider/".length);
    if (!/^[a-z0-9-]+$/.test(pid)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(providerPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/playground") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(playgroundPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/docs") {
    res.writeHead(302, { location: DOCS_URL });
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/db/ping") {
    const r = readiness();
    send(res, r.status, r.body);
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    const h = health();
    res.writeHead(h.status, { "content-type": h.contentType });
    res.end(h.body);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
  } catch (e) {
    console.error(`[error] ${req.method} ${req.url}:`, e);
    if (res.headersSent) {
      try { res.end(); } catch { /* already closed */ }
      return;
    }
    const msg = (e as Error).message;
    // Validation errors stay 400; infrastructure failures are 500 without leaking internals.
    if (msg === "bad json" || msg === "too large" || msg === "connection closed") {
      send(res, 400, { error: msg });
    } else {
      send(res, 500, { error: "internal error" });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`pool-anything listening on http://${HOST}:${PORT}`);
  for (const w of startupWarnings()) console.warn(`[warn] ${w}`);
});
