import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { sdb, PROVIDERS, mask, getPool, nextKey, nextKeyRaw, recordUsage, poolSummary, poolTarget } from "../pool/index.js";

const PORT = Number(process.env.SANDBOX_PORT ?? 4000);
const HOST = "127.0.0.1";

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 1_000_000) reject(new Error("too large"));
    });
    req.on("end", () => {
      if (!s) return resolve({});
      try {
        resolve(JSON.parse(s));
      } catch {
        reject(new Error("bad json"));
      }
    });
  });
}

function send(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const ui = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>sandbox ui</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:600px;margin:0 auto;padding:24px 16px;display:flex;flex-direction:column;gap:12px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:0 0 8px}.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.row:first-child{margin-top:0}
input,select,textarea{border:1px solid #e5e5e5;border-radius:8px;min-height:36px;padding:8px 10px;font-size:14px;flex:1;min-width:120px;font-family:inherit}
button{border:1px solid #e5e5e5;background:#111;color:#fff;border-radius:8px;min-height:36px;padding:0 14px;font-size:14px;cursor:pointer}
button.ghost{background:#fff;color:#111}button:disabled{opacity:.4;cursor:default}
ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
li{background:#f5f5f5;border-radius:8px;padding:8px 10px;font-size:13px;display:flex;gap:8px;align-items:center}
li.sel{outline:2px solid #111}li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li button{min-height:28px;font-size:12px}
#provlist button{animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
@keyframes fadeSlide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
pre{background:#111;color:#eee;border-radius:8px;padding:12px;font-size:12px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.badge{font-size:12px;color:#737373}
.err{color:#b00;font-size:13px;min-height:18px}
.tabimg{width:18px;height:18px;vertical-align:-3px}
</style></head><body><main>
<h1><span id="pname">cartesia</span> pool <span class="badge" id="sel">…</span></h1>
<div class="row"><input id="q" placeholder="Type to pool… e.g. groq" autocomplete="off"/></div>
<div class="row" id="provlist" style="gap:8px"></div>
<div class="row"><button id="tab-cartesia" type="button"><img class="tabimg" src="/logos/cartesia.svg" alt="" onerror="this.remove()"/> Cartesia</button><button id="tab-groq" class="ghost" type="button"><img class="tabimg" src="/logos/groq.svg" alt="" onerror="this.remove()"/> Groq</button></div>
<div class="err" id="err"></div>
<div class="card"><h2>Gather keys</h2>
<ul id="keys"></ul>
<div id="slots" style="display:flex;flex-direction:column;gap:8px;margin-top:8px"></div>
<div class="row"><button id="more" class="ghost" type="button">＋ key slot</button><button id="next" class="ghost" type="button">Next (rotate)</button><button id="usage" class="ghost" type="button">Usage</button></div></div>
<div class="card"><h2>Proxy</h2>
<div class="row"><select id="pmethod"><option>GET</option><option selected>POST</option></select><input id="ppath" placeholder="/voices" style="flex:3"/></div>
<div class="row"><textarea id="pbody" rows="2" placeholder='{"key":"value"} (POST body)'></textarea></div>
<div class="row"><button id="send">Send via pool</button></div></div>
<pre id="out">create or pick a pool…</pre>
</main><script>
let pid=null,keyTotal=0,prov='cartesia',provs=[];
const out=t=>document.getElementById('out').textContent=typeof t==='string'?t:JSON.stringify(t,null,2);
const err=t=>document.getElementById('err').textContent=t||'';
async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function pick(p){
  prov=p;
  document.getElementById('pname').textContent=p;
  document.getElementById('tab-cartesia').className=p==='cartesia'?'':'ghost';
  document.getElementById('tab-groq').className=p==='groq'?'':'ghost';
  document.getElementById('ppath').value=p==='groq'?'/models':'/voices';
  document.getElementById('pmethod').value='GET';
  const pools=await j(await fetch('/api/pools'));
  let pool=pools.find(x=>x.provider===p);
  if(!pool) pool=await j(await fetch('/api/pools',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:p,name:p+' pool'})}));
  pid=pool.id;document.getElementById('sel').textContent='pool #'+pid;
  document.getElementById('slots').innerHTML='';keys();
}
async function init(){
  document.getElementById('tab-cartesia').onclick=()=>pick('cartesia');
  document.getElementById('tab-groq').onclick=()=>pick('groq');
  provs=await j(await fetch('/api/providers'));
  renderProv('');
  document.getElementById('q').addEventListener('input',e=>renderProv(e.target.value));
  pick('cartesia');
}
function renderProv(f){
  f=(f||'').toLowerCase();
  const box=document.getElementById('provlist');box.innerHTML='';
  if(!f) return;
  provs.filter(p=>p.name.toLowerCase().includes(f)||p.id.includes(f)).forEach((p,i)=>{
    const b=document.createElement('button');b.type='button';b.className=prov===p.id?'':'ghost';
    b.style.cssText='display:flex;align-items:center;gap:8px;animation-delay:'+Math.min(i*35,350)+'ms';
    const img=document.createElement('img');img.className='tabimg';img.alt='';img.src='/logos/'+(p.logoFile||p.id+'.svg');
    img.onerror=()=>img.remove();b.appendChild(img);
    const t=document.createElement('span');t.textContent=p.name+' · '+p.quota;b.appendChild(t);
    b.onclick=()=>{pick(p.id);renderProv(document.getElementById('q').value);};
    box.appendChild(b);
  });
}
async function keys(){
  const ks=await j(await fetch('/api/pools/'+pid+'/keys'));
  const ul=document.getElementById('keys');ul.innerHTML='';
  ks.forEach(k=>{
    const li=document.createElement('li');
    const s=document.createElement('span');s.textContent=k.label+' · '+k.masked+(k.info?' · '+k.info:'');li.appendChild(s);
    const d=document.createElement('button');d.textContent='Remove';d.className='ghost';
    d.onclick=async()=>{await fetch('/api/pools/'+pid+'/keys/'+k.id,{method:'DELETE'});keys();};
    li.appendChild(d);ul.appendChild(li);
  });
  out(ks.length?ks.length+' key(s) in pool #'+pid:'pool #'+pid+' is empty — paste a key below');
  keyTotal=ks.length;
  if(!document.querySelector('#slots .slot')) addSlot();
}
function addSlot(){
  const n=keyTotal+document.querySelectorAll('#slots .slot').length+1;
  const box=document.getElementById('slots');
  const form=document.createElement('form');form.className='slot';form.style.cssText='display:flex;gap:8px';
  form.innerHTML='<input placeholder="key '+n+' — paste '+prov+' key, hit Enter" type="password" autocomplete="off" style="flex:1"/><button type="submit">Gather</button>';
  const input=form.querySelector('input');
  form.onsubmit=async(e)=>{
    e.preventDefault();err('');
    const api_key=input.value.trim();
    if(!api_key){err('Paste an API key first.');return;}
    const r=await j(await fetch('/api/pools/'+pid+'/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'key '+n,api_key})}));
    if(r.error){err(r.error);return;}
    form.remove();keys();
  };
  box.appendChild(form);input.focus();
}
document.getElementById('more').onclick=()=>addSlot();
document.getElementById('next').onclick=async()=>out(await j(await fetch('/api/pools/'+pid+'/next')));
document.getElementById('usage').onclick=async()=>out(await j(await fetch('/api/pools/'+pid+'/usage')));
document.getElementById('send').onclick=async()=>{
  err('');
  const method=document.getElementById('pmethod').value,path=document.getElementById('ppath').value||'/';
  let body;const raw=document.getElementById('pbody').value.trim();
  if(method!=='GET'&&raw){try{body=JSON.parse(raw)}catch{err('Proxy body is not valid JSON.');return;}}
  out('sending…');
  out(await j(await fetch('/api/pools/'+pid+'/proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path,method,body})})));
};
init();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "pool-anything sandbox", ok: true }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/ui") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ui);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/logos/")) {
      const name = url.pathname.slice("/logos/".length);
      if (!/^[a-z0-9-]+\.(svg|png)$/.test(name)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found\n");
        return;
      }
      try {
        const buf = fs.readFileSync(path.join(process.cwd(), "public", "logos", name));
        res.writeHead(200, {
          "content-type": name.endsWith(".png") ? "image/png" : "image/svg+xml",
          "cache-control": "public, max-age=3600",
        });
        res.end(buf);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found\n");
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/providers") {
      send(res, 200, PROVIDERS);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/pools") {
      send(res, 200, sdb.prepare("SELECT * FROM pools ORDER BY id DESC").all());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/pools") {
      const b = (await readJson(req)) as { provider?: string; name?: string; base_url?: string; key_header?: string; key_prefix?: string };
      if (!b.provider || !b.name) return send(res, 400, { error: "provider + name required" });
      const r = sdb
        .prepare("INSERT INTO pools (provider, name, base_url, key_header, key_prefix) VALUES (?, ?, ?, ?, ?)")
        .run(b.provider, b.name, b.base_url ?? "", b.key_header ?? "", b.key_prefix ?? "");
      send(res, 200, sdb.prepare("SELECT * FROM pools WHERE id = ?").get(r.lastInsertRowid));
      return;
    }
    const poolM = url.pathname.match(/^\/api\/pools\/(\d+)(\/next|\/consume|\/usage|\/proxy)?$/);
    if (poolM && !url.pathname.includes("/keys")) {
      const poolId = Number(poolM[1]);
      if (req.method === "GET" && !poolM[2]) {
        const s = poolSummary(poolId);
        if (!s) return send(res, 404, { error: "pool not found" });
        send(res, 200, s);
        return;
      }
      if (req.method === "DELETE" && !poolM[2]) {
        sdb.prepare("DELETE FROM usage WHERE pool_id = ?").run(poolId);
        sdb.prepare("DELETE FROM pool_keys WHERE pool_id = ?").run(poolId);
        const r = sdb.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
        if (r.changes === 0) return send(res, 404, { error: "pool not found" });
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && poolM[2] === "/next") {
        const sel = nextKey(poolId);
        if ("error" in sel) return send(res, sel.error === "pool not found" ? 404 : 400, sel);
        send(res, 200, sel);
        return;
      }
      if (req.method === "POST" && poolM[2] === "/consume") {
        const b = (await readJson(req)) as { tokens?: number };
        if (!Number.isInteger(b.tokens) || (b.tokens as number) <= 0)
          return send(res, 400, { error: "tokens must be a positive integer" });
        const sel = recordUsage(poolId, b.tokens as number);
        if ("error" in sel) return send(res, sel.error === "pool not found" ? 404 : 400, sel);
        send(res, 200, sel);
        return;
      }
      if (req.method === "GET" && poolM[2] === "/usage") {
        const s = poolSummary(poolId);
        if (!s) return send(res, 404, { error: "pool not found" });
        send(res, 200, { pool_id: s.id, used: s.used, quota: s.quota, remaining: s.remaining, perKey: s.perKey });
        return;
      }
      if (req.method === "POST" && poolM[2] === "/proxy") {
        const b = (await readJson(req)) as { path?: string; method?: string; headers?: Record<string, string>; body?: unknown; tokens?: number };
        const pool = getPool(poolId);
        if (!pool) return send(res, 404, { error: "pool not found" });
        const target = poolTarget(pool);
        if (!target.baseUrl) return send(res, 400, { error: "pool has no base_url (set it for custom providers)" });
        const sel = nextKeyRaw(poolId);
        if ("error" in sel) return send(res, 400, sel);
        let fwdPath = (b.path || "/").startsWith("/") ? b.path || "/" : "/" + b.path;
        const fwdHeaders: Record<string, string> = { "content-type": "application/json", ...target.extraHeaders, ...(b.headers ?? {}) };
        if (target.keyHeader.startsWith("query:")) {
          const sep = fwdPath.includes("?") ? "&" : "?";
          fwdPath += `${sep}${target.keyHeader.slice("query:".length)}=${encodeURIComponent(sel.api_key)}`;
        } else {
          fwdHeaders[target.keyHeader] = target.keyPrefix + sel.api_key;
        }
        let upstream: Response;
        try {
          upstream = await fetch(target.baseUrl + fwdPath, {
            method: b.method || "POST",
            headers: fwdHeaders,
            body: b.body === undefined ? undefined : JSON.stringify(b.body),
          });
        } catch (e) {
          return send(res, 502, { error: "upstream unreachable", detail: (e as Error).message, key_id: sel.key_id, label: sel.label });
        }
        const text = await upstream.text();
        const tok = b.tokens;
        if (Number.isInteger(tok) && (tok as number) > 0) {
          sdb.prepare("INSERT INTO usage (pool_id, key_id, tokens) VALUES (?, ?, ?)").run(poolId, sel.key_id, tok as number);
        }
        send(res, 200, { key_id: sel.key_id, label: sel.label, masked: sel.masked, status: upstream.status, body: text.slice(0, 4000) });
        return;
      }
    }
    const m = url.pathname.match(/^\/api\/pools\/(\d+)\/keys(?:\/(\d+))?$/);
    if (m) {
      const poolId = Number(m[1]);
      if (req.method === "GET" && !m[2]) {
        const rows = sdb
          .prepare("SELECT id, label, api_key, info, created_at FROM pool_keys WHERE pool_id = ? ORDER BY id")
          .all(poolId) as { id: number; label: string; api_key: string; info: string; created_at: string }[];
        send(res, 200, rows.map((k) => ({ id: k.id, label: k.label, masked: mask(k.api_key), info: k.info, created_at: k.created_at })));
        return;
      }
      if (req.method === "POST" && !m[2]) {
        if (!getPool(poolId)) return send(res, 404, { error: "pool not found" });
        const b = (await readJson(req)) as { label?: string; api_key?: string; info?: string };
        if (!b.label || !b.api_key) return send(res, 400, { error: "label + api_key required" });
        const r = sdb
          .prepare("INSERT INTO pool_keys (pool_id, label, api_key, info) VALUES (?, ?, ?, ?)")
          .run(poolId, b.label, b.api_key, b.info ?? "");
        send(res, 200, { id: r.lastInsertRowid });
        return;
      }
      if (req.method === "GET" && m[2]) {
        const row = sdb
          .prepare("SELECT id, label, api_key, info, created_at FROM pool_keys WHERE id = ? AND pool_id = ?")
          .get(Number(m[2]), poolId) as { id: number; label: string; api_key: string; info: string; created_at: string } | undefined;
        if (!row) return send(res, 404, { error: "key not found" });
        send(res, 200, { ...row, masked: mask(row.api_key) });
        return;
      }
      if (req.method === "PATCH" && m[2]) {
        const b = (await readJson(req)) as { label?: string; api_key?: string; info?: string };
        const cur = sdb
          .prepare("SELECT id FROM pool_keys WHERE id = ? AND pool_id = ?")
          .get(Number(m[2]), poolId) as { id: number } | undefined;
        if (!cur) return send(res, 404, { error: "key not found" });
        if (b.label !== undefined) sdb.prepare("UPDATE pool_keys SET label = ? WHERE id = ?").run(String(b.label).slice(0, 80), Number(m[2]));
        if (b.api_key !== undefined) {
          if (!String(b.api_key).trim()) return send(res, 400, { error: "api_key must not be empty" });
          sdb.prepare("UPDATE pool_keys SET api_key = ? WHERE id = ?").run(String(b.api_key), Number(m[2]));
        }
        if (b.info !== undefined) sdb.prepare("UPDATE pool_keys SET info = ? WHERE id = ?").run(String(b.info).slice(0, 200), Number(m[2]));
        const row = sdb
          .prepare("SELECT id, label, api_key, info, created_at FROM pool_keys WHERE id = ?")
          .get(Number(m[2])) as { id: number; label: string; api_key: string; info: string; created_at: string };
        send(res, 200, { id: row.id, label: row.label, masked: mask(row.api_key), info: row.info });
        return;
      }
      if (req.method === "DELETE" && m[2]) {
        sdb.prepare("DELETE FROM pool_keys WHERE id = ? AND pool_id = ?").run(Number(m[2]), poolId);
        send(res, 200, { ok: true });
        return;
      }
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`sandbox listening on http://${HOST}:${PORT}`);
});
