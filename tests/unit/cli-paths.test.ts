import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const OLD = { ...process.env };

// paths.ts has no side effects (no DB connection): safe to import directly.
const paths = await import("../../src/config/paths.js");

test("providersJsonPath resolves to a real bundled file", () => {
  const p = paths.providersJsonPath();
  assert.ok(fs.existsSync(p), `expected providers.json at ${p}`);
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown[];
  assert.ok(Array.isArray(raw) && raw.length > 30, "expected 30+ bundled providers");
});

test("logoPngPath resolves to a real bundled logo", () => {
  assert.ok(fs.existsSync(paths.logoPngPath()), `missing logo at ${paths.logoPngPath()}`);
});

test("resolveDbPath honors LOCAL_DB_PATH first", () => {
  process.env.LOCAL_DB_PATH = "/tmp/custom-pool.db";
  process.env.POOL_DATA_DIR = "/tmp/should-be-ignored";
  assert.equal(paths.resolveDbPath(), "/tmp/custom-pool.db");
});

test("resolveDbPath falls back to POOL_DATA_DIR", () => {
  delete process.env.LOCAL_DB_PATH;
  process.env.POOL_DATA_DIR = "/tmp/pool-data-dir";
  assert.equal(paths.resolveDbPath(), "/tmp/pool-data-dir/pool-anything.db");
});

test("resolveDbPath defaults to checkout-local db in a source tree", () => {
  delete process.env.LOCAL_DB_PATH;
  delete process.env.POOL_DATA_DIR;
  // Tests run from the repo root, which is a source checkout.
  assert.ok(paths.resolveDbPath().endsWith("data/pool-anything.db"));
});

test.after(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, OLD);
});
