import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { dbPing } from "./db/index.js";
import { sdb, PROVIDERS, mask, getPool, nextKey, nextKeyRaw, recordUsage, poolSummary, poolTarget } from "./pool/index.js";

const PORT = Number(process.env.PORT ?? 3000);

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

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
  :root { --line:#e5e5e5; --subtle:#737373; --bg:#fafafa; --card:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:#111; }
  header { height:56px; background:var(--card); border-bottom:1px solid var(--line); display:flex; align-items:center; padding:0 16px; gap:8px; position:sticky; top:0; }
  header .spacer { margin-left:auto; display:flex; gap:4px; }
  header button, header a { font-size:14px; padding:6px 12px; border-radius:8px; border:0; background:inherit; color:#111; text-decoration:none; cursor:pointer; }
  header button:hover, header a:hover { background:#f0f0f0; }
  .shell { display:grid; grid-template-columns:var(--sbw,260px) 1fr; min-height:100vh; transition:grid-template-columns 250ms cubic-bezier(0.77,0,0.175,1); }
  .shell.collapsed { --sbw:57px; }
  .sidebar { background:var(--card); border-right:1px solid var(--line); display:flex; flex-direction:column; min-height:100vh; height:100vh; position:sticky; top:0; overflow:hidden; white-space:nowrap; }
  .sb-header { height:58px; flex-shrink:0; display:flex; align-items:center; gap:4px; border-bottom:1px solid var(--line); padding:0 12px; overflow:hidden; }
  .sb-logo { width:40px; height:40px; flex-shrink:0; display:grid; place-items:center; overflow:hidden; }
  .sb-logo img { width:36px; height:36px; object-fit:contain; }
  .sb-acct { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 12px; border-radius:8px; border:0; background:transparent; cursor:pointer; font-size:14px; }
  .sb-acct:hover { background:#f0f0f0; }
  .sb-acct span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
  .sb-nav { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:12px 11px 12px 14px; scrollbar-width:none; }
  .sb-nav::-webkit-scrollbar { display:none; }
  .quick { display:flex; align-items:center; gap:12px; width:100%; height:32px; padding:0 12px; margin-bottom:12px; border-radius:8px; border:1px solid var(--line); background:var(--card); font-size:14px; color:var(--subtle); cursor:pointer; }
  .quick:hover { background:#f5f5f5; }
  .quick kbd { margin-left:auto; font-size:12px; color:#737373; }
  .mi { display:flex; align-items:center; gap:10px; width:100%; min-height:34px; padding:0 12px; border-radius:8px; border:0; background:transparent; font-size:14px; font-weight:500; color:#111; cursor:pointer; text-decoration:none; text-align:left; }
  .mi:hover { background:#f0f0f0; }
  .mi.active { background:#ececec; }
  .mi .ic { opacity:.5; flex-shrink:0; width:16px; text-align:center; }
  .mi .chev { margin-left:auto; opacity:.4; font-size:12px; }
  .sub { position:relative; margin:0; padding:0 0 0 28px; list-style:none; display:flex; flex-direction:column; gap:1px; }
  .sub::before { content:""; position:absolute; left:19px; top:4px; bottom:4px; width:1px; background:var(--line); }
  .sub a { display:flex; flex-direction:column; padding:8px 11px; border-radius:8px; color:#111; text-decoration:none; }
  .sub a:hover { background:#f0f0f0; }
  .sub b { font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sub small { font-size:10.5px; color:var(--subtle); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sec { margin:12px 0 8px; padding:16px 12px 8px; font-size:14px; color:var(--subtle); font-weight:500; border-top:1px solid var(--line); }
  .sec:first-of-type { border-top:0; }
  details.grp { margin:1px 0; }
  details.grp > summary { list-style:none; }
  details.grp > summary::-webkit-details-marker { display:none; }
  details.grp > summary .chev { transition:transform 200ms; }
  details.grp[open] > summary .chev { transform:rotate(90deg); }
  .sb-footer { height:48px; flex-shrink:0; display:flex; align-items:center; padding:0 14px; border-top:1px solid var(--line); position:sticky; bottom:0; background:var(--card); }
  .collapse-btn { width:34px; height:34px; display:grid; place-items:center; border-radius:8px; border:0; background:transparent; color:var(--subtle); cursor:pointer; }
  .collapse-btn:hover { background:#f0f0f0; color:#111; }
  .shell.collapsed:not(.peeking) .lbl, .shell.collapsed:not(.peeking) .sb-acct span, .shell.collapsed:not(.peeking) .sb-acct svg, .shell.collapsed:not(.peeking) .quick span, .shell.collapsed:not(.peeking) .quick kbd, .shell.collapsed:not(.peeking) .mi .chev, .shell.collapsed:not(.peeking) .sec, .shell.collapsed:not(.peeking) .sub { display:none; }
  .shell.collapsed:not(.peeking) .sb-header { padding:0 8px; justify-content:center; }
  .shell.collapsed:not(.peeking) .sb-acct { display:none; }
  .shell.collapsed:not(.peeking) .mi, .shell.collapsed:not(.peeking) .quick { justify-content:center; padding:0; }
  .shell.peeking { --sbw:260px; }
  .shell .lbl, .shell .sb-acct, .shell .mi .chev, .shell .sec, .shell .sub { opacity:1; transition:opacity 150ms ease; }
  .shell.closing .lbl, .shell.closing .sb-acct, .shell.closing .mi .chev, .shell.closing .sec, .shell.closing .sub { opacity:0; }
  .content { flex:1; min-width:0; display:flex; flex-direction:column; }
  @media (max-width:720px) { .shell { --sbw:57px; } .lbl { display:none; } }
  main { min-height:calc(100vh - 56px); display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:16vh 16px 24px; }
  .wrap { width:100%; max-width:640px; margin:0 auto; display:flex; flex-direction:column; align-items:stretch; gap:24px; }
  h1 { font-size:30px; font-weight:600; margin:0; text-align:center; }
  .hero-logo { width:40px; height:40px; object-fit:contain; flex-shrink:0; }
  .hero-row { display:flex; align-items:center; justify-content:center; gap:4px; }
  .search-card { width:100%; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:6px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .search-box { display:flex; align-items:center; gap:0; background:#f5f5f5; border:1px solid var(--line); border-radius:12px; height:40px; padding:0 4px 0 10px; box-shadow:0 4px 12px rgba(0,0,0,.08); }
  .search-box svg { flex-shrink:0; color:var(--subtle); }
  .search-box input { flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:16px; padding:0 16px; }
  .kbd { display:flex; gap:4px; padding-right:10px; }
  .kbd kbd { height:20px; min-width:20px; display:inline-flex; align-items:center; justify-content:center; padding:0 4px; font-size:12px; font-family:inherit; background:#fff; color:#525252; border:1px solid #e5e5e5; border-radius:4px; }
  #results { width:100%; display:flex; flex-direction:column; gap:8px; }
  .prov { display:flex; align-items:center; gap:10px; width:100%; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px 14px; cursor:pointer; font-size:14px; text-align:left; animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both; }
  .prov:hover { background:#f5f5f5; }
  .prov img { width:22px; height:22px; }
  .prov small { color:var(--subtle); margin-left:auto; }
  @keyframes fadeSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  dialog { border:1px solid var(--line); border-radius:16px; padding:0; max-width:480px; width:calc(100vw - 32px); font-family:inherit; overflow:hidden; }
  dialog::backdrop { background:rgba(0,0,0,.3); }
  .p-head { display:flex; align-items:center; gap:10px; padding:16px 20px 12px; border-bottom:1px solid var(--line); }
  .p-head img { width:28px; height:28px; }
  .p-head b { font-size:16px; }
  .pill { margin-left:auto; font-size:11px; font-weight:600; background:#f0f0f0; border-radius:999px; padding:3px 10px; white-space:nowrap; }
  .p-body { padding:12px 20px 16px; display:flex; flex-direction:column; gap:8px; }
  .p-note { font-size:12px; color:var(--subtle); }
  .krow { display:flex; align-items:center; gap:8px; background:#f5f5f5; border-radius:10px; padding:8px 10px; font-size:13px; animation:fadeSlide .25s ease both; }
  .krow .meta { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .krow .use { font-size:11px; color:var(--subtle); }
  .krow button, .p-foot button { border:1px solid var(--line); background:#fff; color:#111; border-radius:8px; height:32px; padding:0 12px; font-size:13px; cursor:pointer; }
  .slotrow { display:flex; gap:8px; }
  .slotrow input { flex:1; min-width:0; border:1px solid var(--line); border-radius:10px; height:38px; padding:0 12px; font-size:14px; }
  .slotrow button { border:0; background:#111; color:#fff; border-radius:10px; height:38px; padding:0 16px; font-size:14px; cursor:pointer; }
  .p-foot { display:flex; align-items:center; gap:8px; padding:12px 20px 16px; border-top:1px solid var(--line); font-size:12px; color:var(--subtle); }
  .p-foot button { margin-left:auto; }
  .perr { color:#b00; font-size:13px; min-height:18px; }
</style>
</head>
<body>
<div class="shell" id="shell">
<aside class="sidebar">
  <div class="sb-header">
    <a class="sb-logo" aria-label="pool-anything home" href="/"><img src="/logo.png" alt="pool-anything" width="36" height="36" /></a>
    <button class="sb-acct" type="button"><span title="Demgufever@gmail.com's Account">Demgufever@gmail.com's Account</span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M181.66,170.34a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-48-48a8,8,0,0,1,11.32-11.32L128,212.69l42.34-42.35A8,8,0,0,1,181.66,170.34Zm-96-84.68L128,43.31l42.34,42.35a8,8,0,0,0,11.32-11.32l-48-48a8,8,0,0,0-11.32,0l-48,48A8,8,0,0,0,85.66,85.66Z"></path></svg></button>
  </div>
  <nav class="sb-nav">
  </nav>
  <div class="sb-footer"><button class="collapse-btn" id="collapseBtn" type="button" data-sidebar="trigger" aria-expanded="true" aria-label="Collapse sidebar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21.25 6.72v10.56a2.97 2.97 0 0 1-2.97 2.97H5.72a2.97 2.97 0 0 1-2.97-2.97V6.72a2.97 2.97 0 0 1 2.97-2.97h12.56a2.97 2.97 0 0 1 2.97 2.97"></path><path d="M6.25 7.25v9.5"></path></svg></button></div>
</aside>
<div class="content">
<header>
  <div></div>
  <div class="spacer">
    <button type="button">✦ <span>Ask AI</span></button>
    <a href="/?to=/:account/support">Support</a>
    <button type="button" aria-label="User menu">☺</button>
  </div>
</header>
<main>
  <div class="wrap">
    <div class="hero-row"><img class="hero-logo" src="/logo.png" alt="pool-anything logo" width="40" height="40" /><h1>What do you want to pool</h1></div>
    <div class="search-card">
      <div class="search-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"></path></svg>
        <input id="search" aria-label="Search" placeholder="Search" autocomplete="off" />
        <span class="kbd"><kbd>⌘</kbd><kbd>K</kbd></span>
      </div>
    </div>
    <div id="results"></div>
  </div>
</main>
<dialog id="setup">
  <div class="p-head"><img id="pLogo" alt="" /><b id="pName"></b><span class="pill" id="pQuota"></span></div>
  <div class="p-body">
    <div class="p-note" id="pHint"></div>
    <div class="perr" id="perr"></div>
    <div id="krows" style="display:flex;flex-direction:column;gap:6px"></div>
    <div id="pslots" style="display:flex;flex-direction:column;gap:8px"></div>
    <div><button id="pmore" type="button" style="border:0;background:none;cursor:pointer;font-size:13px;color:var(--subtle)">＋ key slot</button></div>
  </div>
  <div class="p-foot"><span id="pUse"></span><button id="pdone" type="button">Done</button></div>
</dialog>
</div>
</div>
<script>
  const shell = document.getElementById('shell');
  const collapseBtn = document.getElementById('collapseBtn');
  const finishCollapse = (apply) => {
    shell.classList.add('closing');
    clearTimeout(finishCollapse.t);
    finishCollapse.t = setTimeout(() => {
      apply();
      shell.classList.remove('closing');
    }, 160);
  };
  collapseBtn.addEventListener('click', () => {
    if (shell.classList.contains('collapsed')) {
      shell.classList.remove('collapsed');
      shell.classList.remove('peeking');
      collapseBtn.setAttribute('aria-expanded', 'true');
      collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
    } else {
      finishCollapse(() => {
        shell.classList.add('collapsed');
        shell.classList.remove('peeking');
        collapseBtn.setAttribute('aria-expanded', 'false');
        collapseBtn.setAttribute('aria-label', 'Expand sidebar');
      });
    }
  });
  const sidebar = document.querySelector('.sidebar');
  let peekTimer;
  sidebar.addEventListener('mouseenter', () => {
    if (!shell.classList.contains('collapsed')) return;
    clearTimeout(peekTimer);
    clearTimeout(finishCollapse.t);
    shell.classList.remove('closing');
    peekTimer = setTimeout(() => shell.classList.add('peeking'), 150);
  });
  sidebar.addEventListener('mouseleave', () => {
    clearTimeout(peekTimer);
    if (!shell.classList.contains('peeking')) return;
    finishCollapse(() => shell.classList.remove('peeking'));
  });
  const input = document.getElementById('search');
  const results = document.getElementById('results');
  let providers = [];
  async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
  async function loadProviders() {
    providers = await j(await fetch('/api/providers'));
  }
  function renderProviders(f) {
    f = (f || '').toLowerCase();
    results.innerHTML = '';
    if (!f) return;
    providers.filter(p => p.name.toLowerCase().includes(f) || p.id.includes(f)).forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'prov'; b.type = 'button';
      b.style.animationDelay = Math.min(i * 35, 350) + 'ms';
      const img = document.createElement('img'); img.alt = ''; img.src = '/logos/' + (p.logoFile || p.id + '.svg');
      img.onerror = () => img.remove(); b.appendChild(img);
      const n = document.createElement('span'); n.textContent = p.name; b.appendChild(n);
      const q = document.createElement('small'); q.textContent = p.quota; b.appendChild(q);
      b.onclick = () => showProvider(p);
      results.appendChild(b);
    });
  }
  function showProvider(p) {
    openPanel(p);
  }
  const dlg = document.getElementById('setup');
  let pool = null, keyTotal = 0, usageMap = {};
  async function openPanel(p) {
    document.getElementById('pLogo').src = '/logos/' + (p.logoFile || p.id + '.svg');
    document.getElementById('pLogo').onerror = function () { this.remove(); };
    document.getElementById('pName').textContent = p.name;
    document.getElementById('pQuota').textContent = p.quota;
    document.getElementById('pHint').textContent = p.hint + (p.poolable === false ? ' · control-plane only, not poolable for data' : '');
    document.getElementById('perr').textContent = '';
    const pools = await j(await fetch('/api/pools'));
    pool = pools.find(x => x.provider === p.id);
    if (!pool) pool = await j(await fetch('/api/pools', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: p.id, name: p.name + ' pool' }) }));
    document.getElementById('pslots').innerHTML = '';
    await refreshPanel();
    dlg.showModal();
  }
  async function refreshPanel() {
    const [ks, us] = await Promise.all([
      j(await fetch('/api/pools/' + pool.id + '/keys')),
      j(await fetch('/api/pools/' + pool.id + '/usage')),
    ]);
    usageMap = {};
    (us.perKey || []).forEach(k => { usageMap[k.id] = k.used; });
    document.getElementById('pUse').textContent = us.quota ? us.used + ' / ' + (us.quota * ks.length) + ' used' : us.used + ' used';
    const box = document.getElementById('krows'); box.innerHTML = '';
    ks.forEach((k, i) => {
      const row = document.createElement('div');
      row.className = 'krow'; row.style.animationDelay = Math.min(i * 40, 300) + 'ms';
      const m = document.createElement('span'); m.className = 'meta'; m.textContent = k.label + ' · ' + k.masked; row.appendChild(m);
      const u = document.createElement('span'); u.className = 'use'; u.textContent = (usageMap[k.id] || 0) + ' used'; row.appendChild(u);
      const d = document.createElement('button'); d.textContent = 'Remove'; d.type = 'button';
      d.onclick = async () => { await fetch('/api/pools/' + pool.id + '/keys/' + k.id, { method: 'DELETE' }); refreshPanel(); };
      row.appendChild(d); box.appendChild(row);
    });
    keyTotal = ks.length;
    if (!document.querySelector('#pslots .slotrow')) addSlot();
  }
  function addSlot() {
    const n = keyTotal + document.querySelectorAll('#pslots .slotrow').length + 1;
    const form = document.createElement('form'); form.className = 'slotrow';
    form.innerHTML = '<input placeholder="key ' + n + ' — paste API key, hit Enter" type="password" autocomplete="off"/><button type="submit">Gather</button>';
    const inp = form.querySelector('input');
    form.onsubmit = async (e) => {
      e.preventDefault();
      document.getElementById('perr').textContent = '';
      const api_key = inp.value.trim();
      if (!api_key) { document.getElementById('perr').textContent = 'Paste an API key first.'; return; }
      const r = await j(await fetch('/api/pools/' + pool.id + '/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'key ' + n, api_key }) }));
      if (r.error) { document.getElementById('perr').textContent = r.error; return; }
      form.remove(); refreshPanel();
    };
    document.getElementById('pslots').appendChild(form); inp.focus();
  }
  document.getElementById('pmore').onclick = () => addSlot();
  document.getElementById('pdone').onclick = () => dlg.close();
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => renderProviders(input.value.trim()), 150);
  });
  loadProviders();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
  if (req.method === "GET" && (url.pathname === "/logo.png" || url.pathname === "/favicon.ico" || url.pathname === "/favicon.png")) {
    try {
      const p = path.join(process.cwd(), "src", "logo.png");
      const buf = fs.readFileSync(p);
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      res.end(buf);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
    }
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
      const tok = b.tokens;
      if (!Number.isInteger(tok) || (tok as number) <= 0)
        return send(res, 400, { error: "tokens must be a positive integer" });
      const sel = recordUsage(poolId, tok as number);
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
      let fwdPath: string = (b.path || "/").startsWith("/") ? b.path || "/" : "/" + b.path;
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
  const keyM = url.pathname.match(/^\/api\/pools\/(\d+)\/keys(?:\/(\d+))?$/);
  if (keyM) {
    const poolId = Number(keyM[1]);
    if (req.method === "GET" && !keyM[2]) {
      const rows = sdb
        .prepare("SELECT id, label, api_key, info, created_at FROM pool_keys WHERE pool_id = ? ORDER BY id")
        .all(poolId) as { id: number; label: string; api_key: string; info: string; created_at: string }[];
      send(res, 200, rows.map((k) => ({ id: k.id, label: k.label, masked: mask(k.api_key), info: k.info, created_at: k.created_at })));
      return;
    }
    if (req.method === "POST" && !keyM[2]) {
      if (!getPool(poolId)) return send(res, 404, { error: "pool not found" });
      const b = (await readJson(req)) as { label?: string; api_key?: string; info?: string };
      if (!b.label || !b.api_key) return send(res, 400, { error: "label + api_key required" });
      const r = sdb
        .prepare("INSERT INTO pool_keys (pool_id, label, api_key, info) VALUES (?, ?, ?, ?)")
        .run(poolId, b.label, b.api_key, b.info ?? "");
      send(res, 200, { id: r.lastInsertRowid });
      return;
    }
    if (req.method === "DELETE" && keyM[2]) {
      sdb.prepare("DELETE FROM pool_keys WHERE id = ? AND pool_id = ?").run(Number(keyM[2]), poolId);
      send(res, 200, { ok: true });
      return;
    }
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
  if (req.method === "GET" && url.pathname === "/api/db/ping") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...dbPing() }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\n");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`pool-anything listening on http://localhost:${PORT}`);
});
