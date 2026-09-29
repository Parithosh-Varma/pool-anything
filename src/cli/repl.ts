/**
 * Plain-text frontend over the command core: readline REPL fallback + one-shot exec.
 * The rich interactive shell lives in tui.tsx (Ink); this stays script-friendly.
 */
import readline from "node:readline";
import { PROVIDERS } from "../pool/index.js";
import { HOST, PORT } from "../config/env.js";
import { parse } from "./nl.js";
import { banner, poolsBox, usageBlock, maskTip, fmtFull } from "./ui.js";
import { dispatch, insertKeys, liveStats, type CmdResult, type PoolRef } from "./commands.js";

export type ImportState = { pool: PoolRef; expected: number | null; lines: string[] };

/** Render one result as plain text. Returns an import state when pasting begins. */
export function renderResult(r: CmdResult): ImportState | null {
  switch (r.kind) {
    case "exit": return null;
    case "clear": console.clear(); return null;
    case "message": console.log(r.text); return null;
    case "pools": console.log(poolsBox(r.pools)); return null;
    case "providers":
      for (const p of PROVIDERS) console.log(`- ${p.id} — ${p.name} (${p.quota || "no quota"})`);
      return null;
    case "keys": {
      if (r.keys.length === 0) {
        console.log(`Pool #${r.pool.id} "${r.pool.name}" has no keys. Try: add keys to ${r.pool.provider}.`);
        return null;
      }
      console.log(`Keys in pool #${r.pool.id} "${r.pool.name}":`);
      for (const k of r.keys) console.log(`  #${k.id} ${k.label} (${k.masked})`);
      console.log(maskTip());
      return null;
    }
    case "usage": {
      console.log(usageBlock(r.view));
      for (const k of r.perKey) console.log(`  ${k.label} (${k.masked}): ${fmtFull(k.used)} tok`);
      return null;
    }
    case "import":
      console.log(`✓ Opening key import mode for "${r.pool.name}" (pool #${r.pool.id})`);
      console.log(r.hint);
      return { pool: r.pool, expected: r.expected, lines: [] };
    case "watch": {
      void watchPlain(r.pool);
      return null;
    }
    case "serve":
      console.log(r.already ? `Server already running on http://${HOST}:${PORT}` : `Serving on http://${HOST}:${PORT}`);
      return null;
  }
}

export function finishImport(st: ImportState): void {
  if (st.lines.length === 0) {
    console.log("No keys pasted — nothing added.");
    return;
  }
  const { added, skipped } = insertKeys(st.pool, st.lines);
  console.log(`✓ Added ${added} key${added === 1 ? "" : "s"} to pool #${st.pool.id}${skipped > 0 ? ` (${skipped} skipped: blank/duplicate/invalid)` : ""}.`);
}

async function watchPlain(pool: PoolRef): Promise<void> {
  const { mask } = await import("../pool/index.js");
  console.log(`Pool #${pool.id} "${pool.name}" — live usage  [auto-refresh 2s, press q to exit]`);
  await new Promise<void>((resolve) => {
    const render = () => {
      const st = liveStats(pool.id);
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
      console.log(`Pool #${pool.id} "${pool.name}" — live usage  [auto-refresh 2s, press q to exit]`);
      console.log(`  Requests: ${st.reqMin}/min  │ Tokens: ${st.tokMin}/min  │ Avg latency: ${st.avgLatency === null ? "—" : `${(st.avgLatency / 1000).toFixed(1)}s`}`);
      for (const k of st.perKey) console.log(`  ${k.label} (${mask(k.apiKey)}): ${fmtFull(k.used)} tok`);
      console.log(`  ─────────────────────────────────────────`);
    };
    render();
    const timer = setInterval(render, 2000);
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY && typeof stdin.setRawMode === "function";
    if (wasRaw) (stdin as NodeJS.ReadStream).setRawMode(true);
    stdin.resume();
    const onKey = (buf: Buffer) => {
      const ch = buf.toString();
      if (ch === "q" || ch === "Q" || ch === "\u0003" || ch === "\u001b") {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearInterval(timer);
      stdin.off("data", onKey);
      if (wasRaw) (stdin as NodeJS.ReadStream).setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onKey);
  });
  console.log("Stopped watching.");
}

/** Execute one line in the plain frontend. Returns "exit" or a pending import. */
export async function runLine(input: string, ask: (q: string) => Promise<string>): Promise<"exit" | "ok" | ImportState> {
  const r = await dispatch(input, ask);
  if (r.kind === "exit") return "exit";
  if (r.kind === "watch") {
    await watchPlain(r.pool);
    return "ok";
  }
  const imp = renderResult(r);
  // A confirmed uninstall removes the binary out from under us — show the
  // result, then leave the shell instead of prompting on a dead install.
  if (
    parse(input).kind === "uninstall" &&
    r.kind === "message" && r.tone === "ok"
  ) return "exit";
  return imp ?? "ok";
}

export async function startRepl(version: string): Promise<void> {
  console.log(banner(version));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "pool-anything > " });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
  let importing: ImportState | null = null;
  rl.prompt();
  rl.on("line", (raw) => {
    void (async () => {
      if (importing) {
        if (raw.trim() === "" || raw.trim() === ".done") {
          const st = importing;
          importing = null;
          finishImport(st);
        } else {
          importing.lines.push(raw);
          if (importing.expected !== null && importing.lines.length >= importing.expected) {
            const st = importing;
            importing = null;
            finishImport(st);
          } else {
            rl.prompt();
            return;
          }
        }
        rl.prompt();
        return;
      }
      try {
        const done = await runLine(raw, ask);
        if (typeof done === "object") {
          importing = done;
          rl.setPrompt("... ");
        } else {
          rl.setPrompt("pool-anything > ");
          if (done === "exit") rl.close();
        }
      } catch (e) {
        console.log(`Error: ${(e as Error).message}`);
      }
      if ((rl as unknown as { closed?: boolean }).closed !== true) rl.prompt();
    })();
  });
  rl.on("close", () => {
    if (importing && importing.lines.length > 0) {
      console.log("");
      finishImport(importing);
      importing = null;
    }
  });
  await new Promise<void>((resolve) => rl.on("close", () => resolve()));
  console.log("Goodbye!");
}

/** One-shot: run a single NL command without the interactive loop. */
export async function execOnce(command: string): Promise<number> {
  const intent = parse(command);
  if (intent.kind === "add-keys") {
    const { resolvePool } = await import("./commands.js");
    const pool = resolvePool(intent.ref);
    if (!pool) {
      console.log(intent.ref.trim() ? `No pool matches "${intent.ref.trim()}".` : "No pools yet.");
      return 1;
    }
    if (process.stdin.isTTY) {
      console.log("Interactive paste needs a TTY — run `pool-anything` and type the command there, or pipe keys via stdin.");
      return 1;
    }
    const text = await new Promise<string>((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => { buf += c; });
      process.stdin.on("end", () => resolve(buf));
    });
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      console.log("No keys on stdin — nothing added.");
      return 1;
    }
    const { added, skipped } = insertKeys(pool, lines);
    console.log(`✓ Added ${added} key${added === 1 ? "" : "s"} to pool #${pool.id}${skipped > 0 ? ` (${skipped} skipped)` : ""}.`);
    return 0;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
  try {
    const r = await dispatch(command, ask);
    if (r.kind === "import") {
      console.log("Key import needs an interactive shell — run `pool-anything` without arguments.");
      return 1;
    }
    if (r.kind === "watch") {
      rl.close();
      await watchPlain(r.pool);
      return 0;
    }
    if (r.kind === "exit" || r.kind === "clear") return 0;
    renderResult(r);
    return 0;
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    return 1;
  } finally {
    rl.close();
  }
}
