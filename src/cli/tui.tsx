/**
 * Rich interactive shell built on Ink + React.
 * Same command core as the plain frontend (commands.ts) — only rendering differs.
 * `serve` exits the TUI first (Ink owns the screen) and boots the server after.
 */
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { PROVIDERS, mask } from "../pool/index.js";
import { HOST, PORT } from "../config/env.js";
import { parse } from "./nl.js";
import { fmtCompact, fmtFull } from "./ui.js";
import {
  dispatch,
  insertKeys,
  liveStats,
  type CmdResult,
  type PoolRef,
} from "./commands.js";
import type { PoolRow, UsageView as UsageViewData } from "./ui.js";

export let serveRequested = false;

let nextId = 1;
type Entry = { id: number; node: React.ReactNode };

function useTranscript() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const push = (node: React.ReactNode) =>
    setEntries((prev) => [...prev.slice(-60), { id: nextId++, node }]);
  const clear = () => setEntries([]);
  return { entries, push, clear };
}

function Banner({ version }: { version: string }) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} flexDirection="column">
      <Text bold color="cyan">pool-anything v{version} — API key pooler</Text>
      <Text dimColor>Type '.help' for commands, 'exit' to quit</Text>
    </Box>
  );
}

function PoolsView({ pools }: { pools: PoolRow[] }) {
  if (pools.length === 0) {
    return <Text dimColor>(no pools yet — try: create pool {"<name>"} for {"<provider>"})</Text>;
  }
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold>{pools.length} active pool{pools.length === 1 ? "" : "s"}</Text>
      {pools.map((p) => {
        const usage = p.quota === null
          ? `${fmtCompact(p.used)} tokens`
          : `${fmtCompact(p.used)} / ${fmtCompact(p.quota * p.keys)} tokens`;
        return (
          <Text key={p.id} dimColor={!p.active}>
            <Text color="yellow">#{p.id}</Text> <Text bold>{"\""}{p.name}{"\""}</Text>{" "}
            <Text color="cyan">({p.provider})</Text> — {p.keys} key{p.keys === 1 ? "" : "s"},{" "}
            {usage}{p.active ? "" : ", inactive"}
          </Text>
        );
      })}
    </Box>
  );
}

function ProvidersView() {
  return (
    <Box flexDirection="column">
      {PROVIDERS.map((p) => (
        <Text key={p.id}>
          <Text color="cyan">- {p.id}</Text> <Text dimColor>— {p.name} ({p.quota || "no quota"})</Text>
        </Text>
      ))}
    </Box>
  );
}

function KeysView({ pool, keys }: { pool: PoolRef; keys: { id: number; label: string; masked: string }[] }) {
  if (keys.length === 0) {
    return <Text dimColor>Pool #{pool.id} "{pool.name}" has no keys. Try: add keys to {pool.provider}.</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text bold>Keys in pool #{pool.id} "{pool.name}":</Text>
      {keys.map((k) => (
        <Text key={k.id}>  <Text color="yellow">#{k.id}</Text> {k.label} <Text dimColor>({k.masked})</Text></Text>
      ))}
      <Text dimColor>Keys are shown masked — raw values never print.</Text>
    </Box>
  );
}

function QuotaBar({ used, total }: { used: number; total: number }) {
  const width = 28;
  const filled = total <= 0 ? 0 : Math.min(width, Math.round((used / total) * width));
  return (
    <Text>
      <Text color="green">{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(width - filled)}</Text>
    </Text>
  );
}

function UsageView({ view, perKey }: { view: UsageViewData; perKey: { label: string; masked: string; used: number }[] }) {
  const total = view.quota === null ? null : view.quota * view.keys;
  const pct = total === null || total === 0 ? null : Math.round((view.used / total) * 100);
  return (
    <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
      <Text bold>Pool #{view.id}: {view.name} <Text color="cyan">({view.provider})</Text></Text>
      <Text>
        Used: <Text bold>{fmtFull(view.used)}</Text> tokens │ Quota: {total === null ? "unlimited" : fmtFull(total)} │ Remaining:{" "}
        {view.remaining === null ? "—" : fmtFull(view.remaining)}{pct !== null ? ` (${pct}% exhausted)` : ""}
      </Text>
      {total !== null && <QuotaBar used={view.used} total={total} />}
      <Text>
        Status: {view.cooling > 0 ? <Text color="yellow">{view.cooling} cooling</Text> : <Text color="green">OK</Text>} │ Keys:{" "}
        {view.keys} active, {view.cooling} cooling
      </Text>
      {perKey.map((k) => (
        <Text key={k.label}>  {k.label} <Text dimColor>({k.masked})</Text>: {fmtFull(k.used)} tok</Text>
      ))}
    </Box>
  );
}

function MessageView({ tone, text }: { tone: "ok" | "err" | "info"; text: string }) {
  const color = tone === "ok" ? "green" : tone === "err" ? "red" : undefined;
  const prefix = tone === "ok" ? "✓ " : tone === "err" ? "✗ " : "";
  return <Text color={color}>{prefix}{text}</Text>;
}

function WatchView({ pool, onDone }: { pool: PoolRef; onDone: () => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  useInput((_input, key) => {
    if (key.escape || _input === "q" || _input === "Q") onDone();
  }, { isActive: true });
  void tick;
  const st = liveStats(pool.id);
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold>🔄 Pool #{pool.id} "{pool.name}" — live usage <Text dimColor>[auto-refresh 2s, press q to exit]</Text></Text>
      <Text>
        Requests: <Text bold color="green">{st.reqMin}/min</Text> │ Tokens: <Text bold color="green">{st.tokMin}/min</Text> │ Avg latency:{" "}
        {st.avgLatency === null ? "—" : `${(st.avgLatency / 1000).toFixed(1)}s`}
      </Text>
      {st.perKey.map((k) => (
        <Text key={k.id}>  {k.label} <Text dimColor>({mask(k.apiKey)})</Text>: {fmtFull(k.used)} tok</Text>
      ))}
    </Box>
  );
}

function ResultView({ result }: { result: CmdResult }) {
  switch (result.kind) {
    case "message": return <MessageView tone={result.tone} text={result.text} />;
    case "pools": return <PoolsView pools={result.pools} />;
    case "providers": return <ProvidersView />;
    case "keys": return <KeysView pool={result.pool} keys={result.keys} />;
    case "usage": return <UsageView view={result.view} perKey={result.perKey} />;
    default: return null;
  }
}

type Mode =
  | { t: "normal" }
  | { t: "import"; pool: PoolRef; expected: number | null }
  | { t: "watch"; pool: PoolRef }
  | { t: "question"; prompt: string };

function Shell({ version }: { version: string }) {
  const app = useApp();
  const { entries, push, clear } = useTranscript();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [mode, setMode] = useState<Mode>({ t: "normal" });
  const [collected, setCollected] = useState(0);
  const importLines = useRef<string[]>([]);
  const questionResolve = useRef<((answer: string) => void) | null>(null);

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => {
      questionResolve.current = resolve;
      setMode({ t: "question", prompt: q });
    });

  const submitImportLine = (line: string) => {
    const st = mode;
    if (st.t !== "import") return;
    if (line.trim() === "" || line.trim() === ".done" || line === "\x04") {
      finishImport(st.pool);
      return;
    }
    importLines.current.push(line);
    setCollected(importLines.current.length);
    if (st.expected !== null && importLines.current.length >= st.expected) {
      finishImport(st.pool);
    }
  };

  const finishImport = (pool: PoolRef) => {
    const lines = importLines.current;
    importLines.current = [];
    setCollected(0);
    setMode({ t: "normal" });
    if (lines.length === 0) {
      push(<MessageView tone="info" text="No keys pasted — nothing added." />);
      return;
    }
    const { added, skipped } = insertKeys(pool, lines);
    push(
      <MessageView
        tone="ok"
        text={`Added ${added} key${added === 1 ? "" : "s"} to pool #${pool.id}${skipped > 0 ? ` (${skipped} skipped: blank/duplicate/invalid)` : ""}.`}
      />
    );
  };

  const runCommand = async (cmd: string) => {
    push(<Text><Text color="yellow" bold>❯ </Text><Text bold>{cmd}</Text></Text>);
    // `serve` boots a long-lived server that logs to stdout — exit the TUI
    // first (Ink owns the screen), then start the server after unmount.
    if (parse(cmd).kind === "serve") {
      push(<MessageView tone="ok" text={`Starting server on http://${HOST}:${PORT} …`} />);
      serveRequested = true;
      app.exit();
      return;
    }
    let r: CmdResult;
    try {
      r = await dispatch(cmd, ask);
    } catch (e) {
      push(<MessageView tone="err" text={`Error: ${(e as Error).message}`} />);
      return;
    }
    if (r.kind === "exit") {
      app.exit();
      return;
    }
    if (r.kind === "clear") {
      clear();
      return;
    }
    // A confirmed uninstall removes the binary — show the result, then leave
    // the shell instead of prompting on a dead install.
    if (parse(cmd).kind === "uninstall" && r.kind === "message" && r.tone === "ok") {
      push(<ResultView result={r} />);
      app.exit();
      return;
    }
    if (r.kind === "watch") {
      setMode({ t: "watch", pool: r.pool });
      return;
    }
    if (r.kind === "import") {
      importLines.current = [];
      setCollected(0);
      setMode({ t: "import", pool: r.pool, expected: r.expected });
      push(<MessageView tone="ok" text={`Opening key import mode for "${r.pool.name}" (pool #${r.pool.id})`} />);
      push(<Text dimColor>{r.hint}</Text>);
      return;
    }
    if (r.kind === "serve") {
      // Unreachable: serve is intercepted above so Ink unmounts before the
      // server (which logs to stdout) starts. Kept for exhaustiveness.
      push(<MessageView tone="ok" text={`Server on http://${HOST}:${PORT}`} />);
      return;
    }
    push(<ResultView result={r} />);
  };

  /** Submit one complete line from the prompt (shared by Return, pasted and cooked newlines). */
  const submitLine = (line: string) => {
    setInput("");
    setHistIdx(-1);
    if (mode.t === "question") {
      const resolve = questionResolve.current;
      questionResolve.current = null;
      setMode({ t: "normal" });
      push(<Text dimColor>{mode.prompt}{line}</Text>);
      resolve?.(line);
      return;
    }
    if (mode.t === "import") {
      submitImportLine(line);
      return;
    }
    if (line.trim() === "") return;
    setHistory((h) => [...h.slice(-99), line]);
    void runCommand(line);
  };

  useInput((ch, key) => {
    if (mode.t === "watch") return; // WatchView owns the keyboard.
    if (ch === "\x04") {
      // Ctrl+D: finish an import, or exit an empty prompt. (Before the
      // ctrl guard: Ink reports ctrl+d with key.ctrl set.)
      if (mode.t === "import") submitImportLine(ch);
      else if (input === "") app.exit();
      return;
    }
    if (ch && /[\r\n]/.test(ch)) {
      // Return, pasted newlines, or cooked-mode line delivery: every
      // complete segment is its own submit, the tail stays on the prompt.
      const segments = (input + ch).split(/[\r\n]/);
      const rest = segments.pop() ?? "";
      for (const seg of segments) submitLine(seg);
      setInput(rest);
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (history.length === 0) return;
      const next = key.upArrow
        ? (histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1))
        : (histIdx === -1 ? -1 : Math.min(history.length - 1, histIdx + 1));
      setHistIdx(next);
      setInput(next === -1 ? "" : history[next]!);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (key.ctrl && (ch === "u" || ch === "U")) {
      setInput("");
      return;
    }
    if (key.ctrl || key.meta || key.escape) return;
    if (ch) setInput((s) => s + ch);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner version={version} />
      <Box flexDirection="column" marginTop={1}>
        {entries.map((e) => (
          <Box key={e.id} marginBottom={0}>{e.node}</Box>
        ))}
      </Box>
      {mode.t === "watch" ? (
        <Box marginTop={1}>
          <WatchView pool={mode.pool} onDone={() => { setMode({ t: "normal" }); push(<Text dimColor>Stopped watching.</Text>); }} />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={mode.t === "import" ? "cyan" : "yellow"} bold>{mode.t === "import" ? "... " : mode.t === "question" ? "" : "❯ "}</Text>
          {mode.t === "question" ? (
            <Text>{mode.prompt}<Text bold>{input}</Text><Text inverse> </Text></Text>
          ) : (
            <Text><Text bold>{input}</Text><Text inverse> </Text></Text>
          )}
        </Box>
      )}
      {mode.t === "import" && (
        <Text dimColor>{collected} collected — empty line or Ctrl+D to finish</Text>
      )}
    </Box>
  );
}

export async function startTui(version: string): Promise<void> {
  const { waitUntilExit } = render(<Shell version={version} />);
  await waitUntilExit();
  if (serveRequested) {
    serveRequested = false;
    await import("../server.js");
    return;
  }
  console.log("Goodbye!");
}
