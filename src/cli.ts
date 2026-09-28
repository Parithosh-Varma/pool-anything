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
  pool-anything [options]

Options:
  -p, --port <n>      Port for the web UI + API (default: 3000, or $PORT)
  -H, --host <addr>   Interface to bind (default: 127.0.0.1, or $HOST)
      --db <path>     SQLite file (default: ./data/*.db in a checkout,
                      ~/.pool-anything/*.db when installed globally;
                      or $LOCAL_DB_PATH)
      --data-dir <d>  Data directory holding the SQLite file (or $POOL_DATA_DIR)
      --open          Open the web UI in your browser on startup
  -h, --help          Show this help
  -V, --version       Show version

Examples:
  pool-anything
  pool-anything --port 4000 --open
  pool-anything --db ./my-pool.db
  PORT=4000 pool-anything

Open http://localhost:3000 once running, search for a provider, and Gather keys.
`;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { open: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-V" || a === "--version") opts.version = true;
    else if (a === "--open") opts.open = true;
    else if (a === "--no-open") opts.open = false;
    else if (a === "-p" || a === "--port") opts.port = argv[++i];
    else if (a === "-H" || a === "--host") opts.host = argv[++i];
    else if (a === "--db") opts.db = argv[++i];
    else if (a === "--data-dir" || a === "--dataDir") opts.dataDir = argv[++i];
    else if (a.startsWith("--port=")) opts.port = a.slice("--port=".length);
    else if (a.startsWith("--host=")) opts.host = a.slice("--host=".length);
    else if (a.startsWith("--db=")) opts.db = a.slice("--db=".length);
    else if (a.startsWith("--data-dir=")) opts.dataDir = a.slice("--data-dir=".length);
    else if (a.startsWith("-p") && a.length > 2) opts.port = a.slice(2);
    else {
      console.error(`Unknown option: ${a}\n`);
      console.error(helpText(readVersion()));
      process.exit(1);
    }
  }
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

await import("./server.js");
