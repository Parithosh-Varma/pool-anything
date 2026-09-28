// Static export of the main tools UI for Cloudflare Pages.
//
// Reads the server-rendered admin pages (same source as localhost:3000) and
// writes them as plain .html files under tools-site/, plus:
//   - api-base.js   backend shim (configurable API base + token, see that file)
//   - logos/, logo.png
//   - _redirects    maps /provider/:id to the provider shell (SPA-style route)
//   - _headers      cache policy for static assets
//
// Usage: npm run export:tools
// Deploy: npx wrangler pages deploy tools-site --project-name pool-anything-tools
import fs from "node:fs";
import path from "node:path";
import { page, keysPage, poolsPage, analyticsPage, historyPage, playgroundPage, providerPage } from "../src/admin/pages.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tools-site");
const SHIM = path.join(ROOT, "scripts", "tools-api-base.js");

// Inject the shim synchronously in <head> (before inline scripts run) and
// rewrite playground snippet URLs so they display the configured backend.
// Matches single/double/backtick quotes and optional whitespace around `+`
// so future snippet edits don't silently miss the rewrite (runtime fetch
// calls need no rewrite: tools-api-base.js patches fetch for /api/*).
function withShim(html: string): string {
  let out = html.replace(/location\.origin\s*\+\s*(['"`])\/api/g, "(window.__API_BASE__||location.origin)+$1/api");
  if (out.includes("<head>")) {
    out = out.replace("<head>", "<head>\n<script src=\"/api-base.js\"></script>");
  } else {
    out = out.replace("</head>", "<script src=\"/api-base.js\"></script>\n</head>");
  }
  return out;
}

function write(rel: string, content: string): void {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

write("index.html", withShim(page));
write("keys/index.html", withShim(keysPage()));
write("pools/index.html", withShim(poolsPage()));
write("analytics/index.html", withShim(analyticsPage()));
write("history/index.html", withShim(historyPage()));
write("playground/index.html", withShim(playgroundPage()));
// Provider shell reads its id from location.pathname at runtime, so one copy
// per known provider gives fully static /provider/:id routes with no rewrites.
// _redirects stays as the catch-all for unknown ids.
const providerShell = withShim(providerPage());
write("provider/index.html", providerShell);
try {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "providers.json"), "utf8")) as { id?: string }[];
  const ids = [...new Set(registry.map((p) => p.id).filter((id): id is string => typeof id === "string" && /^[a-z0-9-]+$/.test(id)))];
  for (const id of ids) write(`provider/${id}/index.html`, providerShell);
  console.log(`provider routes: ${ids.length}`);
} catch (e) {
  console.warn("provider pre-render skipped:", (e as Error).message);
}

fs.copyFileSync(SHIM, path.join(OUT, "api-base.js"));
fs.copyFileSync(path.join(ROOT, "src", "logo.png"), path.join(OUT, "logo.png"));
fs.cpSync(path.join(ROOT, "public", "logos"), path.join(OUT, "logos"), { recursive: true });

write("_redirects", "/provider/* /provider/index.html 200\n");
write(
  "_headers",
  "/logos/*\n  Cache-Control: public, max-age=3600\n/logo.png\n  Cache-Control: public, max-age=3600\n/api-base.js\n  Cache-Control: public, max-age=600\n"
);

const files: string[] = [];
const walk = (dir: string): void => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(OUT, p));
  }
};
walk(OUT);
console.log(`tools-site: ${files.length} files`);
for (const f of files.sort()) console.log(`  ${f}`);
