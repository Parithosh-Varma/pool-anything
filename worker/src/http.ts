// Request/response plumbing: JSON bodies, CORS, bearer auth.
// Mirrors src/common/http.ts + src/middleware/auth.ts for the edge runtime.

import type { Env } from "./env.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function text(body: string, status = 200, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "content-type": contentType, "cache-control": "no-store" } });
}

/** Read + parse a JSON body with a hard byte cap (never buffers more than the cap). */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("too large");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error("too large");
  if (buf.byteLength === 0) return {};
  const s = new TextDecoder().decode(buf);
  try {
    return JSON.parse(s);
  } catch {
    throw new Error("bad json");
  }
}

const DEFAULT_ORIGINS = ["https://pool-anything-tools.pages.dev", "https://pool-anything.pages.dev"];

function allowedOrigins(env: Env): string[] {
  const raw = (env.ALLOWED_ORIGINS ?? "").trim();
  if (!raw) return DEFAULT_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** True for the hosted UI, explicit allowlist entries, and http loopback dev. */
export function isAllowedOrigin(origin: string, env: Env): boolean {
  if (allowedOrigins(env).includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "http:") return false;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** CORS headers for this request. Only allowlisted origins get ACAO. */
export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-pool-sticky",
  };
  const origin = req.headers.get("origin");
  if (origin && isAllowedOrigin(origin, env)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
  }
  return headers;
}

export function withCors(res: Response, cors: Record<string, string>): Response {
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export function apiToken(env: Env): string {
  return (env.POOL_API_TOKEN ?? "").trim();
}

export function isAuthorized(req: Request, env: Env): boolean {
  const token = apiToken(env);
  if (!token) return true;
  const h = req.headers.get("authorization");
  if (typeof h !== "string") return false;
  const want = `Bearer ${token}`;
  if (h.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/**
 * Routes that disclose raw keys or call bodies, mutate state, spend quota, or
 * advance the rotation cursor require auth when POOL_API_TOKEN is set. Masked
 * pool/key summaries and analytics stay public so the dashboard can render
 * before a token is entered.
 */
export function requiresAuth(method: string, pathname: string): boolean {
  if (/^\/api\/pools\/\d+\/keys\/\d+$/.test(pathname)) return true;
  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    if (pathname.startsWith("/api/")) return true;
  }
  if (method === "POST" && /^\/proxy\/\d+$/.test(pathname)) return true;
  if (method === "GET" && /^\/api\/pools\/\d+\/(next|calls)$/.test(pathname)) return true;
  return false;
}

export function errorResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : "internal error";
  if (msg === "bad json" || msg === "too large" || msg === "connection closed") return json({ error: msg }, 400);
  console.error("[error]", err);
  return json({ error: "internal error" }, 500);
}
