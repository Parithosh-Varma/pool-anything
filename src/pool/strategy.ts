/**
 * Key-selection strategies. Every strategy is a pure synchronous function of
 * the already-filtered candidate list plus a context: no DB access, no network,
 * deterministic given `rng`. Cooldown and quota filtering stays in
 * `eligibleKeys()`; strategies only narrow further.
 */

export const STRATEGY_NAMES = [
  "round-robin",
  "random",
  "weighted-random",
  "weighted-round-robin",
  "least-connections",
  "least-used",
  "least-recently-used",
  "sticky",
  "power-of-two",
  "tiered",
  "shuffle-shard",
  "time-based",
  "health-aware",
] as const;

export type StrategyName = (typeof STRATEGY_NAMES)[number];

const STRATEGY_SET: ReadonlySet<string> = new Set(STRATEGY_NAMES);

export function isStrategyName(value: unknown): value is StrategyName {
  return typeof value === "string" && STRATEGY_SET.has(value);
}

/** A key that already passed cooldown + quota filtering. */
export type Candidate = {
  key_id: number;
  /** Relative capacity. 0 = never picked while any positive-weight key exists. */
  weight: number;
  /** Lower wins; tiered uses the best tier only. */
  priority: number;
  /** Requests assigned so far (survives restarts). */
  picks: number;
  /** Epoch ms of the last assignment; 0 = never. */
  last_used_at: number;
  consec_fail: number;
  latency_ms: number | null;
  /** Live requests currently in flight on this key (in-process). */
  in_flight: number;
};

/** Per-strategy numeric options, e.g. `{"time-based":{"everyN":50}}`. */
export type RotationOptions = Record<string, Record<string, number>>;

export const DEFAULT_ROTATION_OPTIONS: RotationOptions = {
  "health-aware": { breakerAfter: 5 },
  "time-based": { everyMs: 30_000, everyN: 50 },
  "shuffle-shard": { shardSize: 2 },
};

export function defaultRotationOptions(): RotationOptions {
  return Object.fromEntries(
    Object.entries(DEFAULT_ROTATION_OPTIONS).map(([k, v]) => [k, { ...v }])
  );
}

/** Parse `POOL_ROTATION_OPTIONS`. Malformed input yields defaults + an error for the caller to warn about. */
export function parseRotationOptions(
  raw: unknown
): { ok: true; value: RotationOptions } | { ok: false; error: string; value: RotationOptions } {
  const value = defaultRotationOptions();
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value };
  }
  if (typeof raw !== "string") return { ok: false, error: "must be JSON", value };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON", value };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "must be a JSON object", value };
  }
  for (const [strategy, options] of Object.entries(parsed as Record<string, unknown>)) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      return { ok: false, error: `${strategy} must be an object`, value };
    }
    const bucket = value[strategy] ?? {};
    for (const [name, n] of Object.entries(options as Record<string, unknown>)) {
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${strategy}.${name} must be a non-negative number`, value };
      }
      bucket[name] = n;
    }
    value[strategy] = bucket;
  }
  return { ok: true, value };
}

export type StrategyState = Record<string, unknown>;

/** Parse the `pools.strategy_state` JSON blob. Never throws. */
export function parseStrategyState(raw: unknown): StrategyState {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StrategyState;
    }
  } catch {
    // Corrupt state is equivalent to no state: strategies rebuild it on the next pick.
  }
  return {};
}

export type StrategyContext = {
  poolId: number;
  cursor: number;
  sticky?: string;
  /** 0 on the first attempt, 1 on the first failover, ... */
  attempt: number;
  now: number;
  options: RotationOptions;
  rng: () => number;
  state: StrategyState;
};

export type Selection = {
  key: Candidate;
  /** True when the selection consumed the pool cursor (round-robin family). */
  advanceCursor: boolean;
  /** Replacement strategy_state blob for stateful strategies (time-based). */
  state?: StrategyState;
};

/** FNV-1a 32-bit. Stable across processes and restarts — required for sticky routing. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function optionNumber(options: RotationOptions, strategy: string, key: string, fallback: number): number {
  const v = options[strategy]?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Load ordering: in-flight, then assignments, then known latency, then id. */
function byLoad(a: Candidate, b: Candidate): number {
  if (a.in_flight !== b.in_flight) return a.in_flight - b.in_flight;
  if (a.picks !== b.picks) return a.picks - b.picks;
  const al = a.latency_ms ?? Number.POSITIVE_INFINITY;
  const bl = b.latency_ms ?? Number.POSITIVE_INFINITY;
  if (al !== bl) return al - bl;
  return a.key_id - b.key_id;
}

function byPicks(a: Candidate, b: Candidate): number {
  if (a.picks !== b.picks) return a.picks - b.picks;
  return byLoad(a, b);
}

function lowest(list: Candidate[], score: (c: Candidate) => number): Candidate {
  let best = list[0]!;
  let bestScore = score(best);
  for (let i = 1; i < list.length; i++) {
    const c = list[i]!;
    const s = score(c);
    if (s < bestScore || (s === bestScore && byLoad(c, best) < 0)) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

function roundRobin(list: Candidate[], cursor: number): Selection {
  const i = ((cursor % list.length) + list.length) % list.length;
  return { key: list[i]!, advanceCursor: true };
}

function uniformRandom(list: Candidate[], rng: () => number): Selection {
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return { key: list[i]!, advanceCursor: false };
}

type ParkState = { keyId: number; at: number; count: number };

function parkState(state: StrategyState): ParkState | null {
  const raw = state["timeBase"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { keyId, at, count } = raw as Record<string, unknown>;
  if (typeof keyId !== "number" || typeof at !== "number" || typeof count !== "number") return null;
  return { keyId, at, count };
}

/** Try every strategy by name. Candidates must be non-empty. */
export function selectKey(name: StrategyName, candidates: Candidate[], ctx: StrategyContext): Selection {
  if (candidates.length === 0) throw new Error("selectKey requires at least one candidate");

  // A zero weight is a kill switch for every strategy, not just the weighted
  // ones. If every key is zero, degrade to uniform instead of failing.
  const hasPositive = candidates.some((c) => c.weight > 0);
  const usable = hasPositive ? candidates.filter((c) => c.weight > 0) : candidates;

  switch (name) {
    case "round-robin":
      return roundRobin(usable, ctx.cursor);

    case "random":
      return uniformRandom(usable, ctx.rng);

    case "weighted-random": {
      const total = usable.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
      if (total <= 0) return uniformRandom(usable, ctx.rng);
      let r = ctx.rng() * total;
      for (const c of usable) {
        r -= Math.max(0, c.weight);
        if (r < 0) return { key: c, advanceCursor: false };
      }
      return { key: usable[usable.length - 1]!, advanceCursor: false };
    }

    // Deterministic proportional allocation: the key furthest below its
    // fair share (picks / weight) goes next. Interleaves instead of bursting.
    case "weighted-round-robin":
      return {
        key: lowest(usable, (c) => c.picks / Math.max(1, c.weight)),
        advanceCursor: false,
      };

    case "least-connections":
      return { key: lowest(usable, (c) => c.in_flight), advanceCursor: false };

    case "least-used":
      return { key: [...usable].sort(byPicks)[0]!, advanceCursor: false };

    case "least-recently-used":
      return {
        key: lowest(usable, (c) => c.last_used_at),
        advanceCursor: false,
      };

    case "sticky": {
      // No session key: behave like round-robin rather than pinning everyone
      // to one key. State-free rendezvous hashing, as documented.
      if (!ctx.sticky) return roundRobin(usable, ctx.cursor);
      let best = usable[0]!;
      let bestScore = -1;
      for (const c of usable) {
        const score = hash32(`${ctx.sticky}\u0000${c.key_id}`);
        if (score > bestScore || (score === bestScore && byLoad(c, best) < 0)) {
          best = c;
          bestScore = score;
        }
      }
      return { key: best, advanceCursor: false };
    }

    case "power-of-two": {
      if (usable.length === 1) return { key: usable[0]!, advanceCursor: false };
      const i = Math.min(usable.length - 1, Math.max(0, Math.floor(ctx.rng() * usable.length)));
      let j = Math.min(usable.length - 2, Math.max(0, Math.floor(ctx.rng() * (usable.length - 1))));
      if (j >= i) j++;
      const a = usable[i]!;
      const b = usable[j]!;
      return { key: byLoad(a, b) <= 0 ? a : b, advanceCursor: false };
    }

    case "tiered": {
      // Only the lowest present priority tier is used. When those keys cool
      // down or exhaust quota they leave `eligibleKeys`, and the next tier is
      // already the lowest present one — overflow without extra state.
      const minPriority = Math.min(...usable.map((c) => c.priority));
      const tier = usable.filter((c) => c.priority === minPriority);
      return roundRobin(tier, ctx.cursor);
    }

    case "shuffle-shard": {
      const size = Math.min(
        usable.length,
        Math.max(1, Math.floor(optionNumber(ctx.options, "shuffle-shard", "shardSize", 2)))
      );
      let shard: Candidate[];
      if (ctx.sticky) {
        // Stable shard per session (and per failover attempt): a bad key can
        // only affect sessions whose shard contains it.
        const seed = `${ctx.sticky}\u0000${ctx.attempt}`;
        shard = [...usable]
          .sort((a, b) => hash32(`${seed}\u0000${a.key_id}`) - hash32(`${seed}\u0000${b.key_id}`) || a.key_id - b.key_id)
          .slice(0, size);
      } else {
        const copy = [...usable];
        for (let i = 0; i < size; i++) {
          const j = i + Math.floor(ctx.rng() * (copy.length - i));
          [copy[i], copy[j]] = [copy[j]!, copy[i]!];
        }
        shard = copy.slice(0, size);
      }
      return { key: shard.reduce((a, b) => (byLoad(a, b) <= 0 ? a : b)), advanceCursor: false };
    }

    case "time-based": {
      // Park on one key for everyMs / everyN, then advance round-robin.
      // 0 disables that limit; both 0 means park until the key leaves the pool.
      const everyMs = optionNumber(ctx.options, "time-based", "everyMs", 30_000);
      const everyN = optionNumber(ctx.options, "time-based", "everyN", 50);
      const parked = parkState(ctx.state);
      const anchor = parked ? usable.find((c) => c.key_id === parked.keyId) : undefined;
      if (parked && anchor && (everyMs === 0 || ctx.now - parked.at < everyMs) && (everyN === 0 || parked.count < everyN)) {
        return {
          key: anchor,
          advanceCursor: false,
          state: { ...ctx.state, timeBase: { keyId: anchor.key_id, at: parked.at, count: parked.count + 1 } },
        };
      }
      const next = roundRobin(usable, ctx.cursor);
      return {
        ...next,
        state: { ...ctx.state, timeBase: { keyId: next.key.key_id, at: ctx.now, count: 1 } },
      };
    }

    case "health-aware": {
      // Prefer keys with a clean failure streak; when every key is flaky,
      // fall back to all of them instead of failing the request.
      const breakerAfter = Math.max(1, optionNumber(ctx.options, "health-aware", "breakerAfter", 5));
      const healthy = usable.filter((c) => c.consec_fail < breakerAfter);
      return roundRobin(healthy.length > 0 ? healthy : usable, ctx.cursor);
    }

    default: {
      const exhaustive: never = name;
      throw new Error(`unknown strategy: ${String(exhaustive)}`);
    }
  }
}
