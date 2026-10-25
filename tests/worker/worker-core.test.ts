import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { bytesToBase64, utf8ToBase64, utf8Length } from "../../src/shared/base64.js";
import { loadProviders, mapProvider } from "../../src/shared/providers.js";
import { buildUpstreamRequest, validateQueryParams } from "../../src/shared/upstream.js";
import { checkTarget, isPrivateLiteral, validateProxyOpts } from "../../src/shared/proxy-rules.js";
import { pickForCursor } from "../../worker/src/db.js";
import { corsHeaders, isAllowedOrigin, isAuthorized, requiresAuth } from "../../worker/src/http.js";
import { defaultStrategy, rotationOptions } from "../../worker/src/strategy-config.js";
import type { Env } from "../../worker/src/env.js";

const providers = loadProviders(
  JSON.parse(fs.readFileSync(new URL("../../data/providers.json", import.meta.url), "utf8")) as unknown
);

const env = { DB: {} as never, ALLOWED_ORIGINS: "" } as Env;

test("worker: base64 matches Buffer for every remainder", () => {
  for (const n of [0, 1, 2, 3, 4, 5, 9, 100, 8190, 8191, 20000]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"), `length ${n}`);
  }
});

test("worker: Basic auth encoding matches Buffer utf8 base64", () => {
  assert.equal(utf8ToBase64("api:sk-⌘"), Buffer.from("api:sk-⌘", "utf8").toString("base64"));
  assert.equal(utf8Length("⌘"), Buffer.byteLength("⌘", "utf8"));
});

test("worker: bundled provider registry matches the Node registry", () => {
  assert.ok(providers.length > 20);
  const ids = providers.map((p) => p.id);
  for (const id of ["cartesia", "groq", "custom", "twilio", "supabase"]) assert.ok(ids.includes(id), id);
  assert.equal(providers.find((p) => p.id === "cartesia")?.logoFile, "cartesia.svg");
  assert.deepEqual(providers.find((p) => p.id === "twilio")?.keyFields, ["accountSid", "authToken"]);
  assert.equal(providers.find((p) => p.id === "cloudflare")?.poolable, false);
  assert.equal(mapProvider({ id: "x" } as Record<string, unknown>), null);
});

test("worker: upstream builder injects bearer + query auth", () => {
  const bearer = buildUpstreamRequest(
    { baseUrl: "https://api.groq.com/openai/v1", keyHeader: "Authorization", keyPrefix: "Bearer ", extraHeaders: {} },
    "gsk-abc",
    { path: "/models", method: "GET" }
  );
  assert.equal(bearer.url, "https://api.groq.com/openai/v1/models");
  assert.equal(bearer.headers["Authorization"], "Bearer gsk-abc");

  const query = buildUpstreamRequest(
    { baseUrl: "https://api.mapbox.com", keyHeader: "query:access_token", keyPrefix: "", extraHeaders: {} },
    "pk.x",
    { path: "/geo?q=paris", method: "GET" }
  );
  assert.equal(query.url, "https://api.mapbox.com/geo?q=paris&access_token=pk.x");
  assert.ok(!("access_token" in query.headers));
});

test("worker: proxy caps accept media-sized bodies and reject beyond", () => {
  const caps = { maxBodyBytes: 6_000_000, maxTokens: 1_000_000 };
  assert.equal(validateProxyOpts({ path: "/v1/chat", body: { prompt: "hi" } }, caps).ok, true);
  const tooBig = validateProxyOpts({ path: "/v1/tts", body: { audio: "a".repeat(6_000_100) } }, caps);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error ?? "", /too large/);
  assert.equal(validateProxyOpts({ path: "/v1", tokens: 1_000_001 }, caps).ok, false);
  assert.equal(validateProxyOpts({ path: "no-slash" }, caps).ok, false);
});

test("worker: SSRF rules match the Node server", () => {
  assert.equal(isPrivateLiteral("127.0.0.1"), true);
  assert.equal(isPrivateLiteral("169.254.169.254"), true);
  assert.equal(isPrivateLiteral("[::1]"), true);
  assert.equal(isPrivateLiteral("api.groq.com"), false);
  assert.equal(checkTarget("http://api.example.com", "X-API-Key", false).ok, false);
  assert.equal(checkTarget("https://127.0.0.1", "X-API-Key", false).ok, false);
  assert.equal(checkTarget("https://api.example.com", "X-API-Key", false).ok, true);
  assert.equal(checkTarget("http://127.0.0.1:9000", "X-API-Key", true).ok, true);
});

test("worker: round-robin cursor wraps and tolerates bad cursors", () => {
  const keys = ["a", "b", "c"];
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => pickForCursor(keys, c)), ["a", "b", "c", "a", "b"]);
  assert.equal(pickForCursor([], 3), undefined);
  assert.equal(pickForCursor(keys, -1), "a");
});

test("worker: CORS only reflects allowlisted origins", () => {
  const pages = "https://pool-anything-tools.pages.dev";
  const req = (origin: string) => new Request("https://pool.example/api/pools", { headers: { origin } });
  assert.equal(corsHeaders(req(pages), env)["access-control-allow-origin"], pages);
  assert.equal(corsHeaders(req("http://localhost:3000"), env)["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(corsHeaders(req("https://evil.example"), env)["access-control-allow-origin"], undefined);
  assert.equal(isAllowedOrigin("https://localhost:3000", env), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8080", env), true);
});

test("worker: auth gates raw keys, writes, rotation, and call history", () => {
  assert.equal(requiresAuth("GET", "/api/pools/1/keys/2"), true);
  assert.equal(requiresAuth("GET", "/api/pools/1/keys"), false);
  assert.equal(requiresAuth("GET", "/api/pools/1/next"), true);
  assert.equal(requiresAuth("GET", "/api/pools/1/usage"), false);
  assert.equal(requiresAuth("POST", "/api/pools/1/proxy"), true);
  assert.equal(requiresAuth("POST", "/api/pools/1/consume"), true);
  assert.equal(requiresAuth("POST", "/proxy/1"), true);
  assert.equal(requiresAuth("GET", "/api/pools/1/calls"), true);
  assert.equal(requiresAuth("GET", "/health"), false);

  const authed = { DB: {} as never, POOL_API_TOKEN: "secret-token-123456" } as Env;
  const ok = new Request("https://x/api/pools", { method: "POST", headers: { authorization: "Bearer secret-token-123456" } });
  const bad = new Request("https://x/api/pools", { method: "POST", headers: { authorization: "Bearer nope" } });
  assert.equal(isAuthorized(ok, authed), true);
  assert.equal(isAuthorized(bad, authed), false);
  assert.equal(isAuthorized(bad, env), true);
});

test("worker: query validation is shared with Node", () => {
  assert.equal(validateQueryParams({ select: "*" }).ok, true);
  assert.equal(validateQueryParams({ "bad key": "x" }).ok, false);
  assert.equal(validateQueryParams({ ok: "line\nbreak" }).ok, false);
});

test("worker: rotation env falls back safely and merges options", () => {
  assert.equal(defaultStrategy({} as Env), "round-robin");
  assert.equal(defaultStrategy({ POOL_ROTATION_STRATEGY: "sticky" } as Env), "sticky");
  assert.equal(defaultStrategy({ POOL_ROTATION_STRATEGY: "nope" } as Env), "round-robin");
  const opts = rotationOptions({ POOL_ROTATION_OPTIONS: '{"time-based":{"everyN":7}}' } as Env);
  assert.equal(opts["time-based"]?.everyN, 7);
  assert.equal(opts["health-aware"]?.breakerAfter, 5);
});
