import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { dbPing } from "./db/index.js";

const PORT = Number(process.env.PORT ?? 3000);

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
  main { min-height:calc(100vh - 56px); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px 16px; }
  .wrap { width:100%; max-width:640px; margin:0 auto; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:24px; }
  h1 { font-size:30px; font-weight:600; margin:0; text-align:center; }
  .hero-logo { width:40px; height:40px; object-fit:contain; flex-shrink:0; }
  .hero-row { display:flex; align-items:center; justify-content:center; gap:4px; }
  .search-card { width:100%; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:6px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .search-box { display:flex; align-items:center; gap:0; background:#f5f5f5; border:1px solid var(--line); border-radius:12px; height:40px; padding:0 4px 0 10px; box-shadow:0 4px 12px rgba(0,0,0,.08); }
  .search-box svg { flex-shrink:0; color:var(--subtle); }
  .search-box input { flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:16px; padding:0 16px; }
  .kbd { display:flex; gap:4px; padding-right:10px; }
  .kbd kbd { height:20px; min-width:20px; display:inline-flex; align-items:center; justify-content:center; padding:0 4px; font-size:12px; font-family:inherit; background:#fff; color:#525252; border:1px solid #e5e5e5; border-radius:4px; }
  #results { width:100%; font-size:14px; color:var(--subtle); min-height:20px; text-align:center; }
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
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { results.textContent = ''; return; }
      results.textContent = 'Searching for "' + q + '"…';
      try {
        const r = await fetch('/api/search?q=' + encodeURIComponent(q));
        const data = await r.json();
        results.textContent = data.message;
      } catch { results.textContent = ''; }
    }, 200);
  });
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
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
  if (req.method === "GET" && url.pathname === "/api/search") {
    const q = url.searchParams.get("q") ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ query: q, message: q ? `No results for "${q}" yet.` : "Type to search." }));
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
});

server.listen(PORT, () => {
  console.log(`pool-anything listening on http://localhost:${PORT}`);
});
