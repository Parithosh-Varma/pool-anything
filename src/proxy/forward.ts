import { sdb, getPool } from "../pool/index.js";
import { nextKeyRaw, markSuccess, markFailure } from "../pool/rotation.js";
import { resolveTarget, buildUpstreamRequest, type ForwardOpts } from "../upstream/index.js";

export function checkTarget(baseUrl: string, keyHeader: string): { ok: boolean; error?: string } {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return { ok: false, error: "baseUrl is not a URL" };
  }
  if (process.env.ALLOW_PRIVATE_UPSTREAM !== "1") {
    if (u.protocol !== "https:") return { ok: false, error: "baseUrl must be https" };
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0") return { ok: false, error: "baseUrl host blocked" };
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return { ok: false, error: "baseUrl host blocked" };
    const m = h.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return { ok: false, error: "baseUrl host blocked" };
  }
  if (!/^[A-Za-z0-9-]+$/.test(keyHeader) && !keyHeader.startsWith("query:")) return { ok: false, error: "keyHeader invalid" };
  return { ok: true };
}

export function timeoutMs(): number {
  const n = Number(process.env.PROXY_TIMEOUT_MS ?? 30000);
  return Number.isFinite(n) && n > 0 ? n : 30000;
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
      upstream = await fetch(url, { method: opts.method || "POST", headers, body, signal: AbortSignal.timeout(timeoutMs()) });
    } catch (e) {
      markFailure(sel.key_id);
      tried.push({ key_id: sel.key_id, label: sel.label, detail: (e as Error).message });
      continue;
    }
    const text = await upstream.text();
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
