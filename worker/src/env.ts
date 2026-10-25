export type Env = {
  DB: D1Database;
  /** Bearer token required for writes/raw-key reads/proxy use when set. */
  POOL_API_TOKEN?: string;
  /** Comma-separated CORS allowlist (Pages UI is always allowed). */
  ALLOWED_ORIGINS?: string;
  /** "1" allows http + private upstreams. Test/loopback only. */
  ALLOW_PRIVATE_UPSTREAM?: string;
  /** Upstream timeout in ms (default 30000, max 60000). */
  PROXY_TIMEOUT_MS?: string;
  /** Default rotation strategy for pools without their own. */
  POOL_ROTATION_STRATEGY?: string;
  /** JSON per-strategy options, e.g. {"time-based":{"everyN":50}}. */
  POOL_ROTATION_OPTIONS?: string;
  /** "1" logs proxy attempts to the Worker log (never bodies or keys). */
  POOL_DEBUG?: string;
  /** Where GET /ui sends the browser (default: hosted tools UI). */
  UI_URL?: string;
};
