import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

const PORT = "4567";
const BASE = `http://127.0.0.1:${PORT}`;
const DOCS_URL = "https://pool-anything.pages.dev/docs";

process.env.LOCAL_DB_PATH = new URL("./tmp-pages.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}

let child: ChildProcess;
test.before(async () => {
  child = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, PORT, HOST: "127.0.0.1", LOCAL_DB_PATH: process.env.LOCAL_DB_PATH },
    stdio: "ignore",
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    if (Date.now() > deadline) throw new Error("server did not start in time");
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.after(() => {
  child?.kill("SIGTERM");
});

test("GET /analytics serves the dashboard page", async () => {
  const r = await fetch(`${BASE}/analytics`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<title>Analytics — pool-anything<\/title>/);
  assert.match(html, /id="chartRequests"/);
  assert.match(html, /id="anaRefresh"/);
  assert.match(html, /<a class="mi active" href="\/analytics">/);
});

test("GET /docs redirects to the canonical Cloudflare docs", async () => {
  const r = await fetch(`${BASE}/docs`, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), DOCS_URL);
});

test("sidebars link Docs out and Analytics in", async () => {
  for (const path of ["/", "/pools", "/keys", "/analytics"]) {
    const html = await (await fetch(`${BASE}${path}`)).text();
    assert.match(html, new RegExp(`href="${DOCS_URL}" target="_blank"`), `${path} docs link`);
    assert.match(html, /href="\/analytics"/, `${path} analytics link`);
    assert.match(html, /<svg width="18" height="18" viewBox="0 0 24 24"/, `${path} svg icons`);
  }
});
