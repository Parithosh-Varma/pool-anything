// Edge proxy: rotate -> send -> fail over on 429/5xx/401/403, record usage
// and history. Same rules as src/proxy/forward.ts, with buffered (capped)
// bodies instead of Node streams.

import { buildUpstreamRequest, effectiveApiKey, resolveTarget, resolveTargetForKey, type ForwardOpts } from "../../src/shared/upstream.js";
import { checkTarget, validateProxyOpts, type ProxyOpts } from "../../src/shared/proxy-rules.js";
import { bytesToBase64 } from "../../src/shared/base64.js";
import { PROVIDERS } from "./providers.js";
import { logCall, markFailure, markSuccess, nextKeyRaw } from "./db.js";
import { beginRequest, endRequest } from "./inflight.js";
import { defaultStrategy, rotationOptions } from "./strategy-config.js";
import type { Env } from "./env.js";
import { MAX_PROXY_BODY_BYTES, MAX_RELAY_CHARS, MAX_TOKENS_PER_REQUEST, MAX_UPSTREAM_MEDIA_BYTES } from "./limits.js";

type Tried = { key_id: number; label: string; status?: number; detail?: string };

export type ForwardResult =
  | {
      status: 200;
      key_id: number;
      label: string;
      masked: string;
      upstreamStatus: number;
      body: string;
      encoding: "text" | "base64";
      contentType: string;
      truncated: boolean;
      tried: Tried[];
    }
  | { status: number; error: string; tried?: Tried[] };

function allowPrivate(env: Env): boolean {
  return env.ALLOW_PRIVATE_UPSTREAM === "1";
}

function timeoutMs(env: Env): number {
  const n = Number(env.PROXY_TIMEOUT_MS ?? 30000);
  if (!Number.isFinite(n) || n <= 0) return 30000;
  return Math.min(n, 60000);
}

function dlog(env: Env, poolId: number, opts: ProxyOpts, tried: { status?: number }[], extra = ""): void {
  if (env.POOL_DEBUG !== "1") return;
  const st = tried.map((t) => t.status ?? "?").join(",");
  console.log(`[proxy] ${opts.method || "POST"} ${opts.path || "/"} pool=${poolId} tried=[${st}]${extra ? " " + extra : ""}`);
}

async function readCappedBody(
  res: Response,
  cap: number
): Promise<{ text?: string; b64?: string; contentType: string; truncated: boolean }> {
  const contentType = res.headers.get("content-type") || "";
  const textual = /json|text|event-stream|xml|urlencoded/i.test(contentType) || !contentType;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const truncated = buf.byteLength > cap;
    const slice = truncated ? buf.subarray(0, cap) : buf;
    if (textual) return { text: new TextDecoder().decode(slice), contentType, truncated };
    return { b64: bytesToBase64(slice), contentType, truncated };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (size + value.byteLength > cap) {
      const take = Math.max(0, cap - size);
      if (take > 0) {
        chunks.push(value.subarray(0, take));
        size += take;
      }
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  if (textual) return { text: new TextDecoder().decode(buf), contentType, truncated };
  return { b64: bytesToBase64(buf), contentType, truncated };
}

/** Forward one request through the pool. */
export async function forward(
  db: D1Database,
  poolId: number,
  opts: ProxyOpts,
  env: Env,
  selection: { sticky?: string } = {}
): Promise<ForwardResult> {
  const pool = await db.prepare("SELECT * FROM pools WHERE id = ?").bind(poolId).first<{
    id: number;
    provider: string;
    name: string;
    cursor: number;
    base_url: string;
    key_header: string;
    key_prefix: string;
    created_at: string;
  }>();
  if (!pool) return { status: 404, error: "pool not found" };

  const poolTarget = resolveTarget(PROVIDERS, pool);
  const safe = checkTarget(poolTarget.baseUrl || "invalid:", poolTarget.keyHeader, allowPrivate(env));
  if (!safe.ok) return { status: 400, error: safe.error ?? "invalid target" };

  const valid = validateProxyOpts(opts, {
    maxBodyBytes: MAX_PROXY_BODY_BYTES,
    maxTokens: MAX_TOKENS_PER_REQUEST,
  });
  if (!valid.ok) {
    dlog(env, poolId, opts, [], `invalid: ${valid.error}`);
    return { status: 400, error: valid.error ?? "invalid proxy options" };
  }

  // Bound failover: one client request must not fan out to every key in a
  // large pool (100 keys x timeout each would starve the invocation).
  const countRow = await db
    .prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?")
    .bind(poolId)
    .first<{ n: number }>();
  const keyTotal = Number(countRow?.n ?? 0);
  const maxAttempts = Math.min(Math.max(keyTotal, 1), 5);

  const tried: Tried[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sel = await nextKeyRaw(db, poolId, {
      sticky: selection.sticky,
      attempt,
      defaultStrategy: defaultStrategy(env),
      options: rotationOptions(env),
    });
    if ("error" in sel) {
      dlog(env, poolId, opts, tried, `no-key: ${sel.error}`);
      return { status: 400, error: sel.error, tried };
    }

    beginRequest(sel.key_id);
    try {
    let req: { url: string; headers: Record<string, string>; body: string | undefined };
    try {
      const keyTarget = resolveTargetForKey(PROVIDERS, pool, sel);
      const keySafe = checkTarget(keyTarget.baseUrl || "invalid:", keyTarget.keyHeader, allowPrivate(env));
      if (!keySafe.ok) {
        tried.push({ key_id: sel.key_id, label: sel.label, detail: keySafe.error });
        continue;
      }
      req = buildUpstreamRequest(keyTarget, effectiveApiKey(pool, sel), opts);
      // Fail closed on malformed URL/headers instead of cooling an innocent key.
      new Request(req.url, { method: opts.method || "POST", headers: req.headers as HeadersInit });
    } catch {
      return { status: 400, error: "invalid upstream request", tried };
    }

    const { url, headers, body } = req;
    const started = Date.now();
    let upstream: Response;
    try {
      // redirect: manual — never follow a Location off the validated baseUrl (SSRF).
      upstream = await fetch(url, {
        method: opts.method || "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs(env)),
      });
    } catch {
      await markFailure(db, sel.key_id);
      await logCall(db, {
        pool_id: poolId,
        key_id: sel.key_id,
        method: opts.method || "POST",
        path: opts.path || "/",
        status: null,
        tokens: 0,
        body: "",
        truncated: false,
        encoding: "text",
        contentType: "",
        error: "upstream network error",
      });
      tried.push({ key_id: sel.key_id, label: sel.label, detail: "upstream network error" });
      continue;
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      // Redirects are not followed and are not the key's fault: report without cooling.
      await upstream.body?.cancel().catch(() => undefined);
      await logCall(db, {
        pool_id: poolId,
        key_id: sel.key_id,
        method: opts.method || "POST",
        path: opts.path || "/",
        status: upstream.status,
        tokens: 0,
        body: "",
        truncated: false,
        encoding: "text",
        contentType: "",
        error: "redirect not followed",
      });
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      dlog(env, poolId, opts, tried, "redirect");
      return { status: 400, error: `upstream redirected (HTTP ${upstream.status}, location not followed)`, tried };
    }

    let text = "";
    let b64: string | undefined;
    let contentType = "";
    let truncated = false;
    try {
      const r = await readCappedBody(upstream, MAX_UPSTREAM_MEDIA_BYTES);
      text = r.text ?? "";
      b64 = r.b64;
      contentType = r.contentType;
      truncated = r.truncated;
    } catch {
      await markFailure(db, sel.key_id);
      await logCall(db, {
        pool_id: poolId,
        key_id: sel.key_id,
        method: opts.method || "POST",
        path: opts.path || "/",
        status: upstream.status,
        tokens: 0,
        body: "",
        truncated: false,
        encoding: "text",
        contentType: "",
        error: "upstream body error",
      });
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status, detail: "upstream body error" });
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }

    // Binary media (audio/video/image bytes) relays as base64 + content type so
    // the Studio can render a player; JSON/text relays as text.
    const rawLen = b64 !== undefined ? b64.length : text.length;
    const relayBody = (b64 !== undefined ? b64 : text).slice(0, MAX_RELAY_CHARS);
    truncated = truncated || rawLen > MAX_RELAY_CHARS;
    const encoding: "base64" | "text" = b64 !== undefined ? "base64" : "text";
    const callBase = {
      pool_id: poolId,
      key_id: sel.key_id,
      method: opts.method || "POST",
      path: opts.path || "/",
      body: relayBody,
      truncated,
      encoding,
      contentType,
    };

    if (upstream.status === 429 || upstream.status >= 500 || upstream.status === 401 || upstream.status === 403) {
      // 401/403 = invalid/revoked key: cool it so rotation skips it instead of
      // paying one dead upstream call on every subsequent request.
      await markFailure(db, sel.key_id);
      await logCall(db, { ...callBase, status: upstream.status, tokens: 0, error: "" });
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      // Other 4xx: client/upstream error, not the key's fault. Passthrough
      // without cooling and without charging quota.
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      await logCall(db, { ...callBase, status: upstream.status, tokens: 0, error: "" });
      dlog(env, poolId, opts, tried, "passthrough");
      return {
        status: 200,
        key_id: sel.key_id,
        label: sel.label,
        masked: sel.masked,
        upstreamStatus: upstream.status,
        body: relayBody,
        encoding,
        contentType,
        truncated,
        tried,
      };
    }

    await markSuccess(db, sel.key_id, Date.now() - started);
    const tok = opts.tokens;
    if (Number.isInteger(tok) && (tok as number) > 0) {
      await db
        .prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)")
        .bind(poolId, sel.key_id, tok as number)
        .run();
    }
    await logCall(db, {
      ...callBase,
      status: upstream.status,
      tokens: Number.isInteger(tok) && (tok as number) > 0 ? (tok as number) : 0,
      error: "",
    });
    dlog(env, poolId, opts, tried, `ok upstream=${upstream.status}`);
    return {
      status: 200,
      key_id: sel.key_id,
      label: sel.label,
      masked: sel.masked,
      upstreamStatus: upstream.status,
      body: relayBody,
      encoding,
      contentType,
      truncated,
      tried,
    };
    } finally {
      endRequest(sel.key_id);
    }
  }
  dlog(env, poolId, opts, tried, "all-failed");
  return { status: 400, error: "all keys failed or cooling down", tried };
}
