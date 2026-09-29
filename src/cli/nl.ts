/**
 * Natural-language command parser for the `pool-anything` REPL.
 *
 * Ceiling: keyword/regex matching only — no LLM, no grammar engine.
 * If this outgrows ~20 intents, replace with a proper command table.
 */

export type Intent =
  | { kind: "list-pools" }
  | { kind: "list-providers" }
  | { kind: "list-keys"; ref: string }
  | { kind: "usage"; ref: string }
  | { kind: "create-pool"; name: string; provider: string }
  | { kind: "delete-pool"; ref: string }
  | { kind: "add-keys"; ref: string; count: number | null }
  | { kind: "watch"; ref: string }
  | { kind: "next"; ref: string }
  | { kind: "consume"; tokens: number; ref: string }
  | { kind: "serve" }
  | { kind: "update" }
  | { kind: "uninstall" }
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "version" }
  | { kind: "exit" }
  | { kind: "unknown"; raw: string };

function clean(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^please\s+/, "")
    .replace(/[?.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip filler words leaving the pool/provider reference. */
function refOf(s: string, drop: RegExp): string {
  return s
    .replace(drop, " ")
    .replace(/\b(pool|pools|key|keys|provider|for|from|of|on|in|the|my|a|an|to|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POOL_WORDS = /\b(list|ls|show|display|get|all|my)\b/g;
const USAGE_WORDS = /\b(show|display|get|list|what|whats|what's|check|my|pool|pools|usage|use|used|stats|statistics|status|tokens?|quota|remaining|consumption)\b/g;
const KEY_LIST_WORDS = /\b(list|ls|show|display|get|all|my|pool|pools|key|keys)\b/g;
const ADD_WORDS = /\b(add|import|paste|insert|append|put|save|store|key|keys|pool|pools|to|into|in|for|the|my|new)\b/g;
const WATCH_WORDS = /^watch\s*/;
const NEXT_WORDS = /^(next|rotate|pick|draw|get key|grab)\b\s*/;
const DELETE_WORDS = /\b(delete|remove|drop|destroy|pool|pools|the|my|a)\b/g;

export function parse(input: string): Intent {
  const raw = input.trim();
  if (!raw) return { kind: "unknown", raw: input };
  const s = clean(input);

  if (/^(exit|quit|:q|bye|goodbye|done)$/.test(s)) return { kind: "exit" };
  if (/^(\.help|help|\?|commands)$/.test(s)) return { kind: "help" };
  if (/^(clear|cls)$/.test(s)) return { kind: "clear" };
  if (/^(version|--version|-v)$/.test(s)) return { kind: "version" };
  if (/^(serve|start|run|launch)( the)?( server| ui| web| app)?$/.test(s)) return { kind: "serve" };
  if (/^(server|web ui|dashboard)$/.test(s)) return { kind: "serve" };
  // Self-maintenance: `update`/`/update` upgrades via npm; `uninstall` removes
  // the global install (CLI only — no UI affordance by design).
  if (/^[/.]?(update|upgrade)\b/.test(s) || /^(check for updates?|check updates?)$/.test(s)) return { kind: "update" };
  if (
    /^[/.]?uninstall\b/.test(s) ||
    /\buninstall\b/.test(s) ||
    /^(remove|delete) (self|pool-anything|the app)\b/.test(s)
  ) return { kind: "uninstall" };

  // Keys before pools: "list keys ..." contains neither "pool" word necessarily.
  if (/\bkeys?\b/.test(s) && /\b(list|ls|show|display|get)\b/.test(s)) {
    return { kind: "list-keys", ref: refOf(s, KEY_LIST_WORDS) };
  }
  if (/\bproviders?\b/.test(s) && /\b(list|ls|show|display|get|all|what|available)\b/.test(s)) {
    return { kind: "list-providers" };
  }
  if (/^(ls|pools?)$/.test(s) || (/\bpools?\b/.test(s) && /\b(list|ls|show|display|get|all|my)\b/.test(s))) {
    return { kind: "list-pools" };
  }
  if (/^watch\b/.test(s)) {
    return { kind: "watch", ref: refOf(s.replace(WATCH_WORDS, ""), POOL_WORDS) };
  }
  if (/^(next|rotate|pick|draw|grab)\b/.test(s)) {
    return { kind: "next", ref: refOf(s.replace(NEXT_WORDS, ""), POOL_WORDS) };
  }
  const consume = s.match(/^(consume|record|log|bill|add usage|use)\b\s+(\d+)\b\s*(tokens?|toks?)?\s*(.*)$/);
  if (consume) {
    const tokens = Number(consume[2]);
    const ref = refOf(consume[4] ?? "", /\b(on|for|from|to|in|tokens?|toks?|pool|pools|key|keys|the|my|usage)\b/g);
    if (Number.isSafeInteger(tokens) && tokens > 0) return { kind: "consume", tokens, ref };
  }
  if (/\b(add|import|paste|insert|append|put|save|store)\b/.test(s) && /\bkeys?\b/.test(s)) {
    const count = s.match(/\b(\d+)\s*keys?\b/) ?? s.match(/\bkeys?\b.*?(\d+)\b/);
    return {
      kind: "add-keys",
      ref: refOf(s, ADD_WORDS).replace(/^\d+\s*|\s*\d+$/, "").trim(),
      count: count ? Number(count[1]) : null,
    };
  }
  if (/\b(delete|remove|drop|destroy)\b/.test(s) && /\bpools?\b/.test(s)) {
    return { kind: "delete-pool", ref: refOf(s, DELETE_WORDS) };
  }
  if (/\b(create|new|make)\b/.test(s) && /\bpools?\b/.test(s)) {
    // "create pool <name> for <provider>" — provider is the last word after "for".
    // Name keeps the user's original casing (match on a case-preserved copy).
    const cased = input.trim().replace(/\s+/g, " ");
    const cm = cased.match(/\bfor\s+([A-Za-z0-9-]+)\s*$/) ?? cased.match(/\bprovider\s+([A-Za-z0-9-]+)\s*$/i);
    const casedCut = cm ? cased.slice(0, cm.index).trim() : cased;
    const name = casedCut
      .replace(/\b(create|new|make|a|pool|pools|named|called|the|my)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { kind: "create-pool", name, provider: (cm?.[1] ?? "").toLowerCase() };
  }
  if (/\b(usage|use|used|stats|statistics|status|tokens?|toks?|quota|remaining|consumption)\b/.test(s)) {
    return { kind: "usage", ref: refOf(s, USAGE_WORDS) };
  }
  return { kind: "unknown", raw: input };
}

// --- smart suggestions (edit distance over canonical forms + provider ids) ---

const CANONICAL = [
  "list pools",
  "list providers",
  "list keys",
  "show usage for",
  "add keys to",
  "create pool",
  "delete pool",
  "watch",
  "serve",
  "update",
  "uninstall",
  "help",
  "exit",
];

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Best-guess suggestion for unknown input, or null. Compares against canonical commands. */
export function suggest(input: string, providerIds: string[] = []): string | null {
  const s = clean(input);
  if (!s) return null;
  const first2 = s.split(" ").slice(0, 2).join(" ");
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of [...CANONICAL, ...providerIds.map((p) => `show usage for ${p}`)]) {
    const target = c.startsWith("show usage") ? c : c;
    const d = Math.min(distance(first2, target), distance(s, target) - Math.max(0, s.length - target.length) * 0.5);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best !== null && bestD <= 4 ? best : null;
}
