// SSRF + proxy-option validation. Pure: shared by the Node server and the
// Worker. The Worker cannot resolve DNS, so literal private hosts are blocked
// here and the platform's egress policy is the backstop.

import { validateQueryParams, type ForwardOpts } from "./upstream.js";
import { utf8Length } from "./base64.js";

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

function isPrivateV4(addr: number): boolean {
  const b0 = (addr >>> 24) & 0xff;
  const b1 = (addr >>> 16) & 0xff;
  if (b0 === 127 || b0 === 10 || b0 === 0) return true; // loopback, private, "this network"
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  if (b0 === 192 && b1 === 168) return true;
  if (b0 === 169 && b1 === 254) return true; // link-local incl. cloud metadata
  return false;
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
  }
  const v4 = parseIPv4(h);
  if (v4 === null) return false;
  return isPrivateV4(v4);
}

export const QUERY_PARAM_RE = /^[A-Za-z0-9_-]+$/;

export function checkTarget(baseUrl: string, keyHeader: string, allowPrivate: boolean): { ok: boolean; error?: string } {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return { ok: false, error: "baseUrl is not a URL" };
  }
  if (!allowPrivate) {
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

export type ProxyCaps = { maxBodyBytes: number; maxTokens: number };
export type ProxyOpts = ForwardOpts & { tokens?: number };

/** Validate caller-supplied proxy fields before any key is touched. No key state changes on failure. */
export function validateProxyOpts(opts: ProxyOpts, caps: ProxyCaps): { ok: boolean; error?: string } {
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
  if (opts.tokens !== undefined && (!Number.isInteger(opts.tokens) || opts.tokens <= 0 || opts.tokens > caps.maxTokens))
    return { ok: false, error: `tokens must be a positive integer <= ${caps.maxTokens}` };
  if (opts.query !== undefined) {
    const q = validateQueryParams(opts.query);
    if (!q.ok) return { ok: false, error: q.error };
  }
  if (opts.body !== undefined && opts.form !== undefined)
    return { ok: false, error: "body and form are mutually exclusive" };
  if (opts.form !== undefined) {
    if (typeof opts.form !== "object" || opts.form === null || Array.isArray(opts.form))
      return { ok: false, error: "form must be an object" };
    const entries = Object.entries(opts.form);
    if (entries.length > 50) return { ok: false, error: "too many form fields" };
    let bytes = 0;
    for (const [k, v] of entries) {
      if (typeof k !== "string" || k.length === 0 || k.length > 256 || /[\r\n\x00]/.test(k))
        return { ok: false, error: "invalid form field name" };
      if (typeof v !== "string" || v.length > 8000 || /[\r\n\x00]/.test(v))
        return { ok: false, error: "invalid form field value" };
      bytes += utf8Length(k) + utf8Length(v);
    }
    if (bytes > caps.maxBodyBytes)
      return { ok: false, error: `proxy form too large (max ${Math.round(caps.maxBodyBytes / 1_000_000)}MB)` };
  }
  if (opts.body !== undefined) {
    try {
      const s = JSON.stringify(opts.body);
      // Byte-accurate: JSON length undercounts non-ASCII.
      if (utf8Length(s) > caps.maxBodyBytes)
        return { ok: false, error: `proxy body too large (max ${Math.round(caps.maxBodyBytes / 1_000_000)}MB incl. base64 media)` };
    } catch {
      return { ok: false, error: "body must be JSON-serializable" };
    }
  }
  return { ok: true };
}
