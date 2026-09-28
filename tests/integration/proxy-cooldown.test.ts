import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

process.env.LOCAL_DB_PATH = new URL("./tmp-proxy-cooldown.db", import.meta.url).pathname;
process.env.ALLOW_PRIVATE_UPSTREAM = "1";
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb } = await import("../../src/pool/index.js");
const { forward } = await import("../../src/proxy/forward.js");

// Stub upstream: /always-401 rejects every key, /always-400 rejects the
// request itself (bad model id etc.) regardless of key.
const stub = http.createServer((req, res) => {
  let s = "";
  req.on("data", (c) => (s += c));
  req.on("end", () => {
    if (req.url?.startsWith("/always-401")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ err_msg: "invalid credentials" }));
      return;
    }
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ err_msg: "model not found" }));
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
const port = (stub.address() as { port: number }).port;

function mkPool(name: string): number {
  const r = sdb
    .prepare("INSERT INTO pools (provider, name, base_url) VALUES ('custom', ?, ?)")
    .run(name, `http://127.0.0.1:${port}`);
  return Number(r.lastInsertRowid);
}

test("all keys 401: every key cools down and tried[] reports each status", async () => {
  const pid = mkPool("all-401");
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'key 1', 'BAD1')").run(pid);
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'key 2', 'BAD2')").run(pid);
  const r = await forward(pid, { path: "/always-401", method: "POST", body: { text: "hi" } });
  assert.equal(r.status, 400);
  assert.equal((r as { error: string }).error, "all keys failed or cooling down");
  const tried = (r as { tried: { key_id: number; label: string; status?: number }[] }).tried;
  assert.equal(tried.length, 2);
  assert.deepEqual(tried.map((t) => t.status), [401, 401]);
  const cools = sdb
    .prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ? AND cooldown_until > ?")
    .get(pid, Date.now()) as { n: number };
  assert.equal(cools.n, 2);
});

test("upstream 400 (bad model id): passthrough, no key cools down", async () => {
  const pid = mkPool("bad-model");
  sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'key 1', 'GOOD')").run(pid);
  const r = await forward(pid, { path: "/always-400", method: "POST", body: { text: "hi" } });
  // Envelope 200 (request reached upstream); real status rides along.
  assert.equal(r.status, 200);
  assert.equal((r as { upstreamStatus: number }).upstreamStatus, 400);
  assert.match((r as { body: string }).body, /model not found/);
  const cool = sdb
    .prepare("SELECT cooldown_until AS c FROM pool_keys WHERE pool_id = ?")
    .get(pid) as { c: number };
  assert.equal(cool.c, 0);
  const usage = sdb
    .prepare("SELECT COUNT(*) AS n FROM usage WHERE pool_id = ?")
    .get(pid) as { n: number };
  assert.equal(usage.n, 0);
});

test.after(() => {
  stub.close();
});
