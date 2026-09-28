import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

process.env.LOCAL_DB_PATH = new URL("./tmp-multimodal.db", import.meta.url).pathname;
process.env.ALLOW_PRIVATE_UPSTREAM = "1";
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}

const caps = await import("../../src/media/capabilities.js");
const { sdb } = await import("../../src/pool/index.js");
const { forward, validateProxyOpts } = await import("../../src/proxy/forward.js");
const { playgroundPage } = await import("../../src/admin/pages.js");

test("capability map: vision/audio/video gating per provider + model", () => {
  assert.equal(caps.capabilityFor("openai", "gpt-4o-mini").vision, true);
  assert.equal(caps.capabilityFor("anthropic", "claude-sonnet-4-20250514").vision, true);
  assert.equal(caps.capabilityFor("gemini", "gemini-2.0-flash").videoIn, true);
  assert.equal(caps.capabilityFor("openai", "gpt-4o-mini").videoIn, false);
  assert.equal(caps.capabilityFor("elevenlabs", "eleven_multilingual_v2").vision, false);
  assert.equal(caps.capabilityFor("elevenlabs", "eleven_multilingual_v2").audioOut, true);
  assert.equal(caps.capabilityFor("openai", "tts-1").vision, false);
  assert.equal(caps.capabilityFor("openai", "text-embedding-3-small").vision, false);
  assert.equal(caps.capabilityFor("groq", "whisper-large-v3").vision, false);
  assert.equal(caps.capabilityFor("groq", "whisper-large-v3").audioIn, true);
  assert.equal(caps.capabilityFor("unknown-provider", "").vision, false);
});

test("vision message builders: OpenAI data-URI vs Anthropic base64 blocks", () => {
  const img = { b64: "aGVsbG8=", mime: "image/png", kind: "image" as const };
  const open = caps.buildVisionMessages("openai", "hi", [img]);
  assert.equal(open[0].role, "user");
  const parts = (open[0] as { content: unknown[] }).content;
  assert.deepEqual(parts[0], { type: "text", text: "hi" });
  assert.deepEqual(parts[1], { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } });
  const anth = caps.buildVisionMessages("anthropic", "hi", [img]);
  const blocks = (anth[0] as { content: unknown[] }).content;
  assert.deepEqual(blocks[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } });
  assert.deepEqual(caps.buildVisionMessages("groq", "hi", []), [{ role: "user", content: "hi" }]);
  assert.match(caps.gateNote("vision", "elevenlabs", "eleven_multilingual_v2"), /doesn't support image input/);
});

test("playground inline scripts parse without syntax errors", () => {
  const html = playgroundPage();
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1);
  for (const code of blocks) {
    // Parse-only check: new Function compiles without executing (no DOM needed).
    new Function(code);
  }
});

test("playground markup: attach controls, studio modes, gating hooks", () => {
  const html = playgroundPage();
  for (const id of ["attachImg", "attachAudio", "attachVideo", "recAudio", "fileImg", "fileAudio", "fileVideo", "mediaPrev", "capNote", "studioModes", "modeImage", "modeAudio", "modeVideo", "audModel", "audVoice", "audFormat", "genAudio", "vidModel", "vidDur", "vidRes", "genVideo", "audioOut", "videoOut", "studioNote"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(html, /capsFor\(prov/);
  assert.match(html, /doesn/);
  assert.match(html, /input_audio/);
  assert.match(html, /source:\{type:'base64',media_type/);
});

// Echo upstream with a binary audio route.
const echo = http.createServer((req, res) => {
  let s = "";
  req.on("data", (c) => (s += c));
  req.on("end", () => {
    if (req.url === "/audio/speech") {
      const bytes = Buffer.from([0x49, 0x44, 0x33, 0x01, 0x02, 0x03]);
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": bytes.length });
      res.end(bytes);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ gotBytes: s.length, hasImage: s.includes("image_url"), hasAnthropic: s.includes("source") }));
  });
});
await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
const port = (echo.address() as { port: number }).port;

const p = sdb.prepare("INSERT INTO pools (provider, name, base_url) VALUES ('custom','media-echo',?)").run(`http://127.0.0.1:${port}`);
const pid = Number(p.lastInsertRowid);
sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k1', 'SECRET')").run(pid);

test("proxy accepts base64 media bodies up to the media cap, rejects beyond it", () => {
  const big = "A".repeat(2_000_000);
  const ok = validateProxyOpts({ path: "/v1/chat", method: "POST", body: { model: "m", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + big } }] }] } });
  assert.equal(ok.ok, true);
  const tooBig = validateProxyOpts({ path: "/x", method: "POST", body: { blob: "A".repeat(caps.MAX_PROXY_BODY_BYTES + 1) } });
  assert.equal(tooBig.ok, false);
  assert.match((tooBig as { error: string }).error, /too large/);
});

test("proxy relays image_url payloads and binary audio as base64", async () => {
  const r = await forward(pid, {
    path: "/v1/chat",
    method: "POST",
    body: { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }] }] },
  });
  assert.equal(r.status, 200);
  assert.equal((r as { encoding: string }).encoding, "text");
  assert.equal(JSON.parse((r as { body: string }).body).hasImage, true);

  const a = await forward(pid, { path: "/audio/speech", method: "POST", body: { model: "tts-1", input: "hello", voice: "alloy" } });
  assert.equal(a.status, 200);
  assert.equal((a as { encoding: string }).encoding, "base64");
  assert.match((a as { contentType: string }).contentType, /audio/);
  assert.equal(Buffer.from((a as { body: string }).body, "base64").slice(0, 3).toString(), "ID3");
});

test.after(() => echo.close());
