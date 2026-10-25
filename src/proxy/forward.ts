import { sdb, getPool, logCall, callBodyForStorage } from "../pool/index.js";
import { nextKeyRaw, markSuccess, markFailure } from "../pool/rotation.js";
import { beginRequest, endRequest } from "../pool/inflight.js";
import { resolveTarget, resolveTargetForKey, effectiveApiKey, buildUpstreamRequest, type ForwardOpts } from "../upstream/index.js";
import { allowPrivateUpstream, proxyTimeoutMs } from "../config/env.js";
import { resolveAndCheck, hostnameOf } from "./dns.js";
import {
  checkTarget as checkTargetShared,
  isPrivateLiteral,
  validateProxyOpts as validateProxyOptsShared,
} from "../shared/proxy-rules.js";
import { MAX_PROXY_BODY_BYTES, MAX_RELAY_CHARS, MAX_UPSTREAM_MEDIA_BYTES } from "../media/capabilities.js";

/** Hard per-request abuse cap (see disk-fill note in SECURITY.md). */
export const MAX_TOKENS_PER_REQUEST = 1_000_000;
/** Cap on buffered upstream bytes before truncating (media-aware; JSON text is relayed up to MAX_RELAY_CHARS). */
export const MAX_UPSTREAM_BYTES = MAX_UPSTREAM_MEDIA_BYTES;

export { isPrivateLiteral };

export function checkTarget(baseUrl: string, keyHeader: string): { ok: boolean; error?: string } {
  return checkTargetShared(baseUrl, keyHeader, allowPrivateUpstream());
}

export function validateProxyOpts(opts: ProxyOpts): { ok: boolean; error?: string } {
  return validateProxyOptsShared(opts, { maxBodyBytes: MAX_PROXY_BODY_BYTES, maxTokens: MAX_TOKENS_PER_REQUEST });
}


/** Read at most `cap` bytes. Textual (json/text) bodies decode as text; binary media (audio/video/image bytes) base64-encodes so Studio can render it.
 *  Memory note: media caps are intentionally large (12MB upstream, 8M-char
 *  relay) so Studio can render audio/image bytes. The body is buffered once
 *  via Buffer.concat and relayed sliced to MAX_RELAY_CHARS — one large media
 *  proxy holds ~2x peak (raw + base64) transiently; concurrent large media
 *  proxies multiply that, so keep caps in capabilities.ts conservative. */
async function readCappedBody(res: Response, cap: number): Promise<{ text?: string; b64?: string; contentType: string; truncated: boolean }> {
  const contentType = res.headers.get("content-type") || "";
  const textual = /json|text|event-stream|xml|urlencoded/i.test(contentType) || !contentType;
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > cap;
    const slice = truncated ? buf.slice(0, cap) : buf;
    if (textual) return { text: new TextDecoder().decode(slice), contentType, truncated };
    return { b64: Buffer.from(slice).toString("base64"), contentType, truncated };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      truncated = true;
      break;
    }
    chunks.push(value);
  }
  // Single concat (no intermediate flat copy retained): chunks are released here.
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  const bounded = truncated ? buf.subarray(0, cap) : buf;
  if (textual) return { text: new TextDecoder().decode(bounded), contentType, truncated };
  return { b64: bounded.toString("base64"), contentType, truncated };
}

export function timeoutMs(): number {
  return proxyTimeoutMs();
}

export type ProxyOpts = ForwardOpts & { tokens?: number };

/** POOL_DEBUG=1: per-request proxy trace on stderr (method/path/pool and
 *  upstream statuses). Never logs bodies or key material. */
function dlog(poolId: number, opts: ProxyOpts, tried: { status?: number }[], extra = "") {
  if (process.env.POOL_DEBUG !== "1") return;
  const st = tried.map((t) => (t.status ?? "?")).join(",");
  console.error(`[proxy] ${opts.method || "POST"} ${opts.path || "/"} pool=${poolId} tried=[${st}]${extra ? " " + extra : ""}`);
}

/**
 * Forward one request through the pool: rotate, send, fail over on
 * 429/5xx/network errors (key cools down, next key tried). Returns the
 * upstream status/body plus which key served it. Quota-exhausted and
 * cooling keys are skipped by rotation.
 */
export async function forward(poolId: number, opts: ProxyOpts, selection: { sticky?: string } = {}) {
  const pool = getPool(poolId);
  if (!pool) return { status: 404 as const, error: "pool not found" };
  const poolTarget = resolveTarget(pool);
  const safe = checkTarget(poolTarget.baseUrl || "invalid:", poolTarget.keyHeader);
  if (!safe.ok) return { status: 400 as const, ...safe };
  if (!allowPrivateUpstream()) {
    const host = hostnameOf(poolTarget.baseUrl);
    if (host) {
      const dns = await resolveAndCheck(host);
      if (!dns.ok) return { status: 400 as const, error: dns.error, tried: [] };
    }
  }
  const valid = validateProxyOpts(opts);
  if (!valid.ok) {
    dlog(poolId, opts, [], `invalid: ${valid.error}`);
    return { status: 400 as const, error: valid.error };
  }

  // Bound failover: one client request must not fan out to every key in a
  // large pool (100 keys x timeout each would starve the single-thread server).
  const keyTotal = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(poolId) as { n: number }).n;
  const maxAttempts = Math.min(Math.max(keyTotal, 1), 5);

  const tried: { key_id: number; label: string; status?: number; detail?: string }[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sel = nextKeyRaw(poolId, { sticky: selection.sticky, attempt });
    if ("error" in sel) {
      dlog(poolId, opts, tried, `no-key: ${sel.error}`);
      return { status: 400 as const, error: sel.error, tried };
    }
    // least-connections sees this request while it is on the wire. The
    // finally below releases the slot on every path (success, failover,
    // return, throw).
    beginRequest(sel.key_id);
    try {
    let req: { url: string; headers: Record<string, string>; body: string | undefined };
    try {
      const keyTarget = resolveTargetForKey(pool, sel);
      const keySafe = checkTarget(keyTarget.baseUrl || "invalid:", keyTarget.keyHeader);
      if (!keySafe.ok) {
        tried.push({ key_id: sel.key_id, label: sel.label, detail: keySafe.error });
        continue;
      }
      if (!allowPrivateUpstream()) {
        const khost = hostnameOf(keyTarget.baseUrl);
        if (khost) {
          const kdns = await resolveAndCheck(khost);
          if (!kdns.ok) {
            tried.push({ key_id: sel.key_id, label: sel.label, detail: kdns.error });
            continue;
          }
        }
      }
      req = buildUpstreamRequest(keyTarget, effectiveApiKey(pool, sel), opts);
      // Fail closed on malformed URL/headers instead of cooling an innocent key.
      new Request(req.url, { method: opts.method || "POST", headers: req.headers as HeadersInit });
    } catch {
      return { status: 400 as const, error: "invalid upstream request", tried };
    }
    const { url, headers, body } = req;
    const started = Date.now();
    let upstream: Response;
    try {
      // redirect: manual — never follow a Location off the validated baseUrl (SSRF).
      upstream = await fetch(url, { method: opts.method || "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs()) });
    } catch {
      markFailure(sel.key_id);
      logCall({ pool_id: poolId, key_id: sel.key_id, method: opts.method || "POST", path: opts.path || "/", status: null, tokens: 0, body: "", truncated: false, encoding: "text", contentType: "", error: "upstream network error" });
      tried.push({ key_id: sel.key_id, label: sel.label, detail: "upstream network error" });
      continue;
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      // Redirects are not followed and are not the key's fault: report without cooling.
      await upstream.body?.cancel().catch(() => undefined);
      logCall({ pool_id: poolId, key_id: sel.key_id, method: opts.method || "POST", path: opts.path || "/", status: upstream.status, tokens: 0, body: "", truncated: false, encoding: "text", contentType: "", error: "redirect not followed" });
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      dlog(poolId, opts, tried, "redirect");
      return { status: 400 as const, error: `upstream redirected (HTTP ${upstream.status}, location not followed)`, tried };
    }
    let text = "";
    let b64: string | undefined;
    let contentType = "";
    let truncated = false;
    try {
      const r = await readCappedBody(upstream, MAX_UPSTREAM_BYTES);
      text = r.text ?? "";
      b64 = r.b64;
      contentType = r.contentType;
      truncated = r.truncated;
    } catch {
      markFailure(sel.key_id);
      logCall({ pool_id: poolId, key_id: sel.key_id, method: opts.method || "POST", path: opts.path || "/", status: upstream.status, tokens: 0, body: "", truncated: false, encoding: "text", contentType: "", error: "upstream body error" });
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status, detail: "upstream body error" });
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }
    // Binary media (audio/video/image bytes) relays as base64 + content type so
    // Studio can render a player; JSON/text relays as text up to MAX_RELAY_CHARS.
    const rawLen = b64 !== undefined ? b64.length : text.length;
    const relayBody = b64 !== undefined ? b64.slice(0, MAX_RELAY_CHARS) : text.slice(0, MAX_RELAY_CHARS);
    truncated = truncated || rawLen > MAX_RELAY_CHARS;
    const encoding: "base64" | "text" = b64 !== undefined ? "base64" : "text";
    const stored = callBodyForStorage(relayBody, encoding, truncated);
    const callBase = { pool_id: poolId, key_id: sel.key_id, method: opts.method || "POST", path: opts.path || "/", body: stored.body, truncated: stored.truncated, encoding, contentType };
    if (upstream.status === 429 || upstream.status >= 500 || upstream.status === 401 || upstream.status === 403) {
      // 401/403 = invalid/revoked key: cool it so rotation skips it instead of
      // paying one dead upstream call on every subsequent request.
      markFailure(sel.key_id);
      logCall({ ...callBase, status: upstream.status, tokens: 0, error: "" });
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      // Other 4xx: client/upstream error, not the key's fault. Passthrough
      // without cooling and without charging quota.
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      logCall({ ...callBase, status: upstream.status, tokens: 0, error: "" });
      dlog(poolId, opts, tried, "passthrough");
      return { status: 200 as const, key_id: sel.key_id, label: sel.label, masked: sel.masked, upstreamStatus: upstream.status, body: relayBody, encoding, contentType, truncated, tried };
    }
    markSuccess(sel.key_id, Date.now() - started);
    const tok = opts.tokens;
    if (Number.isInteger(tok) && (tok as number) > 0) {
      sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, sel.key_id, tok as number);
    }
    logCall({ ...callBase, status: upstream.status, tokens: Number.isInteger(tok) && (tok as number) > 0 ? (tok as number) : 0, error: "" });
    dlog(poolId, opts, tried, `ok upstream=${upstream.status}`);
    return { status: 200 as const, key_id: sel.key_id, label: sel.label, masked: sel.masked, upstreamStatus: upstream.status, body: relayBody, encoding, contentType, truncated, tried };
    } finally {
      endRequest(sel.key_id);
    }
  }
  dlog(poolId, opts, tried, "all-failed");
  return { status: 400 as const, error: "all keys failed or cooling down", tried };
}
