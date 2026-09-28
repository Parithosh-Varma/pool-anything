import test from "node:test";
import assert from "node:assert/strict";

// Every admin page embeds inline <script> blocks; a single bad token kills
// the whole page script (nothing renders, no error shown). Compile-check all
// of them: new Function parses without executing (no DOM needed).
const { page, keysPage, poolsPage, analyticsPage, historyPage, playgroundPage, providerPage } = await import(
  "../../src/admin/pages.js"
);

test("all admin pages: inline scripts parse without syntax errors", () => {
  const pages: Record<string, string> = {
    home: page,
    keys: keysPage(),
    pools: poolsPage(),
    analytics: analyticsPage(),
    history: historyPage(),
    playground: playgroundPage(),
    provider: providerPage(),
  };
  for (const [name, html] of Object.entries(pages)) {
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(blocks.length >= 1, `${name}: expected inline scripts`);
    for (const code of blocks) {
      assert.doesNotThrow(() => new Function(code), `${name}: inline script must parse`);
    }
  }
});
