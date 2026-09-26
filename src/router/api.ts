/** Abuse caps (see SECURITY.md): unbounded creation grows the SQLite file. */
export const MAX_POOLS = 1000;
export const MAX_KEYS_PER_POOL = 100;
export const MAX_API_KEY_CHARS = 4096;

export type PoolRoute = { poolId: number; sub: "" | "/next" | "/consume" | "/usage" | "/proxy" };

/** Match /api/pools/:id[/next|/consume|/usage|/proxy] (never /keys). */
export function matchPoolRoute(pathname: string): PoolRoute | null {
  if (pathname.includes("/keys")) return null;
  const m = pathname.match(/^\/api\/pools\/(\d+)(\/next|\/consume|\/usage|\/proxy)?$/);
  if (!m) return null;
  return { poolId: Number(m[1]), sub: (m[2] ?? "") as PoolRoute["sub"] };
}

export type KeyRoute = { poolId: number; keyId: number | null };

/** Match /api/pools/:id/keys[/:keyId]. */
export function matchKeyRoute(pathname: string): KeyRoute | null {
  const m = pathname.match(/^\/api\/pools\/(\d+)\/keys(?:\/(\d+))?$/);
  if (!m) return null;
  return { poolId: Number(m[1]), keyId: m[2] === undefined ? null : Number(m[2]) };
}
