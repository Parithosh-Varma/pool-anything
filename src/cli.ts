#!/usr/bin/env node
/**
 * `pool-anything` — global CLI entrypoint.
 *
 * Parses a small set of flags, maps them onto the existing env config
 * (PORT / HOST / LOCAL_DB_PATH / POOL_DATA_DIR), then boots the server.
 * Env vars must be set *before* importing ./server.js because config is
 * evaluated at module load.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PACKAGE_ROOT } from "./config/paths.js";

type CliOptions = {
  port?: string;
  host?: string;
  db?: string;
  dataDir?: string;
  open: boolean;
  help: boolean;
  version: boolean;
  serve: boolean;
  exec?: string;
  command: string[];
};

function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function helpText(version: string): string {
  return `pool-anything v${version} — gather free-tier API keys into one pool, rotate through them.

Usage:
  pool-anything                  Interactive assistant shell (default when stdin is a TTY)
  pool-anything "<command>"      Run one assistant command, e.g. pool-anything "list pools"
  pool-anything serve [options]  Start the web UI + API server
  pool-anything [options]        Start the server (back-compat when flags are given)

Assistant commands (also inside the shell): list pools, list providers,
  list keys [for <pool>], show usage for <pool>, add [N] keys to <pool>,
  create pool <name> for <provider>, delete pool <name>, watch <pool>,
  next [for <pool>], consume <n> [on <pool>], serve, exit. Type '.help' in-shell.

Options (server):
  -p, --port <n>      Port for the web UI + API (default: 3000, or $PORT)
  -H, --host <addr>   Interface to bind (default: 127.0.0.1, or $HOST)
      --db <path>     SQLite file (default: ./data/*.db in a checkout,
                      ~/.pool-anything/*.db when installed globally;
                      or $LOCAL_DB_PATH)
      --data-dir <d>  Data directory holding the SQLite file (or $POOL_DATA_DIR)
      --open          Open the web UI in your browser on startup
  -e, --exec <cmd>    Run one assistant command and exit
      --serve         Start the server (same as 'pool-anything serve')
  -h, --help          Show this help
  -V, --version       Show version

Examples:
  pool-anything
  pool-anything "list pools"
  echo "gsk_abc" | pool-anything --exec "add keys to groq"
  pool-anything serve --port 4000 --open
  pool-anything --db ./my-pool.db
  PORT=4000 pool-anything

Open http://localhost:3000 once serving, search for a provider, and Gather keys.
`;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { open: false, help: false, version: false, serve: false, command: [] };
  let serverFlagSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-V" || a === "--version") opts.version = true;
    else if (a === "--open") { opts.open = true; serverFlagSeen = true; }
    else if (a === "--no-open") opts.open = false;
    else if (a === "--serve") opts.serve = true;
    else if (a === "-e" || a === "--exec") opts.exec = argv[++i] ?? "";
    else if (a.startsWith("--exec=")) opts.exec = a.slice("--exec=".length);
    else if (a === "-p" || a === "--port") { opts.port = argv[++i]; serverFlagSeen = true; }
    else if (a === "-H" || a === "--host") { opts.host = argv[++i]; serverFlagSeen = true; }
    else if (a === "--db") { opts.db = argv[++i]; serverFlagSeen = true; }
    else if (a === "--data-dir" || a === "--dataDir") { opts.dataDir = argv[++i]; serverFlagSeen = true; }
    else if (a.startsWith("--port=")) { opts.port = a.slice("--port=".length); serverFlagSeen = true; }
    else if (a.startsWith("--host=")) { opts.host = a.slice("--host=".length); serverFlagSeen = true; }
    else if (a.startsWith("--db=")) { opts.db = a.slice("--db=".length); serverFlagSeen = true; }
    else if (a.startsWith("--data-dir=")) { opts.dataDir = a.slice("--data-dir=".length); serverFlagSeen = true; }
    else if (a.startsWith("-p") && a.length > 2) { opts.port = a.slice(2); serverFlagSeen = true; }
    else if ((a === "serve" || a === "server" || a === "start") && i === 0) opts.serve = true;
    else if (!a.startsWith("-")) opts.command.push(a);
    else {
      console.error(`Unknown option: ${a}\n`);
      console.error(helpText(readVersion()));
      process.exit(1);
    }
  }
  // Any explicit server flag implies server mode (back-compat with v0.1.0,
  // where flags alone booted the server).
  if (serverFlagSeen) opts.serve = true;
  return opts;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : process.platform === "darwin" ? [url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    console.warn(`[warn] could not open browser: ${(e as Error).message}`);
  }
}

const opts = parseArgs(process.argv.slice(2));
const version = readVersion();

if (opts.help) {
  console.log(helpText(version));
  process.exit(0);
}
if (opts.version) {
  console.log(version);
  process.exit(0);
}

if (opts.port !== undefined) {
  if (!/^\d+$/.test(opts.port) || Number(opts.port) < 1 || Number(opts.port) > 65535) {
    console.error(`Invalid --port: ${opts.port} (must be 1-65535)`);
    process.exit(1);
  }
  process.env.PORT = opts.port;
}
if (opts.host !== undefined) {
  if (!opts.host) {
    console.error("Invalid --host: must be non-empty");
    process.exit(1);
  }
  process.env.HOST = opts.host;
}
if (opts.db !== undefined) {
  if (!opts.db) {
    console.error("Invalid --db: must be a path");
    process.exit(1);
  }
  process.env.LOCAL_DB_PATH = opts.db;
}
if (opts.dataDir !== undefined) {
  if (!opts.dataDir) {
    console.error("Invalid --data-dir: must be a path");
    process.exit(1);
  }
  process.env.POOL_DATA_DIR = opts.dataDir;
}

if (opts.open) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ?? "3000";
  const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  setTimeout(() => openBrowser(`http://${displayHost}:${port}`), 800);
}

const oneShot = opts.exec ?? (opts.command.length > 0 ? opts.command.join(" ") : "");
if (!opts.serve && oneShot) {
  const { execOnce } = await import("./cli/repl.js");
  process.exit(await execOnce(oneShot));
}

if (!opts.serve && process.stdin.isTTY && process.stdout.isTTY) {
  try {
    const { startTui } = await import("./cli/tui.js");
    await startTui(version);
  } catch (e) {
    console.error(`[warn] rich shell unavailable (${(e as Error).message}), falling back to plain mode.`);
    const { startRepl } = await import("./cli/repl.js");
    await startRepl(version);
  }
  process.exit(0);
}

await import("./server.js");
