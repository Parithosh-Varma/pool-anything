// In-isolate in-flight counters for `least-connections`. Workers isolates are
// single-process, so this sees only traffic handled by this isolate — the same
// caveat the Node server documents for multi-process deployments.

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
