import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-adapters.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}

const { ADAPTERS } = await import("../../src/playground/adapters.js");
const { PROVIDERS } = await import("../../src/pool/index.js");
const { playgroundPage } = await import("../../src/admin/pages.js");

test("every provider id has a playground adapter", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.ok(ids.length >= 30, `expected 30+ providers, got ${ids.length}`);
  for (const id of ids) {
    assert.ok(ADAPTERS[id], `missing adapter for provider ${id}`);
  }
});

test("chat adapters carry a path, style, and text paths", () => {
  for (const [id, a] of Object.entries(ADAPTERS)) {
    if (a.chatPath) {
      assert.ok(
        a.chatStyle === "openai" || a.chatStyle === "anthropic" || a.chatStyle === "gemini",
        `${id}: chatStyle must be openai/anthropic/gemini`
      );
      assert.ok(
        Array.isArray(a.textPaths) && a.textPaths.length > 0,
        `${id}: textPaths required`
      );
    }
  }
});

test("probe adapters carry a method + path; form-only ones are flagged", () => {
  let probes = 0;
  for (const [id, a] of Object.entries(ADAPTERS)) {
    if (a.probe) {
      probes++;
      assert.ok(a.probe.path && a.probe.method, `${id}: probe needs path + method`);
    }
  }
  assert.ok(probes >= 15, `expected 15+ probe adapters, got ${probes}`);
  assert.equal(ADAPTERS["mailgun"]?.formOnly, true);
  assert.equal(ADAPTERS["twilio"]?.formOnly, true);
  assert.match(JSON.stringify(ADAPTERS["tavily"]), /<<DEPTH>>/, "tavily exposes search depth, not a model");
  assert.match(JSON.stringify(ADAPTERS["tavily"].probe?.body ?? {}), /<<TOPIC>>/, "tavily exposes topic");
  assert.match(JSON.stringify(ADAPTERS["tavily"].probe ?? {}), /TIME_RANGE.*MAX_RESULTS.*ANSWER.*CHUNKS.*AUTO.*INCL_DOMAINS/, "tavily exposes full option set");
});

test("media adapters point at verified paths", () => {
  assert.equal(ADAPTERS["openai"]?.image?.path, "/images/generations");
  assert.equal(ADAPTERS["openai"]?.audio?.path, "/audio/speech");
  assert.match(ADAPTERS["elevenlabs"]?.audio?.path ?? "", /text-to-speech/);
  assert.equal(ADAPTERS["cartesia"]?.audio?.path, "/tts/bytes");
  assert.equal(ADAPTERS["deepgram"]?.audio?.path, "/v1/speak");
  assert.equal(ADAPTERS["deepgram"]?.audio?.altPath, "/v2/speak");
  assert.match(ADAPTERS["replicate"]?.image?.path ?? "", /predictions/);
  assert.match(ADAPTERS["gemini"]?.chatPath ?? "", /generateContent/);
  assert.equal(ADAPTERS["anthropic"]?.chatPath, "/messages");
});

test("deepgram TTS joins to real endpoints (no doubled version prefix)", async () => {
  const { buildUpstreamRequest } = await import("../../src/upstream/index.js");
  const dg = PROVIDERS.find((p) => p.id === "deepgram");
  assert.ok(dg, "deepgram registered");
  const target = { baseUrl: dg.baseUrl, keyHeader: dg.keyHeader, keyPrefix: dg.keyPrefix, extraHeaders: dg.extraHeaders };
  const aura = buildUpstreamRequest(target, "SECRET", { path: "/v1/speak", method: "POST", query: { model: "aura-2-thalia-en" }, body: { text: "hi" } });
  assert.equal(aura.url, "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en");
  const flux = buildUpstreamRequest(target, "SECRET", { path: "/v2/speak", method: "POST", query: { model: "flux-alexis-en" }, body: { text: "hi" } });
  assert.equal(flux.url, "https://api.deepgram.com/v2/speak?model=flux-alexis-en");
});

test("playground page embeds the adapter table and probe/model hooks", () => {
  const html = playgroundPage();
  assert.match(html, /const ADAPTERS=\{/, "adapter table embedded");
  assert.match(html, /id="modelMenu"/, "chat model dropdown menu present");
  assert.match(html, /id="modelChev"/, "chat model dropdown chevron present");
  assert.match(html, /modelMenuSync/, "dropdown sync present");
  assert.match(html, /id="probeVars"/, "probe vars row present");
  assert.match(html, /sendProbe/, "probe sender present");
  assert.match(html, /refreshModels/, "model auto-list present");
  assert.match(html, /pollReplicate/, "replicate polling present");
  assert.match(html, /id="debugLog"/, "debug log pane present");
  assert.match(html, /pgLogAdd/, "debug logging wired");
  // Embedded JSON must survive the template literal (no backticks/${).
  const m = html.match(/const ADAPTERS=(\{.*?\});\n/);
  assert.ok(m, "adapter JSON extractable");
  assert.doesNotMatch(m[1], /`/);
  assert.doesNotMatch(m[1], /\$\{/);
  const parsed = JSON.parse(m[1]);
  assert.equal(Object.keys(parsed).length, Object.keys(ADAPTERS).length);
});

test("every adapter offers the playground something (chat, probe, or media)", () => {
  for (const [id, a] of Object.entries(ADAPTERS)) {
    const has = Boolean(a.chatPath || a.probe || a.image || a.audio || a.video);
    assert.ok(has, `${id}: adapter has no chat, probe, or media entry`);
  }
});
test("defaults cover chat for every chat-capable provider", () => {
  for (const [id, a] of Object.entries(ADAPTERS)) {
    if (a.chatPath) assert.ok(a.defaults.chat, `${id}: chat default model required`);
  }
});

test("proxy form encoding: urlencoded body + content-type override", async () => {
  const { buildUpstreamRequest } = await import("../../src/upstream/index.js");
  const { validateProxyOpts } = await import("../../src/proxy/forward.js");
  const target = { baseUrl: "https://api.mailgun.net/v3", keyHeader: "Authorization", keyPrefix: "Basic ", extraHeaders: {} };
  assert.deepEqual(validateProxyOpts({ path: "/d/messages", method: "POST", form: { to: "a@b.c", text: "hi" } }), { ok: true });
  assert.match((validateProxyOpts({ path: "/x", method: "POST", body: {}, form: { a: "b" } }) as { error: string }).error, /mutually exclusive/);
  assert.match((validateProxyOpts({ path: "/x", method: "POST", form: { a: "x".repeat(9000) } }) as { error: string }).error, /invalid form/);
  const r = buildUpstreamRequest(target, "SECRET", { path: "/d/messages", method: "POST", form: { to: "a@b.c", text: "hi there" } });
  assert.equal(r.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(r.body, "to=a%40b.c&text=hi+there");
  assert.equal(r.headers["Authorization"], "Basic SECRET");
});
