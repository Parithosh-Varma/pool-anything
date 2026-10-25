/**
 * In-process in-flight counters for `least-connections`.
 *
 * Deliberately not persisted: "in flight" is process-local by definition, and
 * a crash cannot leave a stale count behind. Like `pools.cursor`, this assumes
 * one server process per SQLite file.
 */

const counts = new Map<number, number>();

export function beginRequest(keyId: number): void {
  counts.set(keyId, (counts.get(keyId) ?? 0) + 1);
}

export function endRequest(keyId: number): void {
  const next = (counts.get(keyId) ?? 0) - 1;
  if (next > 0) counts.set(keyId, next);
  else counts.delete(keyId);
}

export function inFlight(keyId: number): number {
  return counts.get(keyId) ?? 0;
}

/** Snapshot for diagnostics/tests. */
export function inFlightSnapshot(): Record<number, number> {
  return Object.fromEntries(counts);
}
