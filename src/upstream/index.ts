import { PROVIDERS, parseCredentials } from "../pool/index.js";

export type Target = {
  baseUrl: string;
  keyHeader: string;
  keyPrefix: string;
  extraHeaders: Record<string, string>;
};

export function resolveTarget(pool: { provider: string; base_url: string; key_header: string; key_prefix: string }): Target {
  const p = PROVIDERS.find((x) => x.id === pool.provider);
  const baseUrl = (pool.base_url || p?.baseUrl || "").trim();
  const keyHeader = (pool.key_header || p?.keyHeader || "X-API-Key").trim();
  const keyPrefix = pool.key_prefix || p?.keyPrefix || "";
  return {
    baseUrl,
    keyHeader: keyHeader || "X-API-Key",
    keyPrefix,
    extraHeaders: substitutePlaceholders(p?.extraHeaders ?? {}, {}),
  };
}

export type KeyLike = { api_key: string; credentials?: string | null };

/**
 * Per-key target: multi-field credentials can override baseUrl and
 * extra headers (supabase url, appwrite endpoint/project). Single-field
 * keys behave exactly like resolveTarget().
 */
export function resolveTargetForKey(
  pool: { provider: string; base_url: string; key_header: string; key_prefix: string },
  key: KeyLike
): Target {
  const base = resolveTarget(pool);
  const creds = parseCredentials(typeof key.credentials === "string" ? key.credentials : "{}");
  if (Object.keys(creds).length === 0) return base;
  const extra = { ...base.extraHeaders };
  let baseUrl = base.baseUrl;
  // Supabase: per-project URL wins over the "<ref>" placeholder.
  if (creds["url"] && (pool.provider === "supabase" || baseUrl.includes("<ref>") || baseUrl.includes("<"))) {
    baseUrl = creds["url"].replace(/\/+$/, "");
  }
  // Appwrite: endpoint + project id.
  if (creds["endpoint"]) baseUrl = creds["endpoint"].replace(/\/+$/, "");
  if (creds["projectId"]) extra["X-Appwrite-Project"] = creds["projectId"];
  // Supabase anon key fills the Bearer placeholder.
  if (creds["anonKey"]) {
    for (const [k, v] of Object.entries(extra)) {
      if (v.includes("<anonKey>")) extra[k] = v.replace("<anonKey>", creds["anonKey"]);
    }
    if (base.keyHeader.toLowerCase() === "apikey" && !extra["Authorization"]) {
      extra["Authorization"] = `Bearer ${creds["anonKey"]}`;
    }
  }
  return { ...base, baseUrl, extraHeaders: substitutePlaceholders(extra, creds) };
}

/** Effective secret material for a key: synthesized for multi-field providers. */
export function effectiveApiKey(
  pool: { provider: string },
  key: KeyLike
): string {
  const creds = parseCredentials(typeof key.credentials === "string" ? key.credentials : "{}");
  // Mailgun expects Basic base64(api:KEY); keys are stored raw per the hint.
  if (pool.provider === "mailgun") {
    const raw =
      (typeof creds["apiKey"] === "string" && creds["apiKey"]) ||
      (typeof creds["api_key"] === "string" && creds["api_key"]) ||
      key.api_key;
    if (raw) return Buffer.from(`api:${raw}`).toString("base64");
    return key.api_key;
  }
  if (Object.keys(creds).length === 0) return key.api_key;
  // Twilio: Basic base64(SID:token).
  if (creds["accountSid"] && creds["authToken"]) {
    return Buffer.from(`${creds["accountSid"]}:${creds["authToken"]}`).toString("base64");
  }
  // Appwrite / Turso / generic: prefer explicit api key fields.
  for (const f of ["apiKey", "api_key", "apiToken", "platformToken", "anonKey", "token"]) {
    if (typeof creds[f] === "string" && creds[f]) return creds[f] as string;
  }
  return key.api_key;
}

function substitutePlaceholders(
  headers: Record<string, string>,
  creds: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    let s = v;
    if (s.includes("<PROJECT_ID>") && creds["projectId"]) s = s.replace("<PROJECT_ID>", creds["projectId"]);
    if (s.includes("<anonKey>") && creds["anonKey"]) s = s.replace("<anonKey>", creds["anonKey"]);
    out[k] = s;
  }
  return out;
}

export type ForwardOpts = {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Extra URL query params, encoded safely (e.g. PostgREST {select: "*"}). */
  query?: Record<string, string>;
  /** Form fields for form-only upstreams (mailgun, twilio). Mutually
   *  exclusive with body; sent as application/x-www-form-urlencoded. */
  form?: Record<string, string>;
};

const QUERY_KEY_RE = /^[A-Za-z0-9_.~-]+$/;

export function validateQueryParams(q: unknown): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (q === undefined) return { ok: true, value: {} };
  if (q === null || typeof q !== "object" || Array.isArray(q)) return { ok: false, error: "query must be an object" };
  const entries = Object.entries(q as Record<string, unknown>);
  if (entries.length > 50) return { ok: false, error: "too many query params" };
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof k !== "string" || !QUERY_KEY_RE.test(k) || k.length > 256) return { ok: false, error: `invalid query param: ${k}` };
    if (typeof v !== "string" || v.length > 2000 || /[\r\n\0]/.test(v)) return { ok: false, error: `invalid query value for ${k}` };
    out[k] = v;
  }
  return { ok: true, value: out };
}

/** Pure builder: returns exact URL + headers the proxy will send. No network. */
export function buildUpstreamRequest(target: Target, apiKey: string, opts: ForwardOpts): { url: string; headers: Record<string, string>; body: string | undefined } {
  let p = opts.path || "/";
  if (!p.startsWith("/")) p = "/" + p;
  // Provider defaults first, then caller headers — but the auth header is
  // always re-injected afterwards so a caller cannot override or duplicate it.
  const headers: Record<string, string> = { "content-type": "application/json", ...target.extraHeaders, ...(opts.headers ?? {}) };
  const qv = validateQueryParams(opts.query);
  if (!qv.ok) throw new Error(qv.error);
  for (const [k, v] of Object.entries(qv.value)) {
    p += `${p.includes("?") ? "&" : "?"}${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }
  if (target.keyHeader.startsWith("query:")) {
    const name = target.keyHeader.slice("query:".length);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("keyHeader invalid");
    const sep = p.includes("?") ? "&" : "?";
    p += `${sep}${name}=${encodeURIComponent(apiKey)}`;
  } else {
    // Remove any caller-supplied header that case-insensitively matches the
    // auth header: HTTP is case-insensitive but JS keys are not, so leaving
    // both would send two auth headers and the upstream may prefer the attacker's.
    const want = target.keyHeader.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === want) delete headers[k];
    }
    headers[target.keyHeader] = target.keyPrefix + apiKey;
  }
  const base = target.baseUrl.endsWith("/") ? target.baseUrl.slice(0, -1) : target.baseUrl;
  if (opts.form !== undefined) {
    // Form-only upstreams: urlencode fields and override the JSON content type.
    // Caller content-type is dropped so the header can't lie about the body.
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === "content-type") delete headers[k];
    }
    headers["content-type"] = "application/x-www-form-urlencoded";
    return { url: base + p, headers, body: new URLSearchParams(opts.form).toString() };
  }
  return { url: base + p, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) };
}
