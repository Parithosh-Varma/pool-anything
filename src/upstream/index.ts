import { PROVIDERS } from "../pool/index.js";

export type Target = {
  baseUrl: string;
  keyHeader: string;
  keyPrefix: string;
  extraHeaders: Record<string, string>;
};

export function resolveTarget(pool: { provider: string; base_url: string; key_header: string; key_prefix: string }): Target {
  const p = PROVIDERS.find((x) => x.id === pool.provider);
  return {
    baseUrl: pool.base_url || p?.baseUrl || "",
    keyHeader: pool.key_header || p?.keyHeader || "X-API-Key",
    keyPrefix: pool.key_prefix || p?.keyPrefix || "",
    extraHeaders: p?.extraHeaders ?? {},
  };
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
  const headers: Record<string, string> = { "content-type": "application/json", ...target.extraHeaders, ...(opts.headers ?? {}) };
  if (target.keyHeader.startsWith("query:")) {
    const sep = p.includes("?") ? "&" : "?";
    p += `${sep}${target.keyHeader.slice("query:".length)}=${encodeURIComponent(apiKey)}`;
  } else {
    headers[target.keyHeader] = target.keyPrefix + apiKey;
  }
  return { url: target.baseUrl + p, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) };
}
