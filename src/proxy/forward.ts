import { sdb, getPool } from "../pool/index.js";
import { nextKeyRaw, markSuccess, markFailure } from "../pool/rotation.js";
import { resolveTarget, buildUpstreamRequest, type ForwardOpts } from "../upstream/index.js";
import { allowPrivateUpstream, proxyTimeoutMs } from "../config/env.js";

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
function isPrivateLiteral(host: string): boolean {
  let h = host.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1); // URL keeps IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "::" || h === "0.0.0.0") return true;
  if (h.includes(":")) {
    // IPv6: check ::ffff:<v4> mapped forms (compressed or full).
    const afterLastColon = h.slice(h.lastIndexOf(":") + 1);
    const tail = afterLastColon.includes(".") ? parseIPv4(afterLastColon) : null;
    if (tail !== null) return isPrivateV4(tail);
    return false; // Other literal IPv6 (e.g. link-local) is not allow-listed here;
    // DNS names are still gated by the checks below. See residual-risk note in SECURITY.md.
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
  if (!/^[A-Za-z0-9-]+$/.test(keyHeader) && !keyHeader.startsWith("query:")) return { ok: false, error: "keyHeader invalid" };
  return { ok: true };
}

/** Validate caller-supplied proxy fields before any key is touched. No key state changes on failure. */
export function validateProxyOpts(opts: ProxyOpts): { ok: boolean; error?: string } {
  const p = opts.path ?? "/";
  if (typeof p !== "string" || !p.startsWith("/") || p.length > 2000 || /[\s\x00-\x1f\x7f]/.test(p))
    return { ok: false, error: "path must start with / and contain no whitespace/control characters" };
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
async function readCappedText(res: Response, cap: number): Promise<string> {
  if (!res.body || typeof res.body.getReader !== "function") return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
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
  return new TextDecoder().decode(flat);
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
  const target = resolveTarget(pool);
  const safe = checkTarget(target.baseUrl || "invalid:", target.keyHeader);
  if (!safe.ok) return { status: 400 as const, ...safe };
  const valid = validateProxyOpts(opts);
  if (!valid.ok) return { status: 400 as const, error: valid.error };

  const tried: { key_id: number; label: string; status?: number; detail?: string }[] = [];
  for (;;) {
    const sel = nextKeyRaw(poolId);
    if ("error" in sel) {
      return { status: 400 as const, error: sel.error, tried };
    }
    const { url, headers, body } = buildUpstreamRequest(target, sel.api_key, opts);
    const started = Date.now();
    let upstream: Response;
    try {
      // redirect: manual — never follow a Location off the validated baseUrl (SSRF).
      upstream = await fetch(url, { method: opts.method || "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs()) });
    } catch (e) {
      markFailure(sel.key_id);
      tried.push({ key_id: sel.key_id, label: sel.label, detail: (e as Error).message });
      continue;
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      // Redirects are not followed and are not the key's fault: report without cooling.
      await upstream.body?.cancel().catch(() => undefined);
      return { status: 400 as const, error: `upstream redirected (HTTP ${upstream.status}, location not followed)`, tried };
    }
    const text = await readCappedText(upstream, MAX_UPSTREAM_BYTES);
    if (upstream.status === 429 || upstream.status >= 500) {
      markFailure(sel.key_id);
      tried.push({ key_id: sel.key_id, label: sel.label, status: upstream.status });
      continue;
    }
    markSuccess(sel.key_id, Date.now() - started);
    const tok = opts.tokens;
    if (Number.isInteger(tok) && (tok as number) > 0) {
      sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, sel.key_id, tok as number);
    }
    return { status: 200 as const, key_id: sel.key_id, label: sel.label, masked: sel.masked, upstreamStatus: upstream.status, body: text.slice(0, 4000), tried };
  }
}
