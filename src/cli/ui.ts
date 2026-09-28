/** Box/table rendering for the REPL. Zero dependencies; pure functions (testable). */

export function fmtFull(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 12450 -> "12.4k", 28000 -> "28k", 999 -> "999", 1.5M handled. */
export function fmtCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

function box(lines: string[]): string {
  const width = Math.max(...lines.map((l) => l.length), 0);
  const pad = (l: string) => `│ ${l.padEnd(width)} │`;
  return [`┌${"─".repeat(width + 2)}┐`, ...lines.map(pad), `└${"─".repeat(width + 2)}┘`].join("\n");
}

export function banner(version: string): string {
  return [
    `╔${"═".repeat(62)}╗`,
    `║ ${`pool-anything v${version} — API key pooler`.padEnd(60)} ║`,
    `║ ${`Type '.help' for commands, 'exit' to quit`.padEnd(60)} ║`,
    `╚${"═".repeat(62)}╝`,
  ].join("\n");
}

export type PoolRow = {
  id: number;
  name: string;
  provider: string;
  keys: number;
  used: number;
  quota: number | null;
  active: boolean;
};

export function poolsBox(pools: PoolRow[]): string {
  if (pools.length === 0) return "(no pools yet — try: create pool <name> for <provider>)";
  const header = `${pools.length} active pool${pools.length === 1 ? "" : "s"}`;
  const lines = pools.map((p) => {
    const usage = p.quota === null ? `${fmtCompact(p.used)} tokens` : `${fmtCompact(p.used)} / ${fmtCompact(p.quota * p.keys)} tokens`;
    const state = p.active ? "" : ", inactive";
    return `#${p.id} "${p.name}" (${p.provider}) — ${p.keys} key${p.keys === 1 ? "" : "s"}, ${usage}${state}`;
  });
  const width = Math.max(header.length, ...lines.map((l) => l.length));
  const out = [`┌${"─".repeat(width + 2)}┐`, `│ ${header.padEnd(width)} │`, `├${"─".repeat(width + 2)}┤`];
  for (const l of lines) out.push(`│ ${l.padEnd(width)} │`);
  out.push(`└${"─".repeat(width + 2)}┘`);
  return out.join("\n");
}

export type UsageView = {
  id: number;
  name: string;
  provider: string;
  used: number;
  quota: number | null;
  remaining: number | null;
  keys: number;
  cooling: number;
};

export function usageBlock(u: UsageView): string {
  const bar = "━".repeat(45);
  const quota = u.quota === null ? "unlimited" : fmtFull(u.quota * u.keys);
  const remaining = u.remaining === null ? "—" : fmtFull(u.remaining);
  const pct = u.quota === null || u.quota * u.keys === 0 ? "" : ` (${Math.round((u.used / (u.quota * u.keys)) * 100)}% exhausted)`;
  return [
    `Pool #${u.id}: ${u.name} (${u.provider})`,
    bar,
    ` Used: ${fmtFull(u.used)} tokens | Quota: ${quota} | Remaining: ${remaining}${pct}`,
    ` Status: ${u.cooling > 0 ? `${u.cooling} key${u.cooling === 1 ? "" : "s"} cooling` : "OK"} | Keys: ${u.keys} active, ${u.cooling} cooling`,
    bar,
  ].join("\n");
}

export function helpBox(): string {
  const rows: [string, string][] = [
    ["list pools", "show all pools with key counts + usage"],
    ["list providers", "show known providers"],
    ["list keys [for <pool>]", "masked keys in a pool"],
    ["show usage for <pool>", "token usage, quota, per-key breakdown"],
    ["add [N] keys to <pool>", "paste keys (one per line, empty line to finish)"],
    ["create pool <name> for <provider>", "make a new pool"],
    ["delete pool <name>", "remove a pool (asks to confirm)"],
    ["watch <pool>", "live usage, refreshes every 2s (q to exit)"],
    ["next [for <pool>]", "rotate: show the next key (masked)"],
    ["consume <n> [on <pool>]", "record token usage"],
    ["serve", "start the web UI + API server"],
    ["clear", "clear the screen"],
    ["exit", "quit"],
  ];
  const w = Math.max(...rows.map(([c]) => c.length));
  return ["Commands:", ...rows.map(([c, d]) => `  ${c.padEnd(w)}  ${d}`)].join("\n");
}

export function maskTip(): string {
  return "Keys are shown masked (gsk_…ab) — raw values never print.";
}

// Re-export box helper for tests (kept trivial on purpose).
export { box };
