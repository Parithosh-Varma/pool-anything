// Watch daemon: keeps the Cloudflare Pages tools UI in sync with src/admin.
//
// Watches the UI sources; on change it re-exports tools-site/ and redeploys
// to the pool-anything-tools Pages project. Run: npm run tools:daemon
// Set TOOLS_NO_DEPLOY=1 to re-export without deploying (dry run).
import { watch, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT = "pool-anything-tools";
const WATCH_PATHS = [
  "src/admin",
  "src/logo.png",
  "src/server.ts",
  "public/logos",
  "data/providers.json",
  "scripts/tools-api-base.js",
  "scripts/export-tools-ui.ts",
];
const DEBOUNCE_MS = 2000;

function run(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
}

let timer: NodeJS.Timeout | null = null;
let busy = false;
let queued = false;

function sync(reason: string): void {
  console.log(`[tools-daemon] change detected (${reason}), syncing…`);
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  const okExport = run("npm", ["run", "export:tools"]);
  if (okExport && process.env.TOOLS_NO_DEPLOY !== "1") {
    run("npx", ["wrangler", "pages", "deploy", "tools-site", "--project-name", PROJECT]);
  }
  busy = false;
  if (queued) {
    queued = false;
    sync("queued change");
  } else {
    console.log("[tools-daemon] watching…");
  }
}

for (const p of WATCH_PATHS) {
  // fs.watch(recursive:true) only works on macOS/Windows. On Linux it throws,
  // which previously left the daemon silently watching nothing — so watch
  // each directory level explicitly (portable) and fail loudly when nothing
  // could be watched.
  const targets: string[] = [p];
  try {
    if (statSync(p).isDirectory() && process.platform !== "darwin" && process.platform !== "win32") {
      const walk = (dir: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          const sub = path.join(dir, e.name);
          targets.push(sub);
          walk(sub);
        }
      };
      walk(p);
    }
  } catch {
    // Missing path: let watch() below report it.
  }
  let watched = 0;
  for (const t of targets) {
    try {
      const recursive = process.platform === "darwin" || process.platform === "win32";
      // On macOS/Windows the top-level recursive watch covers subdirs.
      if (recursive && t !== p) break;
      watch(t, { recursive }, (_event, file) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => sync(file ? `${t}/${file}` : t), DEBOUNCE_MS);
      });
      watched++;
    } catch (e) {
      console.warn(`[tools-daemon] cannot watch ${t}: ${(e as Error).message}`);
    }
  }
  if (watched > 0) console.log(`[tools-daemon] watching ${p}${watched > 1 ? ` (+${watched - 1} subdirs)` : ""}`);
  else console.warn(`[tools-daemon] WARNING: nothing watched for ${p} — changes there will NOT redeploy`);
}
console.log("[tools-daemon] ready. Edit src/admin/* and the Pages site updates on save.");
