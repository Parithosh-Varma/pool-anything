import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

process.env.LOCAL_DB_PATH = new URL("./tmp-proxy.db", import.meta.url).pathname;
process.env.ALLOW_PRIVATE_UPSTREAM = "1";
try {
  fs.unlinkSync(process.env.LOCAL_DB_PATH);
} catch {}
const { sdb } = await import("../../src/pool/index.js");
const { forward } = await import("../../src/proxy/forward.js");

// Echo upstream: 429s requests carrying key ONE, 200s the rest.
const echo = http.createServer((req, res) => {
  let s = "";
  req.on("data", (c) => (s += c));
  req.on("end", () => {
    const key = req.headers["x-api-key"] as string;
    if (key === "ONE") {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ gotKey: key, path: req.url, body: s }));
  });
});
await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
const port = (echo.address() as { port: number }).port;

const p = sdb.prepare("INSERT INTO pools (provider, name, base_url) VALUES ('custom','echo',?)").run(`http://127.0.0.1:${port}`);
const pid = Number(p.lastInsertRowid);
sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'key 1', 'ONE')").run(pid);
sdb.prepare("INSERT INTO pool_keys (pool_id, label, api_key) VALUES (?, 'key 2', 'TWO')").run(pid);

test("forward rotates and fails over 429 to next key", async () => {
  const r = await forward(pid, { path: "/v1/hi", method: "POST", body: { a: 1 } });
  assert.equal(r.status, 200);
  assert.ok("key_id" in r && r.label === "key 2");
  assert.equal((r as { upstreamStatus: number }).upstreamStatus, 200);
  assert.equal((r as { tried: unknown[] }).tried.length, 1);
  const body = JSON.parse((r as { body: string }).body);
  assert.equal(body.gotKey, "TWO");
  const cool = sdb.prepare("SELECT cooldown_until AS c FROM pool_keys WHERE label='key 1'").get() as { c: number };
  assert.ok(cool.c > Date.now());
});

test("second forward skips cooling key", async () => {
  const r = await forward(pid, { path: "/v1/hi2", method: "GET" });
  assert.ok("key_id" in r && r.label === "key 2");
});

test.after(() => echo.close());
