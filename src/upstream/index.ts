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
};

/** Pure builder: returns exact URL + headers the proxy will send. No network. */
export function buildUpstreamRequest(target: Target, apiKey: string, opts: ForwardOpts): { url: string; headers: Record<string, string>; body: string | undefined } {
  let p = opts.path || "/";
  if (!p.startsWith("/")) p = "/" + p;
  // Provider defaults first, then caller headers — but the auth header is
  // always re-injected afterwards so a caller cannot override or duplicate it.
  const headers: Record<string, string> = { "content-type": "application/json", ...target.extraHeaders, ...(opts.headers ?? {}) };
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
  return { url: base + p, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) };
}
