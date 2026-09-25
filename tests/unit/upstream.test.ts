import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-upstream.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { buildUpstreamRequest } = await import("../../src/upstream/index.js");
const { checkTarget, validateProxyOpts } = await import("../../src/proxy/forward.js");

test("bearer header inject", () => {
  const r = buildUpstreamRequest(
    { baseUrl: "https://api.groq.com/openai/v1", keyHeader: "Authorization", keyPrefix: "Bearer ", extraHeaders: {} },
    "gsk-abc",
    { path: "/models", method: "GET" }
  );
  assert.equal(r.url, "https://api.groq.com/openai/v1/models");
  assert.equal(r.headers["Authorization"], "Bearer gsk-abc");
  assert.equal(r.body, undefined);
});

test("query param inject appends with & when path has ?", () => {
  const r = buildUpstreamRequest(
    { baseUrl: "https://api.mapbox.com", keyHeader: "query:access_token", keyPrefix: "", extraHeaders: {} },
    "pk.x",
    { path: "/geo?q=paris", method: "GET" }
  );
  assert.equal(r.url, "https://api.mapbox.com/geo?q=paris&access_token=pk.x");
  assert.ok(!("access_token" in r.headers));
});

test("leading slash fixed, body stringified, extra headers merged", () => {
  const r = buildUpstreamRequest(
    { baseUrl: "https://api.cartesia.ai", keyHeader: "X-API-Key", keyPrefix: "", extraHeaders: { "Cartesia-Version": "2024-06-10" } },
    "sk-1",
    { path: "tts/bytes", body: { a: 1 } }
  );
  assert.equal(r.url, "https://api.cartesia.ai/tts/bytes");
  assert.equal(r.headers["X-API-Key"], "sk-1");
  assert.equal(r.headers["Cartesia-Version"], "2024-06-10");
  assert.equal(r.body, '{"a":1}');
});

test("ssrf guard blocks private hosts, allows public https", () => {
  assert.equal(checkTarget("http://127.0.0.1:1", "X-API-Key").ok, false);
  assert.equal(checkTarget("https://api.groq.com/openai/v1", "Authorization").ok, true);
  assert.equal(checkTarget("https://x.test", "bad header!").ok, false);
  assert.equal(checkTarget("https://x.test", "query:token").ok, true);
});

test("ssrf guard blocks non-canonical IP literals", () => {
  const blocked = [
    "http://[::1]/x", // bracketed IPv6 loopback: hostname keeps brackets
    "http://[::ffff:127.0.0.1]/x", // mapped loopback
    "http://[0:0:0:0:0:ffff:127.0.0.1]/x", // full-form mapped loopback
    "https://2130706433/x", // decimal 127.0.0.1
    "https://0x7f.0.0.1/x", // hex-mixed 127.0.0.1
    "https://0177.0.0.1/x", // octal 127.0.0.1
    "https://127.1/x", // short form 127.0.0.1
    "https://0.0.0.0/x",
    "https://10.1.2.3/x",
    "https://172.16.0.1/x",
    "https://172.31.255.255/x",
    "https://192.168.0.1/x",
    "https://169.254.169.254/x", // cloud metadata
    "https://localhost/x",
    "https://x.localhost/x",
    "http://api.groq.com/x", // http rejected when the hatch is closed
  ];
  for (const url of blocked) {
    assert.equal(checkTarget(url, "X-API-Key").ok, false, url);
  }
  assert.equal(checkTarget("https://172.15.255.255/x", "X-API-Key").ok, true);
  assert.equal(checkTarget("https://172.32.0.1/x", "X-API-Key").ok, true);
});

test("validateProxyOpts rejects bad input before keys are touched", () => {
  assert.equal(validateProxyOpts({ path: "/ok" }).ok, true);
  assert.equal(validateProxyOpts({}).ok, true);
  for (const bad of [
    { path: "no-leading-slash" },
    { path: "/has space" },
    { path: "/has\nnewline" },
    { path: "/x".padEnd(2001, "y") },
    { path: 42 },
    { method: "TRACE" },
    { method: "GROQ" },
    { headers: { "X-A": "bad\r\ninjected: 1" } },
    { headers: { "bad name!": "v" } },
    { headers: { ["x".repeat(257)]: "v" } },
    { headers: { "": "v" } },
    { headers: { "ok": 42 } },
    { tokens: 0 },
    { tokens: -5 },
    { tokens: 1.5 },
    { tokens: 1_000_001 },
  ]) {
    assert.equal(validateProxyOpts(bad as never).ok, false, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(validateProxyOpts({ tokens: 1_000_000 }).ok, true);
});
