import { lookup } from "node:dns/promises";
import { isPrivateLiteral } from "./forward.js";

/** Resolve a hostname and reject if any address is loopback/private. */
export async function resolveAndCheck(hostname: string): Promise<{ ok: true; ips: string[] } | { ok: false; error: string }> {
  let h = hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".") && h.length > 1) h = h.slice(0, -1);
  // Fast path: literal check, no DNS needed.
  if (isPrivateLiteral(h)) return { ok: false, error: "upstream host blocked" };
  // Hostnames without dots that are not localhost (e.g. intranet names) are
  // overwhelmingly internal: fail closed without a DNS round-trip.
  if (!h.includes(".") && !h.includes(":")) return { ok: false, error: "upstream host blocked" };
  try {
    const addrs = await lookup(h, { all: true });
    const ips = addrs.map((a) => a.address);
    if (ips.length === 0) return { ok: false, error: "upstream host did not resolve" };
    for (const ip of ips) {
      if (isPrivateLiteral(ip)) return { ok: false, error: "upstream host resolves to a private address" };
    }
    return { ok: true, ips };
  } catch {
    return { ok: false, error: "upstream host did not resolve" };
  }
}

export function hostnameOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}
