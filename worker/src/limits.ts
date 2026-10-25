// Worker-specific caps. A Durable Object has finite memory and only one SQLite
// row can be large, so the edge build keeps smaller media caps than Node.

export const MAX_TOKENS_PER_REQUEST = 1_000_000;

/** Proxy request JSON cap (includes base64 media). */
export const MAX_PROXY_BODY_BYTES = 6_000_000;
/** Buffered upstream bytes before truncating. */
export const MAX_UPSTREAM_MEDIA_BYTES = 6_000_000;
/** Relay cap for the base64/text returned to the caller (base64 of 6MB ≈ 8M chars). */
export const MAX_RELAY_CHARS = 8_000_000;

/** Calls history: text stays small; media keeps enough to preview. */
export const CALLS_BODY_CHARS = 16_000;
export const CALLS_MEDIA_CHARS = 600_000;

export const WORKER_VERSION = "0.1.1";
export const DEFAULT_UI_URL = "https://pool-anything-tools.pages.dev/";
