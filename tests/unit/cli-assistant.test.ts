import test from "node:test";
import assert from "node:assert/strict";
import { parse, suggest } from "../../src/cli/nl.js";
import { fmtCompact, fmtFull, poolsBox, usageBlock, banner, helpBox } from "../../src/cli/ui.js";

test("parse: list pools variants", () => {
  assert.equal(parse("list pools").kind, "list-pools");
  assert.equal(parse("  LIST POOLS?").kind, "list-pools");
  assert.equal(parse("show my pools").kind, "list-pools");
  assert.equal(parse("ls").kind, "list-pools");
});

test("parse: vision examples", () => {
  const add = parse("add 5 keys to groq pool");
  assert.equal(add.kind, "add-keys");
  if (add.kind === "add-keys") {
    assert.equal(add.count, 5);
    assert.equal(add.ref, "groq");
  }
  const usage = parse("show usage for groq");
  assert.equal(usage.kind, "usage");
  if (usage.kind === "usage") assert.equal(usage.ref, "groq");
  const watch = parse("watch groq");
  assert.equal(watch.kind, "watch");
  if (watch.kind === "watch") assert.equal(watch.ref, "groq");
  assert.equal(parse("exit").kind, "exit");
  assert.equal(parse(".help").kind, "help");
});

test("parse: pool management intents", () => {
  const create = parse("create pool Prod Groq for groq");
  assert.deepEqual(create, { kind: "create-pool", name: "Prod Groq", provider: "groq" });
  const del = parse("delete pool 3");
  assert.deepEqual(del, { kind: "delete-pool", ref: "3" });
  const consume = parse("consume 100 on groq");
  assert.deepEqual(consume, { kind: "consume", tokens: 100, ref: "groq" });
  assert.equal(parse("serve").kind, "serve");
  assert.equal(parse("list keys for groq").kind, "list-keys");
  assert.equal(parse("next for groq").kind, "next");
});

test("parse: unknown + suggest", () => {
  assert.equal(parse("lst pools").kind, "unknown");
  assert.ok((suggest("lst pools") ?? "").includes("list pools"));
  assert.equal(parse("").kind, "unknown");
  assert.equal(suggest(""), null);
});

test("ui: number formatting", () => {
  assert.equal(fmtCompact(999), "999");
  assert.equal(fmtCompact(12400), "12.4k");
  assert.equal(fmtCompact(28800), "28.8k");
  assert.equal(fmtCompact(2000000), "2M");
  assert.equal(fmtFull(12450), "12,450");
});

test("ui: pools box + usage block render", () => {
  const box = poolsBox([
    { id: 1, name: "Prod Groq", provider: "groq", keys: 2, used: 12400, quota: null, active: true },
    { id: 3, name: "Test OpenAI", provider: "openai", keys: 1, used: 0, quota: null, active: false },
  ]);
  assert.ok(box.includes('#1 "Prod Groq" (groq) — 2 keys'));
  assert.ok(box.includes("inactive"));
  const usage = usageBlock({ id: 1, name: "Prod Groq", provider: "groq", used: 12450, quota: null, remaining: null, keys: 2, cooling: 0 });
  assert.ok(usage.includes("Pool #1: Prod Groq"));
  assert.ok(usage.includes("12,450 tokens"));
  assert.ok(banner("0.1.0").includes("pool-anything v0.1.0"));
  assert.ok(helpBox().includes("watch <pool>"));
});

test("ui: empty pools hint", () => {
  assert.ok(poolsBox([]).includes("create pool"));
});
