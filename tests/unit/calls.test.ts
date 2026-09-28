import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LOCAL_DB_PATH = new URL("./tmp-calls.db", import.meta.url).pathname;
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb, logCall, callBodyForStorage, CALLS_BODY_CHARS, CALLS_MEDIA_CHARS } = await import("../../src/pool/index.js");

const pid = Number(sdb.prepare("INSERT INTO pools (provider, name) VALUES ('custom','calls')").run().lastInsertRowid);
const kid = Number(sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'k1', 'x')").run(pid).lastInsertRowid);

test("text bodies cap at 4000 chars", () => {
  const big = "a".repeat(6000);
  const r = callBodyForStorage(big, "text", false);
  assert.equal(r.body.length, CALLS_BODY_CHARS);
  assert.equal(r.truncated, true);
  const small = callBodyForStorage("hi", "text", false);
  assert.deepEqual(small, { body: "hi", truncated: false });
});

test("base64 media keeps up to ~2MB so generations stay playable", () => {
  const clip = "b".repeat(500_000);
  const r = callBodyForStorage(clip, "base64", false);
  assert.equal(r.body.length, 500_000);
  assert.equal(r.truncated, false);
  assert.ok(CALLS_MEDIA_CHARS >= 2_000_000);
  const huge = callBodyForStorage("c".repeat(CALLS_MEDIA_CHARS + 10), "base64", false);
  assert.equal(huge.body.length, CALLS_MEDIA_CHARS);
  assert.equal(huge.truncated, true);
});

test("logCall persists attempts and never throws", () => {
  logCall({ pool_id: pid, key_id: kid, method: "POST", path: "/v1/speak", status: 200, tokens: 5, body: "AUDIODATA", truncated: false, encoding: "base64", contentType: "audio/mpeg", error: "" });
  const rows = sdb.prepare("SELECT status, tokens, encoding, content_type, error FROM calls WHERE pool_id = ?").all(pid) as
    { status: number; tokens: number; encoding: string; content_type: string; error: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 200);
  assert.equal(rows[0]!.tokens, 5);
  assert.equal(rows[0]!.encoding, "base64");
  assert.equal(rows[0]!.content_type, "audio/mpeg");
  assert.equal(rows[0]!.error, "");
});
