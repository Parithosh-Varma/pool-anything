import test from "node:test";
import assert from "node:assert/strict";

const OLD = { ...process.env };

// env.ts has no side effects: safe to import directly.
const env = await import("../../src/config/env.js");

test("proxyTimeoutMs falls back on bad input", () => {
  process.env.PROXY_TIMEOUT_MS = "abc";
  assert.equal(env.proxyTimeoutMs(), 30000);
  process.env.PROXY_TIMEOUT_MS = "0";
  assert.equal(env.proxyTimeoutMs(), 30000);
  process.env.PROXY_TIMEOUT_MS = "-5";
  assert.equal(env.proxyTimeoutMs(), 30000);
  process.env.PROXY_TIMEOUT_MS = "1500";
  assert.equal(env.proxyTimeoutMs(), 1500);
  delete process.env.PROXY_TIMEOUT_MS;
  assert.equal(env.proxyTimeoutMs(), 30000);
});

test("allowPrivateUpstream defaults to closed", () => {
  delete process.env.ALLOW_PRIVATE_UPSTREAM;
  assert.equal(env.allowPrivateUpstream(), false);
  process.env.ALLOW_PRIVATE_UPSTREAM = "1";
  assert.equal(env.allowPrivateUpstream(), true);
  process.env.ALLOW_PRIVATE_UPSTREAM = "yes";
  assert.equal(env.allowPrivateUpstream(), false);
});

test("HOST defaults to loopback", () => {
  assert.equal(env.HOST, "127.0.0.1");
});

test("startupWarnings flags insecure config", () => {
  delete process.env.ALLOW_PRIVATE_UPSTREAM;
  assert.deepEqual(env.startupWarnings(), []);
  process.env.ALLOW_PRIVATE_UPSTREAM = "1";
  assert.ok(env.startupWarnings().some((w) => w.includes("ALLOW_PRIVATE_UPSTREAM")));
});

test.after(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, OLD);
});
