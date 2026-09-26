import type { IncomingMessage } from "node:http";
import { apiToken, authEnabled } from "../config/env.js";

/** True when the request carries the configured bearer token (or auth is disabled). */
export function isAuthorized(req: IncomingMessage): boolean {
  if (!authEnabled()) return true;
  const h = req.headers["authorization"];
  if (typeof h !== "string") return false;
  // Constant-time-ish compare without leaking length via early exit timing is
  // overkill here, but avoid `startsWith` prefix-oracle confusion: exact match only.
  const want = `Bearer ${apiToken()}`;
  if (h.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/**
 * Routes that disclose raw keys, mutate state, spend quota, or advance the
 * rotation cursor require auth when POOL_API_TOKEN is set. Masked read-only
 * summaries stay public so the dashboard works without a token.
 */
export function requiresAuth(method: string, pathname: string): boolean {
  // Raw key disclosure.
  if (/^\/api\/pools\/\d+\/keys\/\d+$/.test(pathname)) return true;
  // Writes.
  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    if (pathname.startsWith("/api/")) return true;
  }
  // Rotation cursor advances (state change) even though the key is masked.
  if (method === "GET" && /^\/api\/pools\/\d+\/next$/.test(pathname)) return true;
  return false;
}
