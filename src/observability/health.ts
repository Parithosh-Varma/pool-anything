import { dbPing } from "../db/index.js";
import { getAnalytics } from "../pool/index.js";

/** Liveness: never touches the DB. */
export function health(): { status: number; body: string; contentType: string } {
  return { status: 200, body: "ok\n", contentType: "text/plain" };
}

/** Readiness: SQLite reachable and writable enough to SELECT. Never throws. */
export function readiness(): { status: number; body: unknown } {
  try {
    return { status: 200, body: dbPing() };
  } catch {
    return { status: 500, body: { ok: false } };
  }
}

/** Analytics snapshot for the dashboard. Never throws (empty on failure). */
export function analyticsSnapshot(): { status: number; body: unknown } {
  try {
    return { status: 200, body: getAnalytics() };
  } catch {
    return {
      status: 500,
      body: {
        requests: 0, tokens: 0, pools: 0, keys: 0, cooling: 0, avgTokens: 0,
        series: [], keysSeries: [], poolsSeries: [],
        deltaRequestsPct: 0, deltaTokensPct: 0,
      },
    };
  }
}
