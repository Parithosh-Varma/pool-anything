import { resolveDbPath } from "./paths.js";

/** Port for the web UI + API (single server). */
function parsePort(): number {
  const n = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 3000;
  return n;
}
export const PORT = parsePort();

/**
 * Interface to bind. Defaults to loopback: the API serves raw keys with no
 * auth, so it must not listen on all interfaces unless the operator opts in
 * behind their own auth layer (reverse proxy, VPN, firewall).
 */
export const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * SQLite file. Precedence: LOCAL_DB_PATH > POOL_DATA_DIR > checkout-local
 * default (./data/pool-anything.db) or global default (~/.pool-anything/).
 * Evaluated at import — tests set LOCAL_DB_PATH before importing.
 */
export const DB_PATH = resolveDbPath();

/** Proxy upstream timeout in ms. Read live so tests/CLI can override per run. */
export function proxyTimeoutMs(): number {
  const n = Number(process.env.PROXY_TIMEOUT_MS ?? 30000);
  if (!Number.isFinite(n) || n <= 0) return 30000;
  return Math.min(n, 60000);
}

/** Test/loopback escape hatch only: allows http + private hosts upstream. Never in prod. */
export function allowPrivateUpstream(): boolean {
  return process.env.ALLOW_PRIVATE_UPSTREAM === "1";
}

/** Optional bearer token protecting raw keys, writes, and proxy use. Read live so tests can override. */
export function apiToken(): string {
  return (process.env.POOL_API_TOKEN ?? "").trim();
}

export function authEnabled(): boolean {
  return apiToken().length > 0;
}

/**
 * Cross-origin callers permitted to read API responses in the browser.
 * Default: the hosted Pages tools UI + local dev origins only — never `*`
 * and never an reflected arbitrary Origin. Operators self-hosting the UI on
 * another domain set ALLOWED_ORIGINS="https://ui.example.com,...".
 */
const DEFAULT_ORIGINS = [
  "https://pool-anything-tools.pages.dev",
  "https://pool-anything.pages.dev",
];

export function allowedOrigins(): string[] {
  const raw = (process.env.ALLOWED_ORIGINS ?? "").trim();
  if (!raw) return [...DEFAULT_ORIGINS];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** True for the hosted UI, explicit allowlist entries, and http loopback dev. */
export function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins().includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "http:") return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return false;
  } catch {
    return false;
  }
}

/** Warn once at startup when running in an insecure configuration. */
export function startupWarnings(): string[] {
  const warnings: string[] = [];
  if (allowPrivateUpstream()) {
    warnings.push("ALLOW_PRIVATE_UPSTREAM=1 is set: SSRF protections are OFF. Test/loopback only — never with real keys or a public bind.");
  }
  if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
    if (!authEnabled()) {
      warnings.push(`HOST=${HOST} binds a non-loopback interface with no auth (POOL_API_TOKEN unset). Set POOL_API_TOKEN or put it behind your own auth layer.`);
    } else {
      warnings.push(`HOST=${HOST} binds a non-loopback interface. Bearer auth is enabled — ensure POOL_API_TOKEN is strong and served over TLS/VPN.`);
    }
  }
  if (authEnabled() && apiToken().length < 16) {
    warnings.push("POOL_API_TOKEN is set but short (<16 chars). Use a long random token.");
  }
  return warnings;
}
