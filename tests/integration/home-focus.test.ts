import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

// Regression test for the home-page search focus-ring bug:
// fresh page load must NOT render a focus/active ring on the search bar,
// and Browse-all categories must stay collapsed until the user interacts.
// History: fixed once (no autofocus, :focus-within-gated ring, collapsed
// categories); this pins that behavior so a later merge, shared-layout
// refactor, or global style cannot silently reintroduce it.

const PORT = "4568";
const BASE = `http://127.0.0.1:${PORT}`;

process.env.LOCAL_DB_PATH = new URL("./tmp-home-focus.db", import.meta.url).pathname;
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

async function homeHtml(): Promise<string> {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  return r.text();
}

test("search input has no autofocus and no load-time focus", async () => {
  const html = await homeHtml();
  assert.match(html, /id="search"/, "search input exists");
  assert.doesNotMatch(html, /autofocus/i, "no autofocus attribute anywhere");
  // The only programmatic focus on the home page is the explicit Cmd/Ctrl+K
  // shortcut handler — nothing may steal focus on page load.
  const focusCalls = html.match(/\.focus\(\)/g) || [];
  assert.equal(focusCalls.length, 1, `expected exactly one .focus() (Cmd+K), found ${focusCalls.length}`);
  assert.match(html, /metaKey.*ctrlKey.*key.*k/i, "the single .focus() belongs to the Cmd/Ctrl+K handler");
});

test("no focus ring on search: neutral border only, never a shadow ring", async () => {
  const html = await homeHtml();
  // Explicit choice: no accent/shadow ring anywhere on the search wrappers,
  // in any state (default or focused). The only focus affordance is the
  // neutral border-color change on .search-card:focus-within.
  const rules = [...html.matchAll(/\.(search-box|search-card)([^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 0, "search styles present");
  for (const [, base, selector, body] of rules) {
    const m = body.match(/box-shadow\s*:\s*([^;]+);?/);
    if (!m) continue;
    assert.equal(
      m[1].trim(),
      "none",
      `no shadow ring allowed, found "${m[1].trim()}" on ".${base}${selector}"`
    );
  }
  // No accent ring token on search selectors at all.
  for (const [, base, selector, body] of rules) {
    assert.doesNotMatch(
      body,
      /var\(--accent\)/,
      `no accent ring allowed on ".${base}${selector}"`
    );
  }
  // Focus still flips the card border to the neutral faint tone (not a ring).
  assert.match(
    html,
    /\.search-card:focus-within\s*\{[^}]*border-color:\s*var\(--ink-faint\)/,
    "focus uses the neutral border, not a ring"
  );
});

test("browse-all and categories render collapsed by default", async () => {
  const html = await homeHtml();
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/, "no pre-opened <details> in initial HTML");
  assert.match(html, /browseAll\.open\s*=\s*false/, "browse-all defaults to closed");
  assert.doesNotMatch(html, /browseAll\.open\s*=\s*connectedIds/, "no connected-count auto-open");
  // Every browseAll.open = true must be gated on explicit user intent:
  // typing in search (if (v)) or an explicit /#browseAll deep-link.
  // Anything else (viewport heuristics, connected counts, unconditional)
  // would silently reintroduce auto-expand on fresh load.
  for (const m of html.matchAll(/browseAll\.open\s*=\s*true/g)) {
    const ctx = html.slice(Math.max(0, m.index - 200), m.index);
    assert.ok(
      ctx.includes("location.hash") || ctx.includes("if (v)"),
      "browse-all may only open on typing or #browseAll deep-link"
    );
  }
  assert.ok(
    html.includes("det.open = Boolean(f)") || /det\.open\s*=\s*false/.test(html),
    "category details default to closed (open only while filtering)"
  );
  assert.doesNotMatch(html, /det\.open\s*=\s*!window\.matchMedia/, "no viewport-based default-open");
});
