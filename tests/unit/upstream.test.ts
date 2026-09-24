import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-upstream.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { buildUpstreamRequest } = await import("../../src/upstream/index.js");
const { checkTarget } = await import("../../src/proxy/forward.js");

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
