import { sdb, getPool } from "../pool/index.js";
import { nextKeyRaw, markSuccess, markFailure } from "../pool/rotation.js";
import { resolveTarget, resolveTargetForKey, effectiveApiKey, buildUpstreamRequest, type ForwardOpts } from "../upstream/index.js";
import { allowPrivateUpstream, proxyTimeoutMs } from "../config/env.js";
import { resolveAndCheck, hostnameOf } from "./dns.js";

/** Hard per-request abuse cap (see disk-fill note in SECURITY.md). */
export const MAX_TOKENS_PER_REQUEST = 1_000_000;
/** Cap on buffered upstream bytes before truncating (response to caller is still 4000 chars). */
export const MAX_UPSTREAM_BYTES = 1_000_000;

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Parse dotted IPv4 with inet_aton semantics (decimal, 0x hex, 0 octal, 1-4 parts). */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p.length === 0) return null;
    let v: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) v = parseInt(p, 16);
    else if (/^0[0-9]+$/.test(p)) {
      if (!/^[0-7]+$/.test(p)) return null;
      v = parseInt(p, 8);
    } else if (/^[0-9]+$/.test(p)) v = parseInt(p, 10);
    else return null;
    if (!Number.isSafeInteger(v) || v < 0 || v > 0xffffffff) return null;
    nums.push(v);
  }
  const widths = { 1: [32], 2: [8, 24], 3: [8, 8, 16], 4: [8, 8, 8, 8] }[nums.length]!;
  let addr = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i]! >= 2 ** widths[i]!) return null;
    addr = addr * 2 ** widths[i]! + nums[i]!;
  }
  return addr >>> 0;
}

/** True when a hostname is a loopback/private/unspecified literal (v4, v6, or mapped). */
export function isPrivateLiteral(host: string): boolean {
  let h = host.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1); // URL keeps IPv6 brackets
  // Strip a single trailing dot (FQDN form): "127.0.0.1." still resolves to loopback.
  if (h.endsWith(".") && h.length > 1) h = h.slice(0, -1);
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "::" || h === "0.0.0.0") return true;
  if (h === "0:0:0:0:0:0:0:1" || h === "0:0:0:0:0:0:0:0") return true;
  if (h.includes(":")) {
    // IPv6: check ::ffff:<v4> mapped forms (compressed or full).
    const afterLastColon = h.slice(h.lastIndexOf(":") + 1);
    const tail = afterLastColon.includes(".") ? parseIPv4(afterLastColon) : null;
    if (tail !== null) return isPrivateV4(tail);
    // Block non-routable IPv6: fe80::/10 link-local, fc00::/7 ULA, ff00::/8 multicast.
    // Public global unicast (e.g. 2606:4700::) is allowed.
    const first = h.split(":")[0] || "";
    if (/^fe[89ab]/i.test(first)) return true;
    if (/^(fc|fd)/i.test(first)) return true;
    if (/^ff/i.test(first)) return true;
    return false;
    // DNS names resolving to private IPs remain a residual risk (no DNS pinning).
    // See residual-risk note in SECURITY.md.
  }
  const v4 = parseIPv4(h);
  if (v4 === null) return false;
  return isPrivateV4(v4);
}

function isPrivateV4(addr: number): boolean {
  const b0 = (addr >>> 24) & 0xff;
  const b1 = (addr >>> 16) & 0xff;
  if (b0 === 127 || b0 === 10 || b0 === 0) return true; // loopback, private, "this network"
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  if (b0 === 192 && b1 === 168) return true;
  if (b0 === 169 && b1 === 254) return true; // link-local incl. cloud metadata
  return false;
}

export const QUERY_PARAM_RE = /^[A-Za-z0-9_-]+$/;

export function checkTarget(baseUrl: string, keyHeader: string): { ok: boolean; error?: string } {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return { ok: false, error: "baseUrl is not a URL" };
  }
  if (!allowPrivateUpstream()) {
    if (u.protocol !== "https:") return { ok: false, error: "baseUrl must be https" };
    if (isPrivateLiteral(u.hostname)) return { ok: false, error: "baseUrl host blocked" };
  }
  if (/^[A-Za-z0-9-]+$/.test(keyHeader)) return { ok: true };
  if (keyHeader.startsWith("query:")) {
    const name = keyHeader.slice("query:".length);
    if (QUERY_PARAM_RE.test(name)) return { ok: true };
    return { ok: false, error: "keyHeader invalid" };
  }
  return { ok: false, error: "keyHeader invalid" };
}

/** Validate caller-supplied proxy fields before any key is touched. No key state changes on failure. */
export function validateProxyOpts(opts: ProxyOpts): { ok: boolean; error?: string } {
  const p = opts.path ?? "/";
  if (typeof p !== "string" || !p.startsWith("/") || p.length > 2000 || /[\s\x00-\x1f\x7f]/.test(p))
    return { ok: false, error: "path must start with / and contain no whitespace/control characters" };
  // Reject query/fragment markers and path traversal: the proxy concatenates
  // baseUrl + path, so "?"/"#" would inject query/fragment and ".." escapes prefixes.
  if (p.includes("?") || p.includes("#")) return { ok: false, error: "path must not contain ? or #" };
  if (p.split("/").includes("..")) return { ok: false, error: "path must not contain .." };
  try {
    decodeURIComponent(p);
  } catch {
    return { ok: false, error: "path has invalid percent-encoding" };
  }
  if (opts.method !== undefined && (typeof opts.method !== "string" || !METHODS.has(opts.method.toUpperCase())))
    return { ok: false, error: "method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS" };
  if (opts.headers !== undefined) {
    if (typeof opts.headers !== "object" || opts.headers === null || Array.isArray(opts.headers))
      return { ok: false, error: "headers must be an object" };
    const entries = Object.entries(opts.headers);
    if (entries.length > 50) return { ok: false, error: "too many headers" };
    for (const [k, v] of entries) {
      // Names must be HTTP tokens: otherwise fetch throws and an innocent key cools down.
      // Intentionally fail-closed: exotic non-token header names are rejected rather than
      // risking a pool-wide cooldown on a network error.
      if (typeof k !== "string" || k.length === 0 || k.length > 256 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(k))
        return { ok: false, error: "invalid header name" };
      if (typeof v !== "string" || v.length > 8000 || /[\r\n\x00]/.test(k) || /[\r\n\x00]/.test(v))
        return { ok: false, error: "invalid header value" };
      const lk = k.toLowerCase();
      // Hop-by-hop / routing headers must not be caller-controlled: fetch would
      // forward them upstream alongside the victim key (vhost confusion, cookie leak).
      if (
        lk === "host" || lk === "connection" || lk === "transfer-encoding" ||
        lk === "content-length" || lk === "cookie" || lk === "proxy-authenticate" ||
        lk === "proxy-authorization" || lk === "upgrade" || lk === "via" ||
        lk === "forwarded" || lk === "x-forwarded-for" || lk === "x-forwarded-host" ||
        lk === "x-forwarded-proto" || lk === "expect" || lk === "trailer" || lk === "te"
      )
        return { ok: false, error: `header not allowed: ${k}` };
    }
  }
  if (opts.tokens !== undefined && (!Number.isInteger(opts.tokens) || opts.tokens <= 0 || opts.tokens > MAX_TOKENS_PER_REQUEST))
    return { ok: false, error: `tokens must be a positive integer <= ${MAX_TOKENS_PER_REQUEST}` };
  if (opts.body !== undefined) {
    try {
      JSON.stringify(opts.body);
    } catch {
      return { ok: false, error: "body must be JSON-serializable" };
    }
  }
  return { ok: true };
}

/** Read at most `cap` bytes, then stop (prevents OOM on huge upstream bodies). */
async function readCappedText(res: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > cap;
    const slice = truncated ? buf.slice(0, cap) : buf;
    return { text: new TextDecoder().decode(slice), truncated };
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
  const flat = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    flat.set(c, off);
    off += c.length;
  }
  return { text: new TextDecoder().decode(flat), truncated };
}

export function timeoutMs(): number {
  return proxyTimeoutMs();
}

export type ProxyOpts = ForwardOpts & { tokens?: number };

/**
 * Forward one request through the pool: rotate, send, fail over on
 * 429/5xx/network errors (key cools down, next key tried). Returns the
 * upstream status/body plus which key served it. Quota-exhausted and
 * cooling keys are skipped by rotation.
 */
export async function forward(poolId: number, opts: ProxyOpts) {
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
  if (!valid.ok) return { status: 400 as const, error: valid.error };

  // Bound failover: one client request must not fan out to every key in a
  // large pool (100 keys x timeout each would starve the single-thread server).
  const keyTotal = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(poolId) as { n: number }).n;
  const maxAttempts = Math.min(Math.max(keyTotal, 1), 5);

  const tried: { key_id: number; label: string; status?: number; detail?: string }[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sel = nextKeyRaw(poolId);
    if ("error" in sel) {
      return { status: 400 as const, error: sel.error, tried };
    }
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
      tried.push({ key_id: sel.key_id, label: sel.label, detail: "upstream network error" });
      continue;
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      // Redirects are not followed and are not the key's fault: report without cooling.
      await upstream.body?.cancel().catch(() => undefined);
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      return { status: 400 as const, error: `upstream redirected (HTTP ${upstream.status}, location not followed)`, tried };
    }
    let text: string;
    let truncated = false;
    try {
      const r = await readCappedText(upstream, MAX_UPSTREAM_BYTES);
      text = r.text;
      truncated = r.truncated;
    } catch {
      markFailure(sel.key_id);
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status, detail: "upstream body error" });
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }
    if (upstream.status === 429 || upstream.status >= 500 || upstream.status === 401 || upstream.status === 403) {
      // 401/403 = invalid/revoked key: cool it so rotation skips it instead of
      // paying one dead upstream call on every subsequent request.
      markFailure(sel.key_id);
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      // Other 4xx: client/upstream error, not the key's fault. Passthrough
      // without cooling and without charging quota.
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      return { status: 200 as const, key_id: sel.key_id, label: sel.label, masked: sel.masked, upstreamStatus: upstream.status, body: text.slice(0, 4000), truncated, tried };
    }
    markSuccess(sel.key_id, Date.now() - started);
    const tok = opts.tokens;
    if (Number.isInteger(tok) && (tok as number) > 0) {
      sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, sel.key_id, tok as number);
    }
    return { status: 200 as const, key_id: sel.key_id, label: sel.label, masked: sel.masked, upstreamStatus: upstream.status, body: text.slice(0, 4000), truncated, tried };
  }
  return { status: 400 as const, error: "all keys failed or cooling down", tried };
}
