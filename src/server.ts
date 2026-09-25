import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { dbPing } from "./db/index.js";
import { HOST, PORT, startupWarnings } from "./config/env.js";
import { sdb, PROVIDERS, mask, getPool, poolSummary, getAnalytics } from "./pool/index.js";
import { nextKey, recordUsage } from "./pool/rotation.js";
import { forward, MAX_TOKENS_PER_REQUEST, checkTarget } from "./proxy/forward.js";

/** Abuse caps (see SECURITY.md): unbounded creation grows the SQLite file. */
const MAX_POOLS = 1000;
const MAX_KEYS_PER_POOL = 100;
const MAX_API_KEY_CHARS = 4096;

/** Cache-buster for /logos/* URLs: derived from the logo manifest mtime so any
 *  logo update changes the query string and browsers drop stale cached bytes. */
function logoVersion(): string {
  try {
    return Math.floor(fs.statSync(path.join(process.cwd(), "public", "logos", "manifest.json")).mtimeMs).toString(36);
  } catch {
    return "1";
  }
}
const LOGO_V = logoVersion();

/** Canonical docs live on Cloudflare Pages; the local tool links out to them. */
const DOCS_URL = "https://pool-anything.pages.dev/docs";

/** Sidebar icons: custom inline stroke SVGs (currentColor, 18px via `.mi .ic svg`). */
const svgIcon = (paths: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  home: svgIcon('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>'),
  pools: svgIcon('<path d="m12 3 9 4.9-9 4.9-9-4.9L12 3Z"/><path d="m3 12.9 9 4.9 9-4.9"/><path d="m3 17.4 9 4.9 9-4.9"/>'),
  keys: svgIcon('<circle cx="8" cy="16" r="4.5"/><path d="m11.2 12.8 8.3-8.3"/><path d="M17 5.5l2.5 2.5M14.5 8l2.5 2.5"/>'),
  analytics: svgIcon('<path d="M3 21h18"/><path d="M6 21v-7M11 21V5M16 21v-11M21 21v-4"/>'),
  playground: svgIcon('<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5v-7Z"/>'),
  docs: svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
};

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

/** Full HTML-escape for values interpolated into innerHTML (quotes alone are not enough). */
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  html { scrollbar-gutter:stable; scrollbar-width:none; -ms-overflow-style:none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display:none; }
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
  .sb-acct { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 12px; border-radius:8px; border:0; background:transparent; font-size:14px; }
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
  .mi .ic svg { display:block; width:18px; height:18px; }
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
  .content { flex:1; min-width:0; display:flex; flex-direction:column; animation:pageIn .3s ease both; }
  @keyframes pageIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
  @media (max-width:720px) { .shell { --sbw:57px; } .lbl { display:none; } }
  main { min-height:calc(100vh - 56px); display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:16vh 16px 24px; }
  .wrap { width:100%; max-width:1040px; margin:0 auto; display:flex; flex-direction:column; align-items:stretch; gap:24px; }
  .hero-row, .search-card { width:100%; max-width:640px; margin-left:auto; margin-right:auto; }
  .home-grid { width:100%; display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:24px; align-items:start; }
  @media (min-width:901px) { .home-grid .analytics { position:sticky; top:72px; } }
  @media (max-width:900px) {
    .home-grid { grid-template-columns:1fr; }
  }
  h1 { font-size:clamp(22px, 5vw, 30px); font-weight:600; margin:0; text-align:center; }
  .hero-logo { width:40px; height:40px; object-fit:contain; flex-shrink:0; }
  .hero-row { display:flex; align-items:center; justify-content:center; gap:4px; }
  .search-card { width:100%; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:6px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .search-box { display:flex; align-items:center; gap:0; background:#f5f5f5; border:1px solid var(--line); border-radius:12px; height:40px; padding:0 4px 0 10px; box-shadow:0 4px 12px rgba(0,0,0,.08); }
  .search-box svg { flex-shrink:0; color:var(--subtle); }
  .search-box input { flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:16px; padding:0 16px; }
  .kbd { display:flex; gap:4px; padding-right:10px; }
  .kbd kbd { height:20px; min-width:20px; display:inline-flex; align-items:center; justify-content:center; padding:0 4px; font-size:12px; font-family:inherit; background:#fff; color:#525252; border:1px solid #e5e5e5; border-radius:4px; }
  #results { width:100%; display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; }
  .prov { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; width:100%; min-height:76px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 6px; cursor:pointer; font-size:11px; font-weight:500; text-align:center; animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both; }
  .prov:hover { background:#f5f5f5; }
  .prov img { width:24px; height:24px; }
  .prov span { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prov small { display:none; }
  @keyframes fadeSlide { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
  dialog { border:1px solid var(--line); border-radius:16px; padding:0; max-width:640px; width:calc(100vw - 48px); font-family:inherit; overflow:hidden; }
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
  button:focus-visible, a:focus-visible { outline:2px solid #111; outline-offset:2px; }
  input:focus-visible, select:focus-visible { outline:none; }
  .search-box:focus-within { border-color:transparent; box-shadow:0 4px 12px rgba(0,0,0,.08), 0 0 0 1.5px rgba(59,130,246,.5); }
  @media (max-width:520px) { .hero-row { flex-wrap:wrap; text-align:center; } h1 { font-size:22px; } .analytics-head { flex-wrap:wrap; row-gap:8px; } }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation:none !important; transition:none !important; }
  }
  .analytics { width:100%; display:flex; flex-direction:column; gap:12px; }
  .analytics-head { display:flex; align-items:center; gap:10px; }
  .analytics-head h2 { font-size:15px; font-weight:600; margin:0; }
  .analytics-controls { margin-left:auto; display:flex; align-items:center; gap:8px; }
  .range-pill { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 12px; color:#111; white-space:nowrap; }
  .icon-btn { width:30px; height:30px; display:grid; place-items:center; border-radius:8px; border:1px solid transparent; background:transparent; color:var(--subtle); cursor:pointer; font-size:15px; }
  .icon-btn:hover { background:#f0f0f0; color:#111; }
  .analytics-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .ana-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px 6px; min-width:0; overflow:hidden; transition:border-color 150ms; }
  .ana-card:hover { border-color:#d4d4d4; }
  .ana-card.small { padding-bottom:2px; }
  .ana-top { display:flex; align-items:center; gap:6px; }
  .ana-title { font-size:12px; color:var(--subtle); font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ana-dots { margin-left:auto; color:#a3a3a3; font-size:14px; letter-spacing:1px; user-select:none; }
  .ana-value { display:flex; align-items:baseline; gap:8px; margin-top:2px; }
  .ana-value b { font-size:22px; font-weight:600; line-height:1.2; font-variant-numeric:tabular-nums; }
  .ana-card.small .ana-value b { font-size:20px; }
  .ana-delta { font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; }
  .ana-delta.up { color:#15803d; }
  .ana-delta.down { color:#dc2626; }
  .ana-delta.flat { color:var(--subtle); font-weight:500; }
  .ana-chart { position:relative; height:110px; margin:4px -6px 0; }
  .ana-card.small .ana-chart { height:78px; }
  .ana-chart svg { display:block; width:100%; height:100%; overflow:visible; }
  .ana-y { position:absolute; right:0; top:0; bottom:0; display:flex; flex-direction:column; justify-content:space-between; font-size:10px; color:#a3a3a3; padding:2px 0 14px; pointer-events:none; font-variant-numeric:tabular-nums; }
  .chart-tip { position:absolute; display:none; z-index:5; pointer-events:none; background:#fff; border:1px solid var(--line); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.12); padding:8px 10px; min-width:150px; }
  .chart-tip .tip-day { font-size:12px; font-weight:600; margin-bottom:4px; font-variant-numeric:tabular-nums; }
  .chart-tip .tip-row { display:flex; align-items:center; gap:8px; font-size:12px; }
  .chart-tip .dot { width:10px; height:10px; border-radius:999px; background:#4290F0; flex-shrink:0; }
  .chart-tip .tip-val { margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; padding-left:12px; }
  .no-data { position:absolute; top:38%; left:50%; transform:translate(-50%,-50%); font-size:11px; color:var(--subtle); background:#fff; border:1px solid var(--line); border-radius:999px; padding:3px 10px; white-space:nowrap; }
  .stat-row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .stat-mini { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
  .stat-mini b { font-size:18px; font-weight:600; font-variant-numeric:tabular-nums; }
  @media (max-width:640px) { .analytics-grid { grid-template-columns:1fr 1fr; } .ana-card.span2 { grid-column:1 / -1; } }
  @media (max-width:520px) { .stat-row { grid-template-columns:1fr 1fr; } }
</style>
</head>
<body>
<div class="shell" id="shell">
<aside class="sidebar">
  <div class="sb-header">
    <a class="sb-logo" aria-label="pool-anything home" href="/"><img src="/logo.png" alt="pool-anything" width="36" height="36" /></a>
    <div class="sb-acct" title="Local account"><span>Local account</span></div>
  </div>
  <nav class="sb-nav">
    <a class="mi" href="/"><span class="ic">${ICONS.home}</span><span class="lbl">Home</span></a>
    <a class="mi" href="/pools"><span class="ic">${ICONS.pools}</span><span class="lbl">Pools</span></a>
    <a class="mi" href="/keys"><span class="ic">${ICONS.keys}</span><span class="lbl">API key manager</span></a>
    <a class="mi" href="/playground"><span class="ic">${ICONS.playground}</span><span class="lbl">Playground</span></a>
    <a class="mi" href="/analytics"><span class="ic">${ICONS.analytics}</span><span class="lbl">Analytics</span></a>
    <a class="mi" href="${DOCS_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.docs}</span><span class="lbl">Docs</span></a>
  </nav>
  <div class="sb-footer"><button class="collapse-btn" id="collapseBtn" type="button" data-sidebar="trigger" aria-expanded="true" aria-label="Collapse sidebar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21.25 6.72v10.56a2.97 2.97 0 0 1-2.97 2.97H5.72a2.97 2.97 0 0 1-2.97-2.97V6.72a2.97 2.97 0 0 1 2.97-2.97h12.56a2.97 2.97 0 0 1 2.97 2.97"></path><path d="M6.25 7.25v9.5"></path></svg></button></div>
</aside>
<script>
  (function () {
    try {
      var sh = document.getElementById('shell');
      if (localStorage.getItem('sb-collapsed') !== '1') return;
      sh.classList.add('collapsed');
      var cb = document.getElementById('collapseBtn');
      cb.setAttribute('aria-expanded', 'false');
      cb.setAttribute('aria-label', 'Expand sidebar');
      var sb = sh.querySelector('.sidebar');
      if (sb && sb.matches(':hover')) sh.classList.add('peeking');
    } catch (e) {}
  })();
</script>
<div class="content">
<header>
  <div></div>
  <div class="spacer">
    <a href="${DOCS_URL}" target="_blank" rel="noopener">Docs</a>
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
    <div class="home-grid" id="homeGrid">
    <div id="results"></div>
    <div class="analytics" id="analytics">
      <div class="analytics-head"><h2>Analytics</h2><div class="analytics-controls"><span class="range-pill">◷ Last 14 days</span><button class="icon-btn" id="anaRefresh" type="button" title="Refresh analytics" aria-label="Refresh analytics">↻</button></div></div>
      <div class="analytics-grid">
        <div class="ana-card"><div class="ana-top"><span class="ana-title">Total requests</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statRequests">—</b><span class="ana-delta flat" id="statDeltaReq"></span></div><div class="ana-chart"><svg id="chartRequests" viewBox="0 0 600 110" preserveAspectRatio="none" role="img" aria-label="Total requests"></svg><div class="ana-y" id="yRequests"></div><div class="chart-tip" id="tipRequests"></div></div></div>
        <div class="ana-card"><div class="ana-top"><span class="ana-title">Tokens tracked</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statTokens">—</b><span class="ana-delta flat" id="statDeltaTok"></span></div><div class="ana-chart"><svg id="chartTokens" viewBox="0 0 600 110" preserveAspectRatio="none" role="img" aria-label="Tokens tracked"></svg><div class="ana-y" id="yTokens"></div><div class="chart-tip" id="tipTokens"></div></div></div>
        <div class="ana-card small"><div class="ana-top"><span class="ana-title">Pools</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statPools">—</b></div><div class="ana-chart"><svg id="chartPools" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Pools"></svg><div class="chart-tip" id="tipPools"></div></div></div>
        <div class="ana-card small"><div class="ana-top"><span class="ana-title">Keys pooled</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statKeys">—</b></div><div class="ana-chart"><svg id="chartKeys" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Keys pooled"></svg><div class="chart-tip" id="tipKeys"></div></div></div>
        <div class="ana-card small"><div class="ana-top"><span class="ana-title">Keys cooling</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statCooling">—</b><span class="ana-delta flat" id="statCoolingNote"></span></div><div class="ana-chart"><svg id="chartCool" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Keys cooling"></svg><div class="chart-tip" id="tipCool"></div></div></div>
        <div class="ana-card small"><div class="ana-top"><span class="ana-title">Avg tokens / req</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statAvg">—</b></div><div class="ana-chart"><svg id="chartAvg" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Average tokens per request"></svg><div class="chart-tip" id="tipAvg"></div></div></div>
      </div>
    </div>
    </div>
  </div>
</main>
</div>
</div>
<script>
  const shell = document.getElementById('shell');
  document.querySelectorAll('.sb-nav .mi').forEach(a => {
    if (a.getAttribute('href') === location.pathname) a.classList.add('active');
  });
  const collapseBtn = document.getElementById('collapseBtn');
  try { if (localStorage.getItem('sb-collapsed') === '1') { shell.classList.add('collapsed'); collapseBtn.setAttribute('aria-expanded', 'false'); collapseBtn.setAttribute('aria-label', 'Expand sidebar'); } } catch {}
  const saveSb = () => { try { localStorage.setItem('sb-collapsed', shell.classList.contains('collapsed') ? '1' : '0'); } catch {} };
  const finishCollapse = (apply) => {
    shell.classList.add('closing');
    clearTimeout(finishCollapse.t);
    finishCollapse.t = setTimeout(() => {
      apply();
      shell.classList.remove('closing');
      saveSb();
    }, 160);
  };
  collapseBtn.addEventListener('click', () => {
    if (shell.classList.contains('collapsed')) {
      shell.classList.remove('collapsed');
      shell.classList.remove('peeking');
      collapseBtn.setAttribute('aria-expanded', 'true');
      collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
      saveSb();
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
  if (shell.classList.contains('collapsed') && sidebar.matches(':hover')) shell.classList.add('peeking');
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
    renderProviders('');
  }
  function renderProviders(f) {
    f = (f || '').toLowerCase();
    results.innerHTML = '';
    const list = !f ? providers : providers.filter(p => p.name.toLowerCase().includes(f) || p.id.includes(f));
    list.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'prov'; b.type = 'button'; b.title = p.name;
      b.style.animationDelay = Math.min(i * 35, 350) + 'ms';
      if (p.logoFile) {
        const img = document.createElement('img'); img.alt = ''; img.src = '/logos/' + p.logoFile + '?v=${LOGO_V}';
        img.onerror = () => img.remove(); b.appendChild(img);
      }
      const n = document.createElement('span'); n.textContent = p.name; b.appendChild(n);
      b.onclick = () => { location.href = '/provider/' + p.id; };
      results.appendChild(b);
    });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => renderProviders(input.value.trim()), 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('.prov');
      if (first) first.click();
    }
  });
  function fmtCompact(n) {
    n = Number(n) || 0;
    if (n >= 1000) {
      const v = n / 1000;
      const s = v >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
      return s + 'k';
    }
    return String(n);
  }
  function renderLine(svgId, tipId, yId, days, vals, label, color) {
    const svg = document.getElementById(svgId);
    const tip = document.getElementById(tipId);
    if (!svg) return;
    const box = svg.viewBox.baseVal;
    const W = box.width || 600, H = box.height || 110, pad = 6;
    const n = vals.length;
    const max = Math.max.apply(null, vals.concat([0]));
    const xs = vals.map((_, i) => pad + (n <= 1 ? (W - pad * 2) / 2 : i * (W - pad * 2) / (n - 1)));
    const ys = vals.map(v => max === 0 ? H - pad - 2 : H - pad - (v / max) * (H - pad * 2));
    svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    [0.25, 0.5, 0.75].forEach(g => {
      const y = pad + (H - pad * 2) * g;
      const ln = document.createElementNS(ns, 'line');
      ln.setAttribute('x1', pad); ln.setAttribute('x2', W - pad);
      ln.setAttribute('y1', y); ln.setAttribute('y2', y);
      ln.setAttribute('stroke', '#f0f0f0'); ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
    });
    let line = '', area = '';
    xs.forEach((x, i) => {
      const y = Math.round(ys[i] * 10) / 10, xr = Math.round(x * 10) / 10;
      line += (i ? 'L' : 'M') + xr + ' ' + y;
      area += (i ? 'L' : 'M') + xr + ' ' + y;
    });
    if (n > 0) area += 'L' + Math.round(xs[n - 1] * 10) / 10 + ' ' + (H - pad) + 'L' + Math.round(xs[0] * 10) / 10 + ' ' + (H - pad) + 'Z';
    const ap = document.createElementNS(ns, 'path');
    ap.setAttribute('d', area); ap.setAttribute('fill', color === '#ef4444' ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.10)'); ap.setAttribute('stroke', 'none');
    svg.appendChild(ap);
    const lp = document.createElementNS(ns, 'path');
    lp.setAttribute('d', line); lp.setAttribute('fill', 'none'); lp.setAttribute('stroke', max === 0 ? '#e5e5e5' : color);
    lp.setAttribute('stroke-width', '1.8'); lp.setAttribute('stroke-linejoin', 'round'); lp.setAttribute('stroke-linecap', 'round');
    svg.appendChild(lp);
    if (yId) {
      const y = document.getElementById(yId);
      if (y) {
        const f = (v) => v >= 1000 ? (Math.round(v / 100) / 10 + 'k') : String(Math.round(v));
        y.innerHTML = max === 0 ? '<span></span><span></span><span>0</span>'
          : '<span>' + f(max) + '</span><span>' + f(max / 2) + '</span><span>0</span>';
      }
    }
    const wrap = svg.parentElement;
    let nd = wrap.querySelector('.no-data');
    if (max === 0) {
      if (!nd) { nd = document.createElement('span'); nd.className = 'no-data'; nd.textContent = 'No data'; wrap.appendChild(nd); }
      else nd.style.display = 'block';
    } else if (nd) nd.style.display = 'none';
    if (!tip || max === 0) { svg.onmousemove = null; svg.onmouseleave = null; return; }
    const dots = xs.map((x, i) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', ys[i]); c.setAttribute('r', '3.5');
      c.setAttribute('fill', color); c.setAttribute('opacity', '0');
      svg.appendChild(c); return c;
    });
    svg.onmousemove = (e) => {
      const r = svg.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width * W;
      let best = 0, bd = 1e9;
      xs.forEach((x, i) => { const d = Math.abs(x - mx); if (d < bd) { bd = d; best = i; } });
      dots.forEach((d, k) => d.setAttribute('opacity', k === best ? '1' : '0'));
      tip.style.display = 'block';
      tip.innerHTML = '<div class="tip-day">' + days[best] + '</div>' +
        '<div class="tip-row"><span class="dot" style="background:' + color + '"></span><span>' + label + '</span><span class="tip-val">' + vals[best] + '</span></div>';
      const wr = wrap.getBoundingClientRect();
      const px = (xs[best] / W) * wr.width, py = (ys[best] / H) * wr.height;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = px + 12; if (left + tw > wr.width - 4) left = px - tw - 12;
      let top = py - th - 10; if (top < 4) top = py + 14;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    };
    svg.onmouseleave = () => { tip.style.display = 'none'; dots.forEach(d => d.setAttribute('opacity', '0')); };
  }
  function setDelta(id, pct, title) {
    const d = document.getElementById(id);
    if (!d) return;
    if (pct === null || pct === undefined) { d.textContent = ''; d.className = 'ana-delta flat'; return; }
    const v = Math.abs(pct).toFixed(1) + '%';
    if (Math.abs(pct) < 0.05) { d.textContent = '― 0%'; d.className = 'ana-delta flat'; }
    else if (pct >= 0) { d.textContent = '↗ ' + v; d.className = 'ana-delta up'; }
    else { d.textContent = '↘ ' + v; d.className = 'ana-delta down'; }
    if (title) d.title = title;
  }
  async function loadAnalytics() {
    try {
      const a = await j(await fetch('/api/analytics'));
      const ana = document.getElementById('analytics');
      const grid = document.getElementById('homeGrid');
      const empty = a.requests === 0 && a.pools === 0 && a.keys === 0;
      // First run: hide the dashboard instead of six "No data" cards.
      if (ana) ana.style.display = empty ? 'none' : '';
      if (grid) grid.style.display = empty ? 'block' : '';
      if (empty) return;
      const BLUE = '#3b82f6', RED = '#ef4444';
      document.getElementById('statRequests').textContent = fmtCompact(a.requests);
      document.getElementById('statRequests').title = String(a.requests);
      document.getElementById('statTokens').textContent = fmtCompact(a.tokens);
      document.getElementById('statTokens').title = String(a.tokens);
      document.getElementById('statPools').textContent = String(a.pools);
      document.getElementById('statKeys').textContent = String(a.keys);
      document.getElementById('statCooling').textContent = String(a.cooling || 0);
      const cn = document.getElementById('statCoolingNote');
      if ((a.cooling || 0) > 0) { cn.textContent = 'in backoff'; cn.className = 'ana-delta down'; }
      else { cn.textContent = ''; cn.className = 'ana-delta flat'; }
      document.getElementById('statAvg').textContent = String(a.avgTokens || 0);
      setDelta('statDeltaReq', a.deltaRequestsPct, 'requests, last 7 days vs prior 7 days');
      setDelta('statDeltaTok', a.deltaTokensPct, 'tokens, last 7 days vs prior 7 days');
      const days = (a.series || []).map(p => p.day);
      renderLine('chartRequests', 'tipRequests', 'yRequests', days, (a.series || []).map(p => p.requests), 'Total requests', BLUE);
      renderLine('chartTokens', 'tipTokens', 'yTokens', days, (a.series || []).map(p => p.tokens), 'Tokens tracked', BLUE);
      renderLine('chartPools', 'tipPools', null, (a.poolsSeries || []).map(p => p.day), (a.poolsSeries || []).map(p => p.count), 'Pools', BLUE);
      renderLine('chartKeys', 'tipKeys', null, (a.keysSeries || []).map(p => p.day), (a.keysSeries || []).map(p => p.count), 'Keys pooled', BLUE);
      renderLine('chartCool', 'tipCool', null, days, days.map(() => a.cooling || 0), 'Keys cooling (live)', RED);
      renderLine('chartAvg', 'tipAvg', null, days, (a.series || []).map(p => p.requests ? Math.round(p.tokens / p.requests * 10) / 10 : 0), 'Avg tokens / req', BLUE);
    } catch (e) { /* analytics is best-effort; search still works */ }
  }
  const anaRefresh = document.getElementById('anaRefresh');
  if (anaRefresh) anaRefresh.onclick = () => loadAnalytics();
  // Refresh when returning from a provider page (covers back-nav and tab switch) so newly gathered keys show up.
  window.addEventListener('pageshow', () => setTimeout(loadAnalytics, 200));
  window.addEventListener('focus', () => setTimeout(loadAnalytics, 200));
  loadProviders();
  loadAnalytics();
</script>
</body>
</html>`;

const shellCss = `
  html { scrollbar-gutter:stable; scrollbar-width:none; -ms-overflow-style:none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display:none; }
  .shell { display:grid; grid-template-columns:var(--sbw,260px) 1fr; min-height:100vh; transition:grid-template-columns 250ms cubic-bezier(0.77,0,0.175,1); }
  .shell.collapsed { --sbw:57px; }
  .sidebar { background:#fff; border-right:1px solid #e5e5e5; display:flex; flex-direction:column; min-height:100vh; height:100vh; position:sticky; top:0; overflow:hidden; white-space:nowrap; }
  .sb-header { height:58px; flex-shrink:0; display:flex; align-items:center; gap:4px; border-bottom:1px solid #e5e5e5; padding:0 12px; overflow:hidden; }
  .sb-acct { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 12px; border-radius:8px; border:0; background:transparent; font-size:14px; }
  .sb-acct span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
  .sb-logo { width:40px; height:40px; flex-shrink:0; display:grid; place-items:center; overflow:hidden; }
  .sb-logo img { width:36px; height:36px; object-fit:contain; }
  .sb-nav { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:12px 11px 12px 14px; scrollbar-width:none; }
  .sb-nav::-webkit-scrollbar { display:none; }
  .mi { display:flex; align-items:center; gap:10px; width:100%; min-height:34px; padding:0 12px; border-radius:8px; border:0; background:transparent; font-size:14px; font-weight:500; color:#111; cursor:pointer; text-decoration:none; text-align:left; }
  .mi:hover { background:#f0f0f0; }
  .mi.active { background:#ececec; }
  .mi .ic { opacity:.5; flex-shrink:0; width:16px; text-align:center; }
  .mi .ic svg { display:block; width:18px; height:18px; }
  .sb-footer { height:48px; flex-shrink:0; display:flex; align-items:center; padding:0 14px; border-top:1px solid #e5e5e5; position:sticky; bottom:0; background:#fff; }
  .collapse-btn { width:34px; height:34px; display:grid; place-items:center; border-radius:8px; border:0; background:transparent; color:#737373; cursor:pointer; }
  .collapse-btn:hover { background:#f0f0f0; color:#111; }
  .shell.collapsed:not(.peeking) .lbl { display:none; }
  .shell.collapsed:not(.peeking) .sb-header { padding:0 8px; justify-content:center; }
  .shell.collapsed:not(.peeking) .sb-acct { display:none; }
  .shell.collapsed:not(.peeking) .mi { justify-content:center; padding:0; }
  .shell.peeking { --sbw:260px; }
  .shell .lbl, .shell .sb-acct { opacity:1; transition:opacity 150ms ease; }
  .shell.closing .lbl, .shell.closing .sb-acct { opacity:0; }
  @keyframes pageIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
  .content { animation:pageIn .3s ease both; }
  @media (max-width:720px) { .shell { --sbw:57px; } .lbl { display:none; } }`;

function shellNav(active: string): string {
  const item = (href: string, icon: string, label: string) => {
    const ext = href.startsWith("http");
    return `<a class="mi${href === active ? " active" : ""}" href="${href}"${ext ? ' target="_blank" rel="noopener"' : ""}><span class="ic">${icon}</span><span class="lbl">${label}</span></a>`;
  };
  return `<aside class="sidebar">
  <div class="sb-header"><a class="sb-logo" aria-label="pool-anything home" href="/"><img src="/logo.png" alt="pool-anything" width="36" height="36" /></a><div class="sb-acct" title="Local account"><span>Local account</span></div></div>
  <nav class="sb-nav">${item("/", ICONS.home, "Home")}${item("/pools", ICONS.pools, "Pools")}${item("/keys", ICONS.keys, "API key manager")}${item("/playground", ICONS.playground, "Playground")}${item("/analytics", ICONS.analytics, "Analytics")}${item(DOCS_URL, ICONS.docs, "Docs")}</nav>
  <div class="sb-footer"><button class="collapse-btn" id="collapseBtn" type="button" data-sidebar="trigger" aria-expanded="true" aria-label="Collapse sidebar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21.25 6.72v10.56a2.97 2.97 0 0 1-2.97 2.97H5.72a2.97 2.97 0 0 1-2.97-2.97V6.72a2.97 2.97 0 0 1 2.97-2.97h12.56a2.97 2.97 0 0 1 2.97 2.97"></path><path d="M6.25 7.25v9.5"></path></svg></button></div>
</aside><script>
  (function () {
    try {
      var sh = document.getElementById('shell');
      if (localStorage.getItem('sb-collapsed') !== '1') return;
      sh.classList.add('collapsed');
      var cb = document.getElementById('collapseBtn');
      cb.setAttribute('aria-expanded', 'false');
      cb.setAttribute('aria-label', 'Expand sidebar');
      var sb = sh.querySelector('.sidebar');
      if (sb && sb.matches(':hover')) sh.classList.add('peeking');
    } catch (e) {}
  })();
</script>`;
}

const shellJs = `<script>
  const shell = document.getElementById('shell');
  const collapseBtn = document.getElementById('collapseBtn');
  try { if (localStorage.getItem('sb-collapsed') === '1') { shell.classList.add('collapsed'); collapseBtn.setAttribute('aria-expanded', 'false'); collapseBtn.setAttribute('aria-label', 'Expand sidebar'); } } catch {}
  const saveSb = () => { try { localStorage.setItem('sb-collapsed', shell.classList.contains('collapsed') ? '1' : '0'); } catch {} };
  const finishCollapse = (apply) => {
    shell.classList.add('closing');
    clearTimeout(finishCollapse.t);
    finishCollapse.t = setTimeout(() => { apply(); shell.classList.remove('closing'); saveSb(); }, 160);
  };
  collapseBtn.addEventListener('click', () => {
    if (shell.classList.contains('collapsed')) {
      shell.classList.remove('collapsed'); shell.classList.remove('peeking');
      collapseBtn.setAttribute('aria-expanded', 'true'); collapseBtn.setAttribute('aria-label', 'Collapse sidebar'); saveSb();
    } else {
      finishCollapse(() => {
        shell.classList.add('collapsed'); shell.classList.remove('peeking');
        collapseBtn.setAttribute('aria-expanded', 'false'); collapseBtn.setAttribute('aria-label', 'Expand sidebar');
      });
    }
  });
  const sidebar = document.querySelector('.sidebar');
  if (shell.classList.contains('collapsed') && sidebar.matches(':hover')) shell.classList.add('peeking');
  let peekTimer;
  sidebar.addEventListener('mouseenter', () => {
    if (!shell.classList.contains('collapsed')) return;
    clearTimeout(peekTimer); clearTimeout(finishCollapse.t); shell.classList.remove('closing');
    peekTimer = setTimeout(() => shell.classList.add('peeking'), 150);
  });
  sidebar.addEventListener('mouseleave', () => {
    clearTimeout(peekTimer);
    if (!shell.classList.contains('peeking')) return;
    finishCollapse(() => shell.classList.remove('peeking'));
  });
</script>`;

function keysPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>API key manager — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:720px;margin:0 auto;padding:32px 16px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0}.card{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:14px}
.chead{display:flex;align-items:center;gap:10px}.chead img{width:24px;height:24px}
.chead b{font-size:15px}.pill{margin-left:auto;font-size:11px;font-weight:600;background:#f0f0f0;border-radius:999px;padding:3px 10px;white-space:nowrap}
.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
input,select{border:1px solid #e5e5e5;border-radius:8px;min-height:36px;padding:0 10px;font-size:14px;flex:1;min-width:140px}
button{border:1px solid #e5e5e5;background:#111;color:#fff;border-radius:8px;min-height:36px;padding:0 14px;font-size:14px;cursor:pointer}
button.ghost{background:#fff;color:#111}button.sm{min-height:28px;font-size:12px}
ul{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
li{background:#f5f5f5;border-radius:8px;padding:8px 10px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:120px}
li small{color:#737373}.err{color:#b00;font-size:13px;min-height:18px}
a.back{font-size:13px;color:#737373}
@media (max-width:520px){.row>*{flex:1 1 100%}}
${shellCss}
</style></head><body><div class="shell" id="shell">${shellNav("/keys")}<div class="content"><main>
<div class="row" style="align-items:center;margin:0"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1 style="flex:1">API key manager</h1></div>
<a class="back" href="/">← pool search</a>
<div class="err" id="err"></div>
<div class="card"><div class="row"><select id="prov" aria-label="Provider"></select><input id="pname" placeholder="Pool name" aria-label="Pool name"/></div><div class="row"><input id="pbase" placeholder="base_url override (custom / self-host)" aria-label="Base URL override"/><input id="phead" placeholder="key header (default X-API-Key)" aria-label="Key header"/><input id="pprefix" placeholder="key prefix, e.g. Bearer " aria-label="Key prefix"/></div><div class="row"><button id="create">New pool</button></div></div>
<div id="pools" style="display:flex;flex-direction:column;gap:12px"></div>
</main><script>
let provs=[];
const err=t=>document.getElementById('err').textContent=t||'';
async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function init(){
  provs=await j(await fetch('/api/providers'));
  document.getElementById('prov').innerHTML=provs.map(p=>'<option value="'+p.id+'">'+p.name+'</option>').join('');
  refresh();
}
async function refresh(){
  err('');
  const pools=await j(await fetch('/api/pools'));
  const box=document.getElementById('pools');box.innerHTML='';
  for(const p of pools){
    const prov=provs.find(x=>x.id===p.provider)||{name:p.provider,quota:'',logoFile:p.provider+'.svg'};
    const [ks,us]=await Promise.all([j(await fetch('/api/pools/'+p.id+'/keys')),j(await fetch('/api/pools/'+p.id+'/usage'))]);
    const card=document.createElement('div');card.className='card';
    card.innerHTML='<div class="chead"><img alt=""/><b></b><span class="pill"></span></div><ul></ul><div class="row"><input placeholder="key '+(ks.length+1)+' — paste API key" aria-label="API key"/><button>Gather</button><button class="ghost sm">Delete pool</button></div>';
    const img=card.querySelector('img');if(prov.logoFile){img.src='/logos/'+prov.logoFile+'?v=${LOGO_V}';img.onerror=()=>img.remove();}else img.remove();
    card.querySelector('b').textContent=prov.name+' · #'+p.id;
    card.querySelector('.pill').textContent='used '+((us.quota?(us.usedInWindow ?? us.used):us.used)||0)+(us.quota?' / '+(us.quota*ks.length):'');
    const ul=card.querySelector('ul');
    ks.forEach(k=>{
      const li=document.createElement('li');
      li.innerHTML='<span></span><small></small>';
      li.querySelector('span').textContent=k.label+' · '+k.masked;
      li.querySelector('small').textContent='used '+((us.perKey||[]).find(x=>x.id===k.id)?.used||0);
      const v=document.createElement('button');v.textContent='View';v.className='ghost sm';
      v.onclick=async()=>{
        if(v.dataset.open){
          delete v.dataset.open;v.textContent='View';
          li.querySelector('span').textContent=k.label+' · '+k.masked;return;
        }
        const full=await j(await fetch('/api/pools/'+p.id+'/keys/'+k.id));
        if(full.error){err(full.error);return;}
        v.dataset.open='1';v.textContent='Hide';
        li.querySelector('span').textContent=k.label+' · '+full.api_key;
      };
      const e=document.createElement('button');e.textContent='Edit';e.className='ghost sm';
      e.onclick=async()=>{
        const full=await j(await fetch('/api/pools/'+p.id+'/keys/'+k.id));
        if(full.error){err(full.error);return;}
        li.innerHTML='';
        const f=document.createElement('div');f.style.cssText='display:flex;gap:6px;flex:1;flex-wrap:wrap';
        f.innerHTML='<input value="'+esc(full.label)+'" style="flex:1;min-width:80px"/><input value="'+esc(full.api_key)+'" type="password" style="flex:2;min-width:120px"/><input value="'+esc(full.info||'')+'" placeholder="info" style="flex:1;min-width:80px"/>';
        const [il,ik,ii]=f.querySelectorAll('input');
        const sv=document.createElement('button');sv.textContent='Save';sv.className='sm';
        sv.onclick=async()=>{
          const r=await j(await fetch('/api/pools/'+p.id+'/keys/'+k.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({label:il.value,api_key:ik.value,info:ii.value})}));
          if(r.error){err(r.error);return;}
          refresh();
        };
        const c=document.createElement('button');c.textContent='Cancel';c.className='ghost sm';
        c.onclick=()=>refresh();
        li.appendChild(f);li.appendChild(sv);li.appendChild(c);
      };
      const d=document.createElement('button');d.textContent='Remove';d.className='ghost sm';
      d.onclick=async()=>{await fetch('/api/pools/'+p.id+'/keys/'+k.id,{method:'DELETE'});refresh();};
      li.appendChild(v);li.appendChild(e);li.appendChild(d);ul.appendChild(li);
    });
    const [inp,gather,del]=card.querySelectorAll('input,button');
    gather.onclick=async()=>{
      const api_key=inp.value.trim();if(!api_key){err('Paste an API key first.');return;}
      await j(await fetch('/api/pools/'+p.id+'/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'key '+(ks.length+1),api_key})}));
      refresh();
    };
    inp.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();gather.onclick();}});
    del.onclick=async()=>{if(!confirm('Delete pool "'+p.name+'" and all its keys + usage?'))return;await fetch('/api/pools/'+p.id,{method:'DELETE'});refresh();};
    box.appendChild(card);
  }
}
document.getElementById('create').onclick=async()=>{
  err('');
  const provider=document.getElementById('prov').value,name=document.getElementById('pname').value||'pool';
  const base_url=document.getElementById('pbase').value.trim(),key_header=document.getElementById('phead').value.trim(),key_prefix=document.getElementById('pprefix').value;
  const p=await j(await fetch('/api/pools',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider,name,base_url,key_header,key_prefix})}));
  if(p.error){err(p.error);return;}
  document.getElementById('pname').value='';
  document.getElementById('pbase').value='';
  document.getElementById('phead').value='';
  document.getElementById('pprefix').value='';
  refresh();
};
init();
</script></div></div>${shellJs}</body></html>`;
}

function analyticsPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Analytics — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:720px;margin:0 auto;padding:32px 16px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0;flex:1}
.row{display:flex;gap:8px;align-items:center}
a.back{font-size:13px;color:#737373}
.empty{color:#737373;font-size:14px;text-align:center;padding:24px 0}
.analytics { width:100%; display:flex; flex-direction:column; gap:12px; }
.analytics-head { display:flex; align-items:center; gap:10px; }
.analytics-controls { margin-left:auto; display:flex; align-items:center; gap:8px; }
.range-pill { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; background:#fff; border:1px solid #e5e5e5; border-radius:999px; padding:6px 12px; color:#111; white-space:nowrap; }
.icon-btn { width:30px; height:30px; display:grid; place-items:center; border-radius:8px; border:1px solid transparent; background:transparent; color:#737373; cursor:pointer; font-size:15px; }
.icon-btn:hover { background:#f0f0f0; color:#111; }
.analytics-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.ana-card { background:#fff; border:1px solid #e5e5e5; border-radius:12px; padding:12px 14px 6px; min-width:0; overflow:hidden; transition:border-color 150ms; }
.ana-card:hover { border-color:#d4d4d4; }
.ana-card.small { padding-bottom:2px; }
.ana-top { display:flex; align-items:center; gap:6px; }
.ana-title { font-size:12px; color:#737373; font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ana-dots { margin-left:auto; color:#a3a3a3; font-size:14px; letter-spacing:1px; user-select:none; }
.ana-value { display:flex; align-items:baseline; gap:8px; margin-top:2px; }
.ana-value b { font-size:22px; font-weight:600; line-height:1.2; font-variant-numeric:tabular-nums; }
.ana-card.small .ana-value b { font-size:20px; }
.ana-delta { font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; }
.ana-delta.up { color:#15803d; }
.ana-delta.down { color:#dc2626; }
.ana-delta.flat { color:#737373; font-weight:500; }
.ana-chart { position:relative; height:110px; margin:4px -6px 0; }
.ana-card.small .ana-chart { height:78px; }
.ana-chart svg { display:block; width:100%; height:100%; overflow:visible; }
.ana-y { position:absolute; right:0; top:0; bottom:0; display:flex; flex-direction:column; justify-content:space-between; font-size:10px; color:#a3a3a3; padding:2px 0 14px; pointer-events:none; font-variant-numeric:tabular-nums; }
.chart-tip { position:absolute; display:none; z-index:5; pointer-events:none; background:#fff; border:1px solid #e5e5e5; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.12); padding:8px 10px; min-width:150px; }
.chart-tip .tip-day { font-size:12px; font-weight:600; margin-bottom:4px; font-variant-numeric:tabular-nums; }
.chart-tip .tip-row { display:flex; align-items:center; gap:8px; font-size:12px; }
.chart-tip .dot { width:10px; height:10px; border-radius:999px; background:#4290F0; flex-shrink:0; }
.chart-tip .tip-val { margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; padding-left:12px; }
.no-data { position:absolute; top:38%; left:50%; transform:translate(-50%,-50%); font-size:11px; color:#737373; background:#fff; border:1px solid #e5e5e5; border-radius:999px; padding:3px 10px; white-space:nowrap; }
@media (max-width:640px) { .analytics-grid { grid-template-columns:1fr 1fr; } }
${shellCss}
</style></head><body><div class="shell" id="shell">${shellNav("/analytics")}<div class="content"><main>
<div class="row"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1>Analytics</h1></div>
<a class="back" href="/">← pool search</a>
<div class="analytics" id="analytics">
  <div class="analytics-head"><div class="analytics-controls"><span class="range-pill">◷ Last 14 days</span><button class="icon-btn" id="anaRefresh" type="button" title="Refresh analytics" aria-label="Refresh analytics">↻</button></div></div>
  <div class="analytics-grid">
    <div class="ana-card"><div class="ana-top"><span class="ana-title">Total requests</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statRequests">—</b><span class="ana-delta flat" id="statDeltaReq"></span></div><div class="ana-chart"><svg id="chartRequests" viewBox="0 0 600 110" preserveAspectRatio="none" role="img" aria-label="Total requests"></svg><div class="ana-y" id="yRequests"></div><div class="chart-tip" id="tipRequests"></div></div></div>
    <div class="ana-card"><div class="ana-top"><span class="ana-title">Tokens tracked</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statTokens">—</b><span class="ana-delta flat" id="statDeltaTok"></span></div><div class="ana-chart"><svg id="chartTokens" viewBox="0 0 600 110" preserveAspectRatio="none" role="img" aria-label="Tokens tracked"></svg><div class="ana-y" id="yTokens"></div><div class="chart-tip" id="tipTokens"></div></div></div>
    <div class="ana-card small"><div class="ana-top"><span class="ana-title">Pools</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statPools">—</b></div><div class="ana-chart"><svg id="chartPools" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Pools"></svg><div class="chart-tip" id="tipPools"></div></div></div>
    <div class="ana-card small"><div class="ana-top"><span class="ana-title">Keys pooled</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statKeys">—</b></div><div class="ana-chart"><svg id="chartKeys" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Keys pooled"></svg><div class="chart-tip" id="tipKeys"></div></div></div>
    <div class="ana-card small"><div class="ana-top"><span class="ana-title">Keys cooling</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statCooling">—</b><span class="ana-delta flat" id="statCoolingNote"></span></div><div class="ana-chart"><svg id="chartCool" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Keys cooling"></svg><div class="chart-tip" id="tipCool"></div></div></div>
    <div class="ana-card small"><div class="ana-top"><span class="ana-title">Avg tokens / req</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statAvg">—</b></div><div class="ana-chart"><svg id="chartAvg" viewBox="0 0 300 78" preserveAspectRatio="none" role="img" aria-label="Average tokens per request"></svg><div class="chart-tip" id="tipAvg"></div></div></div>
  </div>
</div>
</main><script>
async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
function fmtCompact(n) {
  n = Number(n) || 0;
  if (n >= 1000) {
    const v = n / 1000;
    const s = v >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
    return s + 'k';
  }
  return String(n);
}
function renderLine(svgId, tipId, yId, days, vals, label, color) {
  const svg = document.getElementById(svgId);
  const tip = document.getElementById(tipId);
  if (!svg) return;
  const box = svg.viewBox.baseVal;
  const W = box.width || 600, H = box.height || 110, pad = 6;
  const n = vals.length;
  const max = Math.max.apply(null, vals.concat([0]));
  const xs = vals.map((_, i) => pad + (n <= 1 ? (W - pad * 2) / 2 : i * (W - pad * 2) / (n - 1)));
  const ys = vals.map(v => max === 0 ? H - pad - 2 : H - pad - (v / max) * (H - pad * 2));
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  [0.25, 0.5, 0.75].forEach(g => {
    const y = pad + (H - pad * 2) * g;
    const ln = document.createElementNS(ns, 'line');
    ln.setAttribute('x1', pad); ln.setAttribute('x2', W - pad);
    ln.setAttribute('y1', y); ln.setAttribute('y2', y);
    ln.setAttribute('stroke', '#f0f0f0'); ln.setAttribute('stroke-width', '1');
    svg.appendChild(ln);
  });
  let line = '', area = '';
  xs.forEach((x, i) => {
    const y = Math.round(ys[i] * 10) / 10, xr = Math.round(x * 10) / 10;
    line += (i ? 'L' : 'M') + xr + ' ' + y;
    area += (i ? 'L' : 'M') + xr + ' ' + y;
  });
  if (n > 0) area += 'L' + Math.round(xs[n - 1] * 10) / 10 + ' ' + (H - pad) + 'L' + Math.round(xs[0] * 10) / 10 + ' ' + (H - pad) + 'Z';
  const ap = document.createElementNS(ns, 'path');
  ap.setAttribute('d', area); ap.setAttribute('fill', color === '#ef4444' ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.10)'); ap.setAttribute('stroke', 'none');
  svg.appendChild(ap);
  const lp = document.createElementNS(ns, 'path');
  lp.setAttribute('d', line); lp.setAttribute('fill', 'none'); lp.setAttribute('stroke', max === 0 ? '#e5e5e5' : color);
  lp.setAttribute('stroke-width', '1.8'); lp.setAttribute('stroke-linejoin', 'round'); lp.setAttribute('stroke-linecap', 'round');
  svg.appendChild(lp);
  if (yId) {
    const y = document.getElementById(yId);
    if (y) {
      const f = (v) => v >= 1000 ? (Math.round(v / 100) / 10 + 'k') : String(Math.round(v));
      y.innerHTML = max === 0 ? '<span></span><span></span><span>0</span>'
        : '<span>' + f(max) + '</span><span>' + f(max / 2) + '</span><span>0</span>';
    }
  }
  const wrap = svg.parentElement;
  let nd = wrap.querySelector('.no-data');
  if (max === 0) {
    if (!nd) { nd = document.createElement('span'); nd.className = 'no-data'; nd.textContent = 'No data'; wrap.appendChild(nd); }
    else nd.style.display = 'block';
  } else if (nd) nd.style.display = 'none';
  if (!tip || max === 0) { svg.onmousemove = null; svg.onmouseleave = null; return; }
  const dots = xs.map((x, i) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', ys[i]); c.setAttribute('r', '3.5');
    c.setAttribute('fill', color); c.setAttribute('opacity', '0');
    svg.appendChild(c); return c;
  });
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * W;
    let best = 0, bd = 1e9;
    xs.forEach((x, i) => { const d = Math.abs(x - mx); if (d < bd) { bd = d; best = i; } });
    dots.forEach((d, k) => d.setAttribute('opacity', k === best ? '1' : '0'));
    tip.style.display = 'block';
    tip.innerHTML = '<div class="tip-day">' + days[best] + '</div>' +
      '<div class="tip-row"><span class="dot" style="background:' + color + '"></span><span>' + label + '</span><span class="tip-val">' + vals[best] + '</span></div>';
    const wr = wrap.getBoundingClientRect();
    const px = (xs[best] / W) * wr.width, py = (ys[best] / H) * wr.height;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = px + 12; if (left + tw > wr.width - 4) left = px - tw - 12;
    let top = py - th - 10; if (top < 4) top = py + 14;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  svg.onmouseleave = () => { tip.style.display = 'none'; dots.forEach(d => d.setAttribute('opacity', '0')); };
}
function setDelta(id, pct, title) {
  const d = document.getElementById(id);
  if (!d) return;
  if (pct === null || pct === undefined) { d.textContent = ''; d.className = 'ana-delta flat'; return; }
  const v = Math.abs(pct).toFixed(1) + '%';
  if (Math.abs(pct) < 0.05) { d.textContent = '― 0%'; d.className = 'ana-delta flat'; }
  else if (pct >= 0) { d.textContent = '↗ ' + v; d.className = 'ana-delta up'; }
  else { d.textContent = '↘ ' + v; d.className = 'ana-delta down'; }
  if (title) d.title = title;
}
async function loadAnalytics() {
  try {
    const a = await j(await fetch('/api/analytics'));
    const ana = document.getElementById('analytics');
    if (a.requests === 0 && a.pools === 0 && a.keys === 0) {
      if (ana) ana.innerHTML = '<div class="empty">No usage yet — gather keys on <a href="/">home</a> and send traffic through the proxy.</div>';
      return;
    }
    const BLUE = '#3b82f6', RED = '#ef4444';
    document.getElementById('statRequests').textContent = fmtCompact(a.requests);
    document.getElementById('statRequests').title = String(a.requests);
    document.getElementById('statTokens').textContent = fmtCompact(a.tokens);
    document.getElementById('statTokens').title = String(a.tokens);
    document.getElementById('statPools').textContent = String(a.pools);
    document.getElementById('statKeys').textContent = String(a.keys);
    document.getElementById('statCooling').textContent = String(a.cooling || 0);
    const cn = document.getElementById('statCoolingNote');
    if ((a.cooling || 0) > 0) { cn.textContent = 'in backoff'; cn.className = 'ana-delta down'; }
    else { cn.textContent = ''; cn.className = 'ana-delta flat'; }
    document.getElementById('statAvg').textContent = String(a.avgTokens || 0);
    setDelta('statDeltaReq', a.deltaRequestsPct, 'requests, last 7 days vs prior 7 days');
    setDelta('statDeltaTok', a.deltaTokensPct, 'tokens, last 7 days vs prior 7 days');
    const days = (a.series || []).map(p => p.day);
    renderLine('chartRequests', 'tipRequests', 'yRequests', days, (a.series || []).map(p => p.requests), 'Total requests', BLUE);
    renderLine('chartTokens', 'tipTokens', 'yTokens', days, (a.series || []).map(p => p.tokens), 'Tokens tracked', BLUE);
    renderLine('chartPools', 'tipPools', null, (a.poolsSeries || []).map(p => p.day), (a.poolsSeries || []).map(p => p.count), 'Pools', BLUE);
    renderLine('chartKeys', 'tipKeys', null, (a.keysSeries || []).map(p => p.day), (a.keysSeries || []).map(p => p.count), 'Keys pooled', BLUE);
    renderLine('chartCool', 'tipCool', null, days, days.map(() => a.cooling || 0), 'Keys cooling (live)', RED);
    renderLine('chartAvg', 'tipAvg', null, days, (a.series || []).map(p => p.requests ? Math.round(p.tokens / p.requests * 10) / 10 : 0), 'Avg tokens / req', BLUE);
  } catch (e) { /* analytics is best-effort */ }
}
const anaRefresh = document.getElementById('anaRefresh');
if (anaRefresh) anaRefresh.onclick = () => loadAnalytics();
window.addEventListener('pageshow', () => setTimeout(loadAnalytics, 200));
window.addEventListener('focus', () => setTimeout(loadAnalytics, 200));
loadAnalytics();
</script></div></div>${shellJs}</body></html>`;
}

function poolsPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Pools — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:720px;margin:0 auto;padding:32px 16px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0;flex:1}.card{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:14px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
@keyframes fadeSlide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.chead{display:flex;align-items:center;gap:10px}.chead img{width:24px;height:24px}
.chead b{font-size:15px}.pill{margin-left:auto;font-size:11px;font-weight:600;background:#f0f0f0;border-radius:999px;padding:3px 10px;white-space:nowrap}
.row{display:flex;gap:8px;align-items:center}
ul{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
li{background:#f5f5f5;border-radius:8px;padding:8px 10px;font-size:13px;display:flex;gap:8px;align-items:center}
li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li small{color:#737373}
a.back{font-size:13px;color:#737373}a.manage{font-size:13px}
.empty{color:#737373;font-size:14px;text-align:center;padding:24px 0}
${shellCss}
</style></head><body><div class="shell" id="shell">${shellNav("/pools")}<div class="content"><main>
<div class="row"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1>Pools</h1></div>
<a class="back" href="/">← pool search</a>
<div id="pools" style="display:flex;flex-direction:column;gap:12px"></div>
</main><script>
async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function init(){
  const provs=await j(await fetch('/api/providers'));
  const pools=await j(await fetch('/api/pools'));
  const box=document.getElementById('pools');box.innerHTML='';
  let shown=0;
  for(const [i,p] of pools.entries()){
    const ks=await j(await fetch('/api/pools/'+p.id+'/keys'));
    if(!ks.length) continue;
    shown++;
    const us=await j(await fetch('/api/pools/'+p.id+'/usage'));
    const prov=provs.find(x=>x.id===p.provider)||{name:p.provider,quota:'',logoFile:p.provider+'.svg'};
    const card=document.createElement('div');card.className='card';
    card.style.animationDelay=Math.min(i*40,320)+'ms';
    card.innerHTML='<div class="chead"><img alt=""/><b></b><span class="pill"></span></div><ul></ul><div class="row" style="margin-top:10px"><a class="manage" href="/keys">Manage keys →</a></div>';
    const img=card.querySelector('img');if(prov.logoFile){img.src='/logos/'+prov.logoFile+'?v=${LOGO_V}';img.onerror=()=>img.remove();}else img.remove();
    card.querySelector('b').textContent=prov.name+' · '+p.name;
    card.querySelector('.pill').textContent=ks.length+' key(s) · used '+(us.used||0);
    const ul=card.querySelector('ul');
    ks.forEach(k=>{
      const li=document.createElement('li');
      li.innerHTML='<span></span><small></small>';
      li.querySelector('span').textContent=k.label+' · '+k.masked;
      li.querySelector('small').textContent='used '+((us.perKey||[]).find(x=>x.id===k.id)?.used||0);
      ul.appendChild(li);
    });
    box.appendChild(card);
  }
  if(!shown) box.innerHTML='<div class="empty">No pools with keys yet — <a href="/">search providers and gather some</a>.</div>';
}
init();
</script></div></div>${shellJs}</body></html>`;
}

function playgroundPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Playground — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:1280px;margin:0 auto;padding:28px 16px;display:flex;flex-direction:column;gap:14px}
h1{font-size:20px;margin:0}
.pg-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pg-top .spacer{flex:1}
.seg{display:inline-flex;background:#ececec;border-radius:999px;padding:2px}
.seg button{border:0;background:none;border-radius:999px;padding:5px 16px;font-size:13px;cursor:pointer;color:#525252;font-family:inherit}
.seg button.on{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15);color:#111;font-weight:600}
.ctl{border:1px solid #e5e5e5;border-radius:8px;min-height:34px;padding:0 10px;font-size:13px;background:#fff;color:#111;font-family:inherit}
select.ctl{max-width:220px}input.ctl.model{min-width:220px}
.btn{border:1px solid #e5e5e5;background:#fff;border-radius:8px;min-height:34px;padding:0 12px;font-size:13px;cursor:pointer;color:#111;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.btn:hover{background:#f5f5f5}
.pg-grid{display:grid;grid-template-columns:minmax(0,1fr) 400px;border:1px solid #e5e5e5;border-radius:14px;background:#fff;overflow:hidden;min-height:560px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
@keyframes fadeSlide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.pg-grid.nocode{grid-template-columns:minmax(0,1fr)}
.chat{display:flex;flex-direction:column;padding:20px;gap:12px;min-width:0}
.code{border-left:1px solid #e5e5e5;background:#fafafa;display:flex;flex-direction:column;min-width:0;min-height:0}
.pg-grid.nocode .code{display:none}
.fld label{display:block;font-size:11px;letter-spacing:.05em;color:#737373;font-weight:600;margin-bottom:4px}
.ghost{width:100%;border:0;background:transparent;outline:0;resize:vertical;font:inherit;font-size:14px;color:#111;padding:2px 0;min-height:24px}
.msg{background:#f5f5f5;border-radius:12px;padding:12px 14px}
.msg.assistant{background:#fff;border:1px solid #e5e5e5}
.msg.assistant.err{border-color:#f3b7b3;background:#fff5f4}
.msg .body{font-size:14px;white-space:pre-wrap;word-break:break-word}
.msg .who{display:block;font-size:11px;letter-spacing:.05em;color:#737373;font-weight:600;margin-bottom:4px}
.chat-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:12px}
.iconbtn{border:1px solid #e5e5e5;background:#fff;border-radius:8px;min-width:32px;height:32px;cursor:pointer;font-size:15px;color:#111}
.submit{margin:0 auto;border:1px solid #f04438;background:#fff;border-radius:999px;padding:8px 24px;font-weight:600;font-size:14px;cursor:pointer;color:#111;box-shadow:0 0 0 3px rgba(240,68,56,.15);font-family:inherit;display:inline-flex;align-items:center;gap:8px}
.submit:disabled{opacity:.5;cursor:wait}
.submit .hint{font-size:11px;color:#a3a3a3;font-weight:400}
details.params{font-size:13px}
details.params summary{cursor:pointer;color:#737373;font-size:12px}
.params-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px}
.params-grid label{font-size:11px;color:#737373;display:flex;flex-direction:column;gap:4px}
.code-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e5e5e5}
.code-head .spacer{flex:1}
.code pre{margin:0;padding:16px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12.5px;line-height:1.65;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word}
.k{color:#a626a4}.s{color:#50a14f}.n{color:#b76b01}.fn{color:#0184bc}.c{color:#9ca3af}
.err{color:#b00;font-size:13px;min-height:18px}
a.back{font-size:13px;color:#737373}
.studio{border:1px solid #e5e5e5;border-radius:14px;background:#fff;padding:20px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:4px}
.gal figure{margin:0;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;background:#fafafa}
.gal img{width:100%;display:block;aspect-ratio:1;object-fit:cover}
.gal figcaption{font-size:11px;color:#737373;padding:8px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${shellCss}
</style></head><body><div class="shell" id="shell">${shellNav("/playground")}<div class="content"><main>
<div class="pg-top">
<h1>Playground</h1>
<div class="seg"><button id="tabChat" class="on" type="button">Chat</button><button id="tabStudio" type="button">Studio</button></div>
<div class="spacer"></div>
<select class="ctl" id="pool" aria-label="Pool"></select>
<input class="ctl model" id="model" value="" placeholder="model id" aria-label="Model" spellcheck="false" autocomplete="off"/>
<button class="btn" id="copyTop" type="button" title="Copy code">⧉</button>
<button class="btn" id="hideCode" type="button">&lt;/&gt; Hide code</button>
</div>
<a class="back" href="/">← pool search</a>
<div class="err" id="err"></div>
<div class="pg-grid" id="grid">
<div class="chat" id="chatPane">
<div class="fld"><label>SYSTEM</label><textarea class="ghost" id="system" rows="1" placeholder="Enter system message (Optional)"></textarea></div>
<div id="turns" style="display:flex;flex-direction:column;gap:12px"></div>
<details class="params"><summary>Parameters</summary><div class="params-grid">
<label>Path<input class="ctl" id="path" value="/chat/completions" spellcheck="false" autocomplete="off"/></label>
<label>Temperature<input class="ctl" id="temp" value="1" inputmode="decimal"/></label>
<label>Max tokens<input class="ctl" id="maxtokens" value="2048" inputmode="numeric"/></label>
<label>Top P<input class="ctl" id="topp" value="1" inputmode="decimal"/></label>
</div></details>
<div class="chat-foot">
<button class="iconbtn" id="addMsg" type="button" title="Add message">＋</button>
<button class="btn" id="clear" type="button">Clear</button>
<button class="submit" id="submit" type="button">Submit <span class="hint">⌘↵</span></button>
</div>
</div>
<div class="code" id="codePane">
<div class="code-head">
<select class="ctl" id="codeLang" aria-label="Code language" style="border:0;font-weight:600"><option value="python">Python</option><option value="curl">cURL</option></select>
<div class="spacer"></div>
<button class="btn" id="copyCode" type="button" style="border:0">⧉ Copy</button>
</div>
<pre id="code"></pre>
</div>
</div>
<div class="studio" id="studioPane" hidden>
<div class="fld"><label>PROMPT</label><textarea class="ghost" id="imgPrompt" rows="2" placeholder="Describe the image you want to generate..."></textarea></div>
<div class="params-grid" style="margin-top:12px">
<label>Model<input class="ctl" id="imgModel" value="" placeholder="image model id" spellcheck="false" autocomplete="off"/></label>
<label>Size<select class="ctl" id="imgSize"><option>1024x1024</option><option>1792x1024</option><option>1024x1792</option><option>512x512</option></select></label>
</div>
<div class="chat-foot" style="justify-content:center">
<button class="submit" id="generate" type="button">Generate <span class="hint">⌘↵</span></button>
</div>
<div class="gal" id="gallery"></div>
</div>
</main><script>
async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
function he(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
const err=t=>document.getElementById('err').textContent=t||'';
const MODELS={groq:'openai/gpt-oss-120b',openai:'gpt-4o-mini',openrouter:'meta-llama/llama-3.3-70b-instruct:free',mistral:'mistral-small-latest',fireworks:'accounts/fireworks/models/llama-v3p3-70b-instruct',together:'meta-llama/Llama-3.3-70B-Instruct-Turbo',gemini:'gemini-2.0-flash',anthropic:'claude-sonnet-4-20250514',perplexity:'sonar',cohere:'command-r',replicate:'ibm-granite/granite-3.3-8b-instruct',huggingface:'meta-llama/Llama-3.3-70B-Instruct',deepgram:'nova-3',elevenlabs:'eleven_multilingual_v2',cartesia:'sonic-2',tavily:'tavily-search'};
const IMG_MODELS={openai:'gpt-image-1',together:'FLUX.1-schnell',fireworks:'accounts/fireworks/models/flux-1-schnell',replicate:'black-forest-labs/flux-schnell',huggingface:'black-forest-labs/FLUX.1-schnell',openrouter:'black-forest-labs/flux-1-schnell:free',gemini:'imagen-3.0-generate-002',mistral:'mistral-medium'};
let lastDefault='';
let lastImgDefault='⌁';
function params(){
  return {
    path:document.getElementById('path').value.trim()||'/chat/completions',
    temp:parseFloat(document.getElementById('temp').value)||0,
    maxtokens:parseInt(document.getElementById('maxtokens').value,10)||2048,
    topp:parseFloat(document.getElementById('topp').value)||0,
    model:document.getElementById('model').value.trim(),
    system:document.getElementById('system').value
  };
}
function collectMessages(){
  const p=params(),out=[];
  if(p.system.trim())out.push({role:'system',content:p.system});
  document.getElementById('turns').childNodes.forEach(n=>{
    if(n.className&&n.className.indexOf('uturn')>=0){
      const t=n.dataset.locked?(n.dataset.content||''):n.querySelector('textarea').value;
      if(t.trim())out.push({role:'user',content:t});
    }else if(n.className&&n.className.indexOf('aturn')>=0){
      out.push({role:'assistant',content:n.dataset.content||''});
    }
  });
  return out;
}
function addUserTurn(text){
  const d=document.createElement('div');d.className='msg uturn';
  d.innerHTML='<span class="who">USER</span>';
  const t=document.createElement('textarea');t.className='ghost';t.rows=2;t.placeholder='Enter user message...';t.value=text||'';
  t.addEventListener('input',updateCode);
  d.appendChild(t);
  document.getElementById('turns').appendChild(d);
  return t;
}
function lockComposers(){
  document.getElementById('turns').childNodes.forEach(n=>{
    if(n.className&&n.className.indexOf('uturn')>=0&&!n.dataset.locked){
      const t=n.querySelector('textarea');if(!t)return;
      n.dataset.locked='1';n.dataset.content=t.value;
      n.removeChild(t);
      const b=document.createElement('div');b.className='body';b.textContent=n.dataset.content;
      n.appendChild(b);
    }
  });
}
function addAssistantTurn(text,isErr){
  const d=document.createElement('div');d.className='msg assistant aturn'+(isErr?' err':'');
  d.dataset.content=text;
  d.innerHTML='<span class="who">ASSISTANT</span>';
  const b=document.createElement('div');b.className='body';b.textContent=text;
  d.appendChild(b);
  document.getElementById('turns').appendChild(d);
  d.scrollIntoView({block:'nearest'});
}
let rawSnippet='';
function pyStr(s){return he(JSON.stringify(s));}
function isStudio(){return document.getElementById('tabStudio').classList.contains('on');}
function updateCode(){
  if(isStudio()){updateStudioCode();return;}
  const p=params(),msgs=collectMessages();
  const pid=document.getElementById('pool').value||'1';
  const url=location.origin+'/api/pools/'+pid+'/proxy';
  const lang=document.getElementById('codeLang').value;
  const body={model:p.model,messages:msgs,temperature:p.temp,max_tokens:p.maxtokens,top_p:p.topp};
  if(lang==='curl'){
    rawSnippet='curl -X POST '+url+' \\\\\\n  -H "Content-Type: application/json" \\\\\\n  -d '+pyStr(JSON.stringify({path:p.path,method:'POST',body}))+';\\n';
    document.getElementById('code').innerHTML='<span class="c"># runs through your pooled keys — auth injected server-side</span>\\n'+he(rawSnippet);
    return;
  }
  const lines=[];
  lines.push('<span class="k">import</span> requests\\n');
  lines.push('resp = requests.<span class="fn">post</span>(');
  lines.push('    '+pyStr(url)+',');
  lines.push('    json={');
  lines.push('        '+pyStr('path')+': '+pyStr(p.path)+',');
  lines.push('        '+pyStr('method')+': '+pyStr('POST')+',');
  lines.push('        '+pyStr('body')+': {');
  lines.push('            '+pyStr('model')+': '+pyStr(p.model)+',');
  lines.push('            '+pyStr('messages')+': '+he(JSON.stringify(msgs))+',');
  lines.push('            '+pyStr('temperature')+': <span class="n">'+p.temp+'</span>,');
  lines.push('            '+pyStr('max_tokens')+': <span class="n">'+p.maxtokens+'</span>,');
  lines.push('            '+pyStr('top_p')+': <span class="n">'+p.topp+'</span>,');
  lines.push('        },');
  lines.push('    },');
  lines.push('    timeout=<span class="n">120</span>,');
  lines.push(')');
  lines.push('data = resp.<span class="fn">json</span>()');
  lines.push('<span class="fn">print</span>(data[<span class="s">'+pyStr('status')+'</span>])');
  lines.push('<span class="fn">print</span>(data[<span class="s">'+pyStr('body')+'</span>])');
  document.getElementById('code').innerHTML=lines.join('\\n');
  rawSnippet='import requests\\n\\nresp = requests.post(\\n    '+JSON.stringify(url)+',\\n    json='+JSON.stringify({path:p.path,method:'POST',body},null,4)+',\\n    timeout=120,\\n)\\ndata = resp.json()\\nprint(data["status"])\\nprint(data["body"])\\n';
}
function studioParams(){
  return {
    prompt:document.getElementById('imgPrompt').value,
    model:document.getElementById('imgModel').value.trim(),
    size:document.getElementById('imgSize').value
  };
}
function updateStudioCode(){
  const s=studioParams();
  const pid=document.getElementById('pool').value||'1';
  const url=location.origin+'/api/pools/'+pid+'/proxy';
  const lang=document.getElementById('codeLang').value;
  const body={model:s.model,prompt:s.prompt,size:s.size,n:1};
  if(lang==='curl'){
    rawSnippet='curl -X POST '+url+' \\\\\\n  -H "Content-Type: application/json" \\\\\\n  -d '+pyStr(JSON.stringify({path:'/images/generations',method:'POST',body}))+';\\n';
    document.getElementById('code').innerHTML='<span class="c"># runs through your pooled keys — auth injected server-side</span>\\n'+he(rawSnippet);
    return;
  }
  const lines=[];
  lines.push('<span class="k">import</span> requests\\n');
  lines.push('resp = requests.<span class="fn">post</span>(');
  lines.push('    '+pyStr(url)+',');
  lines.push('    json={');
  lines.push('        '+pyStr('path')+': '+pyStr('/images/generations')+',');
  lines.push('        '+pyStr('method')+': '+pyStr('POST')+',');
  lines.push('        '+pyStr('body')+': {');
  lines.push('            '+pyStr('model')+': '+pyStr(s.model)+',');
  lines.push('            '+pyStr('prompt')+': '+pyStr(s.prompt)+',');
  lines.push('            '+pyStr('size')+': '+pyStr(s.size)+',');
  lines.push('            '+pyStr('n')+': <span class="n">1</span>,');
  lines.push('        },');
  lines.push('    },');
  lines.push('    timeout=<span class="n">120</span>,');
  lines.push(')');
  lines.push('data = resp.<span class="fn">json</span>()');
  lines.push('<span class="fn">print</span>(data[<span class="s">'+pyStr('status')+'</span>])');
  lines.push('<span class="fn">print</span>(data[<span class="s">'+pyStr('body')+'</span>])');
  document.getElementById('code').innerHTML=lines.join('\\n');
  rawSnippet='import requests\\n\\nresp = requests.post(\\n    '+JSON.stringify(url)+',\\n    json='+JSON.stringify({path:'/images/generations',method:'POST',body},null,4)+',\\n    timeout=120,\\n)\\ndata = resp.json()\\nprint(data["status"])\\nprint(data["body"])\\n';
}
async function sendStudio(){
  err('');
  const btn=document.getElementById('generate');
  const s=studioParams();
  if(!s.prompt.trim()){err('Describe the image first.');return;}
  if(!s.model){err('Enter an image model id.');return;}
  const pid=Number(document.getElementById('pool').value);
  btn.disabled=true;btn.textContent='Generating…';
  try{
    const r=await j(await fetch('/api/pools/'+pid+'/proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:'/images/generations',method:'POST',body:{model:s.model,prompt:s.prompt,size:s.size,n:1}})}));
    if(r.error){err(r.error);return;}
    let src='',caption=s.prompt;
    try{
      const d=JSON.parse(r.body);
      const first=d.data&&d.data[0];
      if(first){
        if(first.b64_json)src='data:image/png;base64,'+first.b64_json;
        else if(first.url)src=first.url;
        caption=first.revised_prompt||s.prompt;
      }
    }catch{}
    if(!src){err('No image in upstream response (status '+r.status+').');return;}
    const gal=document.getElementById('gallery');
    const fig=document.createElement('figure');
    const img=document.createElement('img');img.src=src;img.alt=s.prompt;img.loading='lazy';
    const cap=document.createElement('figcaption');cap.textContent=s.model+' · '+caption;
    fig.appendChild(img);fig.appendChild(cap);
    gal.prepend(fig);
  }finally{btn.disabled=false;btn.innerHTML='Generate <span class="hint">⌘↵</span>';updateCode();}
}
async function send(){
  err('');
  const btn=document.getElementById('submit');
  const p=params(),msgs=collectMessages();
  if(!msgs.some(m=>m.role==='user')){err('Type a user message first.');return;}
  if(!p.model){err('Enter a model id.');return;}
  const pid=Number(document.getElementById('pool').value);
  btn.disabled=true;
  lockComposers();
  try{
    const r=await j(await fetch('/api/pools/'+pid+'/proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:p.path,method:'POST',body:{model:p.model,messages:msgs,temperature:p.temp,max_tokens:p.maxtokens,top_p:p.topp}})}));
    if(r.error){addAssistantTurn(r.error,true);addUserTurn('').focus();return;}
    let text=r.body||'';
    try{
      const d=JSON.parse(text);
      text=(d.choices&&d.choices[0]&&(d.choices[0].message||{}).content)||(d.content&&d.content[0]&&d.content[0].text)||text;
      if(typeof text!=='string')text=JSON.stringify(text,null,2);
    }catch{}
    addAssistantTurn(text,r.status<200||r.status>=300);
    addUserTurn('').focus();
  }finally{btn.disabled=false;updateCode();}
}
async function init(){
  const provs=await j(await fetch('/api/providers'));
  const pools=await j(await fetch('/api/pools'));
  const sel=document.getElementById('pool');
  sel.innerHTML='';
  const pmap={};
  for(const p of pools){
    const ks=await j(await fetch('/api/pools/'+p.id+'/keys'));
    const prov=provs.find(x=>x.id===p.provider);
    pmap[p.id]=p.provider;
    const o=document.createElement('option');
    o.value=p.id;
    o.textContent=(prov?prov.name:p.provider)+' · '+p.name+' ('+ks.length+' keys)';
    o.disabled=ks.length===0;
    sel.appendChild(o);
  }
  if(!sel.options.length){err('No pools yet — gather keys for a provider first.');document.getElementById('submit').disabled=true;return;}
  const pre=new URLSearchParams(location.search).get('pool');
  if(pre)sel.value=pre;
  if(sel.selectedIndex<0||sel.options[sel.selectedIndex].disabled)sel.selectedIndex=[...sel.options].findIndex(o=>!o.disabled);
  const applyDefault=()=>{
    const m=document.getElementById('model');
    if(m.value===lastDefault){m.value=MODELS[pmap[sel.value]]||'';lastDefault=m.value;}
  };
  const applyImgDefault=()=>{
    const m=document.getElementById('imgModel');
    if(m.value===lastImgDefault){m.value=IMG_MODELS[pmap[sel.value]]||'';lastImgDefault=m.value;}
  };
  applyDefault();
  applyImgDefault();
  lastDefault=document.getElementById('model').value;
  lastImgDefault=document.getElementById('imgModel').value;
  sel.onchange=()=>{applyDefault();applyImgDefault();lastDefault=document.getElementById('model').value;lastImgDefault=document.getElementById('imgModel').value;updateCode();};
  addUserTurn('');
  ['system','model','path','temp','maxtokens','topp'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{if(id==='model')lastDefault='⌁';updateCode();}));
  ['imgPrompt','imgModel','imgSize'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{if(id==='imgModel')lastImgDefault='⌁';updateCode();}));
  document.getElementById('generate').onclick=sendStudio;
  document.getElementById('codeLang').onchange=updateCode;
  document.getElementById('submit').onclick=send;
  document.getElementById('addMsg').onclick=()=>{addUserTurn('').focus();};
  document.getElementById('clear').onclick=()=>{document.getElementById('turns').innerHTML='';addUserTurn('');updateCode();};
  const copy=()=>{navigator.clipboard.writeText(rawSnippet).catch(()=>{});};
  document.getElementById('copyCode').onclick=copy;
  document.getElementById('copyTop').onclick=copy;
  document.getElementById('hideCode').onclick=e=>{const g=document.getElementById('grid');g.classList.toggle('nocode');e.target.textContent=g.classList.contains('nocode')?'</> Show code':'</> Hide code';};
  document.getElementById('tabChat').onclick=()=>setTab(true);
  document.getElementById('tabStudio').onclick=()=>setTab(false);
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(document.getElementById('tabStudio').classList.contains('on'))sendStudio();else send();}});
  updateCode();
}
function setTab(chat){
  document.getElementById('tabChat').classList.toggle('on',chat);
  document.getElementById('tabStudio').classList.toggle('on',!chat);
  document.getElementById('grid').hidden=!chat;
  document.getElementById('studioPane').hidden=chat;
  updateCode();
}
init();
</script></div></div>${shellJs}</body></html>`;
}

function providerPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Provider — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:720px;margin:0 auto;padding:32px 16px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0;flex:1}.card{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:16px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
@keyframes fadeSlide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.chead{display:flex;align-items:center;gap:10px}.chead img{width:28px;height:28px}
.chead b{font-size:16px}.pill{margin-left:auto;font-size:11px;font-weight:600;background:#f0f0f0;border-radius:999px;padding:3px 10px;white-space:nowrap}
.hint{font-size:13px;color:#737373;margin:10px 0 0}
.use{font-size:13px;color:#737373;margin:8px 0 0}
.row{display:flex;gap:8px;align-items:center}
.err{color:#b00;font-size:13px;min-height:18px}
a.back{font-size:13px;color:#737373}
.krow{display:flex;align-items:center;gap:8px;background:#f5f5f5;border-radius:10px;padding:8px 10px;font-size:13px;animation:fadeSlide .25s ease both}
.krow .meta{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.krow .use{font-size:11px;color:#737373;margin:0}
.krow button{border:1px solid #e5e5e5;background:#fff;color:#111;border-radius:8px;min-height:32px;padding:0 12px;font-size:13px;cursor:pointer}
.slotrow{display:flex;gap:8px}
.slotrow input{flex:1;min-width:0;border:1px solid #e5e5e5;border-radius:10px;min-height:38px;padding:0 12px;font-size:14px}
.slotrow button{border:1px solid #e5e5e5;background:#111;color:#fff;border-radius:10px;min-height:38px;padding:0 14px;font-size:14px;cursor:pointer}
.pmore{border:0;background:none;cursor:pointer;font-size:13px;color:#737373;padding:0}
${shellCss}
</style></head><body><div class="shell" id="shell">${shellNav("")}<div class="content"><main>
<div class="row"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1 id="pTitle">Provider</h1></div>
<a class="back" href="/">← all providers</a>
<div class="err" id="err"></div>
<div class="card" id="pcard" hidden>
<div class="chead"><img id="pLogo" alt=""/><b id="pName"></b><span class="pill" id="pQuota"></span></div>
<p class="hint" id="pHint"></p>
<p class="use" id="pUse"></p>
<div id="krows" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>
<div id="pslots" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"></div>
<div style="margin-top:10px"><button class="pmore" id="pmore" type="button">＋ key slot</button></div>
</div>
</main><script>
async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
const err=t=>document.getElementById('err').textContent=t||'';
const id=(location.pathname.split('/')[2]||'');
let pool=null,keyTotal=0,usageMap={};
async function init(){
  if(!/^[a-z0-9-]+$/.test(id)){err('Unknown provider.');return;}
  const provs=await j(await fetch('/api/providers'));
  const p=provs.find(x=>x.id===id);
  if(!p){err('Unknown provider.');return;}
  document.title=p.name+' — pool-anything';
  document.getElementById('pTitle').textContent=p.name;
  const logo=document.getElementById('pLogo');
  if(p.logoFile){logo.src='/logos/'+p.logoFile+'?v=${LOGO_V}';logo.onerror=()=>logo.remove();}
  else logo.remove();
  document.getElementById('pName').textContent=p.name;
  document.getElementById('pQuota').textContent=p.quota;
  document.getElementById('pHint').textContent=p.hint+(p.poolable===false?' · control-plane only, not poolable for data':'');
  document.getElementById('pcard').hidden=false;
  const pools=await j(await fetch('/api/pools'));
  pool=pools.find(x=>x.provider===p.id);
  if(!pool)pool=await j(await fetch('/api/pools',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:p.id,name:p.name+' pool'})}));
  if(!pool||pool.error){err((pool&&pool.error)||'Could not load pool.');return;}
  refresh();
}
async function refresh(){
  const [ks,us]=await Promise.all([j(await fetch('/api/pools/'+pool.id+'/keys')),j(await fetch('/api/pools/'+pool.id+'/usage'))]);
  usageMap={};
  (us.perKey||[]).forEach(k=>{usageMap[k.id]=k.used;});
  document.getElementById('pUse').textContent=us.quota?(us.usedInWindow ?? us.used)+' / '+(us.quota*ks.length)+' used':us.used+' used';
  const box=document.getElementById('krows');box.innerHTML='';
  ks.forEach((k,i)=>{
    const row=document.createElement('div');
    row.className='krow';row.style.animationDelay=Math.min(i*40,300)+'ms';
    const m=document.createElement('span');m.className='meta';m.textContent=k.label+' · '+k.masked;row.appendChild(m);
    const u=document.createElement('span');u.className='use';u.textContent=(usageMap[k.id]||0)+' used';row.appendChild(u);
    const v=document.createElement('button');v.textContent='View';v.type='button';
    v.onclick=async()=>{
      if(v.dataset.open){delete v.dataset.open;v.textContent='View';m.textContent=k.label+' · '+k.masked;return;}
      const full=await j(await fetch('/api/pools/'+pool.id+'/keys/'+k.id));
      if(full.error){err(full.error);return;}
      v.dataset.open='1';v.textContent='Hide';
      m.textContent=k.label+' · '+full.api_key;
    };
    const e=document.createElement('button');e.textContent='Edit';e.type='button';
    e.onclick=async()=>{
      const full=await j(await fetch('/api/pools/'+pool.id+'/keys/'+k.id));
      if(full.error){err(full.error);return;}
      row.innerHTML='';
      const f=document.createElement('div');f.style.cssText='display:flex;gap:6px;flex:1;flex-wrap:wrap';
      f.innerHTML='<input value="'+esc(full.label)+'" style="flex:1;min-width:70px"/><input value="'+esc(full.api_key)+'" type="password" style="flex:2;min-width:110px"/>';
      const [il,ik]=f.querySelectorAll('input');
      const sv=document.createElement('button');sv.textContent='Save';sv.type='button';
      sv.onclick=async()=>{
        const r=await j(await fetch('/api/pools/'+pool.id+'/keys/'+k.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({label:il.value,api_key:ik.value})}));
        if(r.error){err(r.error);return;}
        refresh();
      };
      const c=document.createElement('button');c.textContent='Cancel';c.type='button';
      c.onclick=()=>refresh();
      row.appendChild(f);row.appendChild(sv);row.appendChild(c);
    };
    const d=document.createElement('button');d.textContent='Remove';d.type='button';
    d.onclick=async()=>{await fetch('/api/pools/'+pool.id+'/keys/'+k.id,{method:'DELETE'});refresh();};
    row.appendChild(v);row.appendChild(e);row.appendChild(d);box.appendChild(row);
  });
  keyTotal=ks.length;
  if(!document.querySelector('#pslots .slotrow'))addSlot();
}
function addSlot(){
  const n=keyTotal+document.querySelectorAll('#pslots .slotrow').length+1;
  const form=document.createElement('form');form.className='slotrow';
  form.innerHTML='<input placeholder="key '+n+' — paste API key, hit Enter" aria-label="API key '+n+'" type="password" autocomplete="off"/><button type="submit">Gather</button>';
  const inp=form.querySelector('input');
  form.onsubmit=async(e)=>{
    e.preventDefault();
    err('');
    const api_key=inp.value.trim();
    if(!api_key){err('Paste an API key first.');return;}
    const r=await j(await fetch('/api/pools/'+pool.id+'/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'key '+n,api_key})}));
    if(r.error){err(r.error);return;}
    form.remove();refresh();
  };
  document.getElementById('pslots').appendChild(form);inp.focus();
}
document.getElementById('pmore').onclick=()=>addSlot();
init();
</script></div></div>${shellJs}</body></html>`;
}

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
  if (req.method === "GET" && url.pathname === "/api/analytics") {
    send(res, 200, getAnalytics());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/pools") {
    send(res, 200, sdb.prepare("SELECT * FROM pools ORDER BY id DESC").all());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/pools") {
    const b = (await readJson(req)) as { provider?: string; name?: string; base_url?: string; key_header?: string; key_prefix?: string };
    if (typeof b.provider !== "string" || typeof b.name !== "string" || !b.provider || !b.name)
      return send(res, 400, { error: "provider + name required" });
    const total = (sdb.prepare("SELECT COUNT(*) AS n FROM pools").get() as { n: number }).n;
    if (total >= MAX_POOLS) return send(res, 400, { error: `pool limit reached (${MAX_POOLS})` });
    // Fail fast on auth config the proxy could never use (forward-time check stays as backstop).
    const kh = String(b.key_header ?? "");
    if (kh && !/^[A-Za-z0-9-]+$/.test(kh) && !(kh.startsWith("query:") && kh.length > "query:".length))
      return send(res, 400, { error: "key_header invalid" });
    if (String(b.base_url ?? "")) {
      const safe = checkTarget(String(b.base_url), kh || "X-API-Key");
      if (!safe.ok) return send(res, 400, safe);
    }
    const r = sdb
      .prepare("INSERT INTO pools (provider, name, base_url, key_header, key_prefix) VALUES (?, ?, ?, ?, ?)")
      .run(
        b.provider.slice(0, 80),
        b.name.slice(0, 80),
        String(b.base_url ?? "").slice(0, 500),
        String(b.key_header ?? "").slice(0, 80),
        String(b.key_prefix ?? "").slice(0, 40)
      );
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
      const b = (await readJson(req)) as { tokens?: number; key_id?: number };
      const tok = b.tokens;
      if (!Number.isInteger(tok) || (tok as number) <= 0 || (tok as number) > MAX_TOKENS_PER_REQUEST)
        return send(res, 400, { error: `tokens must be a positive integer <= ${MAX_TOKENS_PER_REQUEST}` });
      if (b.key_id !== undefined && (!Number.isInteger(b.key_id) || b.key_id <= 0))
        return send(res, 400, { error: "key_id must be a positive integer" });
      const sel = recordUsage(poolId, tok as number, b.key_id);
      if ("error" in sel) return send(res, sel.error === "pool not found" ? 404 : sel.error === "key not found" ? 404 : 400, sel);
      send(res, 200, sel);
      return;
    }
    if (req.method === "GET" && poolM[2] === "/usage") {
      const s = poolSummary(poolId);
      if (!s) return send(res, 404, { error: "pool not found" });
      send(res, 200, { pool_id: s.id, used: s.used, usedInWindow: s.usedInWindow, quota: s.quota, quotaWindow: s.quotaWindow, remaining: s.remaining, perKey: s.perKey });
      return;
    }
    if (req.method === "POST" && poolM[2] === "/proxy") {
      const b = (await readJson(req)) as { path?: string; method?: string; headers?: Record<string, string>; body?: unknown; tokens?: number };
      const r = await forward(poolId, b);
      if ("error" in r) return send(res, r.status === 200 ? 400 : r.status, r);
      send(res, 200, { key_id: r.key_id, label: r.label, masked: r.masked, status: r.upstreamStatus, body: r.body, tried: r.tried });
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
      if (typeof b.label !== "string" || typeof b.api_key !== "string" || !b.label || !b.api_key)
        return send(res, 400, { error: "label + api_key required" });
      if (b.info !== undefined && typeof b.info !== "string")
        return send(res, 400, { error: "info must be a string" });
      if (b.api_key.length > MAX_API_KEY_CHARS)
        return send(res, 400, { error: `api_key must be <= ${MAX_API_KEY_CHARS} characters` });
      const kc = (sdb.prepare("SELECT COUNT(*) AS n FROM pool_keys WHERE pool_id = ?").get(poolId) as { n: number }).n;
      if (kc >= MAX_KEYS_PER_POOL) return send(res, 400, { error: `key limit reached (${MAX_KEYS_PER_POOL} per pool)` });
      const r = sdb
        .prepare("INSERT INTO pool_keys (pool_id, label, api_key, info) VALUES (?, ?, ?, ?)")
        .run(poolId, b.label.slice(0, 80), b.api_key, (b.info ?? "").slice(0, 200));
      send(res, 200, { id: r.lastInsertRowid });
      return;
    }
    if (req.method === "GET" && keyM[2]) {
      const row = sdb
        .prepare("SELECT id, label, api_key, info, created_at FROM pool_keys WHERE id = ? AND pool_id = ?")
        .get(Number(keyM[2]), poolId) as { id: number; label: string; api_key: string; info: string; created_at: string } | undefined;
      if (!row) return send(res, 404, { error: "key not found" });
      send(res, 200, { ...row, masked: mask(row.api_key) });
      return;
    }
    if (req.method === "PATCH" && keyM[2]) {
      const b = (await readJson(req)) as { label?: string; api_key?: string; info?: string };
      const cur = sdb
        .prepare("SELECT id FROM pool_keys WHERE id = ? AND pool_id = ?")
        .get(Number(keyM[2]), poolId) as { id: number } | undefined;
      if (!cur) return send(res, 404, { error: "key not found" });
      if (b.label !== undefined) sdb.prepare("UPDATE pool_keys SET label = ? WHERE id = ?").run(String(b.label).slice(0, 80), Number(keyM[2]));
      if (b.api_key !== undefined) {
        if (!String(b.api_key).trim()) return send(res, 400, { error: "api_key must not be empty" });
        if (String(b.api_key).length > MAX_API_KEY_CHARS)
          return send(res, 400, { error: `api_key must be <= ${MAX_API_KEY_CHARS} characters` });
        sdb.prepare("UPDATE pool_keys SET api_key = ? WHERE id = ?").run(String(b.api_key), Number(keyM[2]));
      }
      if (b.info !== undefined) sdb.prepare("UPDATE pool_keys SET info = ? WHERE id = ?").run(String(b.info).slice(0, 200), Number(keyM[2]));
      const row = sdb
        .prepare("SELECT id, label, api_key, info, created_at FROM pool_keys WHERE id = ?")
        .get(Number(keyM[2])) as { id: number; label: string; api_key: string; info: string; created_at: string };
      send(res, 200, { id: row.id, label: row.label, masked: mask(row.api_key), info: row.info });
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
  if (req.method === "GET" && url.pathname === "/keys") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(keysPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/pools") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(poolsPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/analytics") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(analyticsPage());
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/provider/")) {
    const pid = url.pathname.slice("/provider/".length);
    if (!/^[a-z0-9-]+$/.test(pid)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(providerPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/playground") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(playgroundPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/docs") {
    res.writeHead(302, { location: DOCS_URL });
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/db/ping") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(dbPing()));
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

server.listen(PORT, HOST, () => {
  console.log(`pool-anything listening on http://${HOST}:${PORT}`);
  for (const w of startupWarnings()) console.warn(`[warn] ${w}`);
});
