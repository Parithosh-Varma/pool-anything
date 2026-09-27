import { LOGO_V, DOCS_URL, ICONS } from "./branding.js";
import { shellCss, shellNav, shellJs, sharedHeader, sharedLayoutCss } from "./shell.js";
import { tokensCss } from "./tokens.js";
import { docsComponentsCss } from "./components.js";

// Web UI pages. Server-side interpolations are LOGO_V (cache-buster), DOCS_URL,
// ICONS, and shell partials; all client-side JS runs in the browser.

// Shared client-side helpers: single source of truth for the inline <script>
// blocks below. Page templates interpolate these instead of redefining them,
// so a helper can never exist in one page and be missing in another (cf. the
// keysPage esc() outage). Chart helpers are a separate snippet so non-chart
// pages don't ship chart code. Bodies contain no backticks or ${, so they are
// safe to interpolate into the page template literals.
const clientCoreJs = `async function j(r){const t=await r.text();try{return JSON.parse(t)}catch{return t}}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
const err=t=>document.getElementById('err').textContent=t||'';
function logoSrc(img,file){if(!img)return;if(file){img.src='/logos/'+file+'?v=${LOGO_V}';img.onerror=()=>img.remove();}else img.remove();}`;

const clientChartsJs = `function fmtCompact(n) {
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
    ln.setAttribute('stroke', '#EFEAE1'); ln.setAttribute('stroke-width', '1');
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
  lp.setAttribute('d', line); lp.setAttribute('fill', 'none'); lp.setAttribute('stroke', max === 0 ? '#E8E3D9' : color);
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
}`;

export const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
  ${tokensCss}
  html { background:var(--card); }
  html { scrollbar-gutter:stable; scrollbar-width:none; -ms-overflow-style:none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display:none; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:var(--font-sans); background:var(--bg); color:var(--ink); }
  header { height:56px; background:var(--card); border-bottom:1px solid var(--line); display:flex; align-items:center; padding:0 16px; gap:8px; position:sticky; top:0; }
  header .spacer { margin-left:auto; display:flex; gap:4px; }
  header button, header a { font-size:14px; padding:6px 12px; border-radius:8px; border:0; background:inherit; color:var(--ink); text-decoration:none; cursor:pointer; }
  header button:hover, header a:hover { background:var(--paper-2); }
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
  .quick { display:flex; align-items:center; gap:12px; width:100%; height:30px; padding:0 12px; margin-bottom:12px; border-radius:8px; border:1px solid var(--line); background:var(--card); font-size:14px; color:var(--ink-soft); cursor:pointer; }
  .quick:hover { background:var(--paper-2); }
  .quick kbd { margin-left:auto; font-size:12px; color:var(--ink-soft); }
  .mi { display:flex; align-items:center; gap:10px; width:100%; min-height:34px; padding:0 12px; border-radius:8px; border:0; background:transparent; font-size:14px; font-weight:500; color:var(--ink); cursor:pointer; text-decoration:none; text-align:left; }
  .mi:hover { background:var(--paper-2); }
  .mi.active { background:var(--line-soft); }
  .mi .ic { opacity:.5; flex-shrink:0; width:16px; text-align:center; }
  .mi .ic svg { display:block; width:18px; height:18px; }
  .mi .ext { margin-left:auto; opacity:.45; display:inline-flex; flex-shrink:0; }
  .mi .chev { margin-left:auto; opacity:.4; font-size:12px; }
  .sub { position:relative; margin:0; padding:0 0 0 28px; list-style:none; display:flex; flex-direction:column; gap:1px; }
  .sub::before { content:""; position:absolute; left:19px; top:4px; bottom:4px; width:1px; background:var(--line); }
  .sub a { display:flex; flex-direction:column; padding:8px 11px; border-radius:8px; color:var(--ink); text-decoration:none; }
  .sub a:hover { background:var(--paper-2); }
  .sub b { font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sub small { font-size:10.5px; color:var(--ink-soft); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sec { margin:12px 0 8px; padding:16px 12px 8px; font-size:14px; color:var(--ink-soft); font-weight:500; border-top:1px solid var(--line); }
  .sec:first-of-type { border-top:0; }
  details.grp { margin:1px 0; }
  details.grp > summary { list-style:none; }
  details.grp > summary::-webkit-details-marker { display:none; }
  details.grp > summary .chev { transition:transform 200ms; }
  details.grp[open] > summary .chev { transform:rotate(90deg); }
  .sb-footer { height:48px; flex-shrink:0; display:flex; align-items:center; padding:0 14px; border-top:1px solid var(--line); position:sticky; bottom:0; background:var(--card); }
  .collapse-btn { width:34px; height:34px; display:grid; place-items:center; border-radius:8px; border:0; background:transparent; color:var(--ink-soft); cursor:pointer; }
  .collapse-btn:hover { background:var(--paper-2); color:var(--ink); }
  .shell.collapsed:not(.peeking) .lbl, .shell.collapsed:not(.peeking) .sb-acct span, .shell.collapsed:not(.peeking) .sb-acct svg, .shell.collapsed:not(.peeking) .quick span, .shell.collapsed:not(.peeking) .quick kbd, .shell.collapsed:not(.peeking) .mi .chev, .shell.collapsed:not(.peeking) .mi .ext, .shell.collapsed:not(.peeking) .sec, .shell.collapsed:not(.peeking) .sub { display:none; }
  .shell.collapsed:not(.peeking) .sb-header { padding:0 8px; justify-content:center; }
  .shell.collapsed:not(.peeking) .sb-acct { display:none; }
  .shell.collapsed:not(.peeking) .mi, .shell.collapsed:not(.peeking) .quick { justify-content:center; padding:0; }
  .shell.peeking { --sbw:260px; }
  .shell .lbl, .shell .sb-acct, .shell .mi .chev, .shell .sec, .shell .sub { opacity:1; transition:opacity 150ms ease; }
  .shell.closing .lbl, .shell.closing .sb-acct, .shell.closing .mi .chev, .shell.closing .sec, .shell.closing .sub { opacity:0; }
  .content { flex:1; min-width:0; display:flex; flex-direction:column; animation:pageIn .3s ease both; }
  @keyframes pageIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
  @media (max-width:720px) { .shell { --sbw:57px; } .lbl, .ext { display:none; } }
  main { min-height:calc(100vh - 56px); display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:16vh 16px 24px; }
  .wrap { width:100%; max-width:1400px; margin:0 auto; display:flex; flex-direction:column; align-items:stretch; gap:24px; padding:0 8px; }
  .hero-row, .search-card { width:100%; max-width:640px; margin-left:auto; margin-right:auto; }
  .home-grid { width:100%; display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,380px); gap:24px; align-items:start; }
  @media (min-width:901px) { .home-grid .analytics { position:sticky; top:72px; } }
  @media (max-width:900px) {
    .home-grid { grid-template-columns:1fr; }
  }
  .hero-logo { width:40px; height:40px; object-fit:contain; flex-shrink:0; }
  .hero-row { display:flex; align-items:center; justify-content:center; gap:4px; }
  .search-card { width:100%; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px; box-shadow:none; }
  .search-box { display:flex; align-items:center; gap:0; background:var(--paper-2); border:1px solid var(--line); border-radius:8px; height:34px; padding:0 4px 0 10px; box-shadow:none; }
  .search-box svg { flex-shrink:0; color:var(--ink-soft); }
  .search-box input { flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:14px; padding:0 12px; }
  .kbd { display:flex; gap:4px; padding-right:10px; }
  .kbd kbd { height:20px; min-width:20px; display:inline-flex; align-items:center; justify-content:center; padding:0 4px; font-size:12px; font-family:inherit; background:var(--card); color:var(--ink-soft); border:1px solid var(--line); border-radius:5px; }
  #results { width:100%; display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; }
  .prov { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; width:100%; min-height:76px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 6px; cursor:pointer; font-size:11px; font-weight:500; text-align:center; animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both; }
  .prov:hover { background:var(--paper-2); }
  .prov img { width:24px; height:24px; }
  .prov span { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prov small { display:none; }
  @keyframes fadeSlide { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
  dialog { border:1px solid var(--line); border-radius:12px; padding:0; max-width:640px; width:calc(100vw - 48px); font-family:inherit; overflow:hidden; }
  dialog::backdrop { background:var(--scrim); }
  .p-head { display:flex; align-items:center; gap:10px; padding:16px 20px 12px; border-bottom:1px solid var(--line); }
  .p-head img { width:28px; height:28px; }
  .p-head b { font-size:16px; }
  .pill { margin-left:auto; font-size:11px; font-weight:600; background:var(--paper-2); border-radius:999px; padding:3px 10px; white-space:nowrap; }
  .p-body { padding:12px 20px 16px; display:flex; flex-direction:column; gap:8px; }
  .p-note { font-size:12px; color:var(--ink-soft); }
  .krow { display:flex; align-items:center; gap:8px; background:var(--paper-2); border-radius:10px; padding:8px 10px; font-size:13px; animation:fadeSlide .25s ease both; }
  .krow .meta { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .krow .use { font-size:11px; color:var(--ink-soft); }
  .krow button, .p-foot button { border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:8px; height:30px; padding:0 12px; font-size:13px; cursor:pointer; }
  .slotrow { display:flex; gap:8px; }
  .slotrow input { flex:1; min-width:0; border:1px solid var(--line); border-radius:8px; height:34px; padding:0 12px; font-size:14px; }
  .slotrow button { border:1px solid var(--ink); background:var(--ink); color:var(--card); border-radius:8px; height:34px; padding:0 12px; font-size:14px; cursor:pointer; }
  .p-foot { display:flex; align-items:center; gap:8px; padding:12px 20px 16px; border-top:1px solid var(--line); font-size:12px; color:var(--ink-soft); }
  .p-foot button { margin-left:auto; }
  .perr { color:var(--danger-ink); font-size:13px; min-height:18px; }
  button:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .search-box:focus-within { border-color:transparent; box-shadow:0 0 0 1.5px var(--accent); }
  .hero-row, .search-card { max-width:400px; }
  .hero-row h1, .hero-row { gap:2px; }
  h1 { font-family:var(--font-serif); font-size:clamp(20px, 4vw, 26px); font-weight:500; }
  .sec-label { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); margin:0 0 8px; }
  .conn-grid { width:100%; display:flex; flex-direction:column; gap:8px; }
  .prov-lg { display:flex; align-items:center; gap:10px; width:100%; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px 12px; cursor:pointer; font-size:13px; font-weight:600; text-align:left; animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both; }
  .prov-lg:hover { background:var(--paper-2); }
  .prov-lg .top { display:flex; align-items:center; gap:10px; flex:1; min-width:0; }
  .prov-lg img { width:28px; height:28px; flex-shrink:0; }
  .prov-lg .nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prov-lg .meta { font-size:11px; color:var(--ink-soft); font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap; flex-shrink:0; }
  .meter { height:4px; border-radius:999px; background:var(--line); width:64px; flex-shrink:0; overflow:hidden; }
  .meter i { display:block; height:100%; background:var(--chart-blue); border-radius:999px; }
  details.browse { width:100%; background:transparent; border:0; }
  details.browse > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; color:var(--ink); padding:10px 2px; user-select:none; }
  details.browse > summary::-webkit-details-marker { display:none; }
  details.browse > summary .chev { color:var(--ink-soft); font-size:11px; transition:transform 200ms; }
  details.browse[open] > summary .chev { transform:rotate(90deg); }
  details.browse > summary .count { font-size:11px; font-weight:500; color:var(--ink-soft); }
  details.cat { width:100%; margin:2px 0 10px; }
  details.cat > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; padding:8px 2px; user-select:none; }
  details.cat > summary::-webkit-details-marker { display:none; }
  details.cat > summary .chev { color:var(--ink-soft); font-size:10px; transition:transform 200ms; }
  details.cat[open] > summary .chev { transform:rotate(90deg); }
  details.cat > summary:hover, details.browse > summary:hover { background:var(--paper-2); border-radius:8px; }
  details.cat > summary:focus-visible, details.browse > summary:focus-visible, .tips-banner > summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:8px; }
  .cat-grid { width:100%; display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; padding-bottom:4px; }
  .cat-empty { font-size:12px; color:var(--ink-soft); padding:4px 2px 12px; }
  .conn-empty { font-size:13px; color:var(--ink-soft); background:var(--card); border:1px dashed var(--line); border-radius:12px; padding:14px; }
  .conn-empty b { color:var(--ink); }
  @media (max-width:520px) { .hero-row { flex-wrap:wrap; text-align:center; } h1 { font-size:22px; } .analytics-head { flex-wrap:wrap; row-gap:8px; } }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation:none !important; transition:none !important; }
  }
  .analytics { width:100%; display:flex; flex-direction:column; gap:10px; }
  .home-grid { row-gap:0; }
  #homeLeft { gap:0 !important; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; align-self:start; }
  #homeLeft > section { margin-bottom:18px; }
  #homeLeft > section:last-child { margin-bottom:0; }
  #browseAll { border-top:1px solid var(--paper-2); padding-top:6px; }
  section[aria-label="Quick links"] { border-top:1px solid var(--line); margin:0 -18px -18px; padding:12px 18px 16px; background:var(--paper-2); border-radius:0 0 12px 12px; }
  .qlinks { display:flex; flex-direction:column; border-top:1px solid var(--paper-2); padding-top:6px; }
  .qlinks a { display:flex; align-items:center; gap:10px; padding:9px 2px; font-size:13.5px; font-weight:500; color:var(--ink); text-decoration:none; border-radius:8px; }
  .qlinks a:hover { background:var(--line-soft); }
  .qlinks a:hover .t { text-decoration:underline; text-underline-offset:2px; }
  .qlinks a .go { margin-left:auto; color:var(--ink-soft); font-size:12px; transition:transform 150ms ease; }
  .qlinks a:hover .go, .qlinks a:focus-visible .go { transform:translateX(4px); color:var(--ink); }
  .qlinks a:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .qlinks small { color:var(--ink-soft); font-weight:400; }
  .analytics-head { display:flex; align-items:center; gap:10px; }
  .analytics-head h2 { font-size:15px; font-weight:600; margin:0; }
  .analytics-controls { margin-left:auto; display:flex; align-items:center; gap:8px; }
  .range-pill { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 12px; color:var(--ink); white-space:nowrap; }
  .icon-btn { width:30px; height:30px; display:grid; place-items:center; border-radius:8px; border:1px solid transparent; background:transparent; color:var(--ink-soft); cursor:pointer; font-size:15px; }
  .icon-btn:hover { background:var(--paper-2); color:var(--ink); }
  .analytics-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .ana-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px 6px; min-width:0; overflow:hidden; transition:border-color 150ms; }
  .ana-card:hover { border-color:var(--underline); }
  .ana-card.small { padding-bottom:2px; }
  .ana-top { display:flex; align-items:center; gap:6px; }
  .ana-title { font-size:12px; color:var(--ink-soft); font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ana-dots { margin-left:auto; color:var(--ink-faint); font-size:14px; letter-spacing:1px; user-select:none; }
  .ana-value { display:flex; align-items:baseline; gap:8px; margin-top:2px; }
  .ana-value b { font-size:22px; font-weight:600; line-height:1.2; font-variant-numeric:tabular-nums; }
  .ana-card.small .ana-value b { font-size:20px; }
  .ana-delta { font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; }
  .ana-delta.up { color:var(--green-ink); }
  .ana-delta.down { color:var(--danger-ink); }
  .ana-delta.flat { color:var(--ink-soft); font-weight:500; }
  .ana-chart { position:relative; height:110px; margin:4px -6px 0; }
  .ana-card.small .ana-chart { height:78px; }
  .ana-chart svg { display:block; width:100%; height:100%; overflow:visible; }
  .ana-y { position:absolute; right:0; top:0; bottom:0; display:flex; flex-direction:column; justify-content:space-between; font-size:10px; color:var(--ink-faint); padding:2px 0 14px; pointer-events:none; font-variant-numeric:tabular-nums; }
  .chart-tip { position:absolute; display:none; z-index:5; pointer-events:none; background:var(--card); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow-md); padding:8px 10px; min-width:150px; }
  .chart-tip .tip-day { font-size:12px; font-weight:600; margin-bottom:4px; font-variant-numeric:tabular-nums; }
  .chart-tip .tip-row { display:flex; align-items:center; gap:8px; font-size:12px; }
  .chart-tip .dot { width:10px; height:10px; border-radius:999px; background:var(--chart-blue); flex-shrink:0; }
  .chart-tip .tip-val { margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; padding-left:12px; }
  .no-data { position:absolute; top:38%; left:50%; transform:translate(-50%,-50%); font-size:11px; color:var(--ink-soft); background:var(--card); border:1px solid var(--line); border-radius:999px; padding:3px 10px; white-space:nowrap; }
  .ana-card.primary .ana-value b { font-size:26px; }
  .ana-card.primary .ana-chart { height:96px; }
  .ana-cap { font-size:11px; color:var(--ink-soft); margin-top:2px; }
  .stat-list { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px 14px; }
  .stat-list .srow { display:flex; align-items:baseline; gap:8px; padding:7px 0; border-top:1px solid var(--paper-2); font-size:13px; }
  .stat-list .srow:first-child { border-top:0; }
  .stat-list .sl { color:var(--ink-soft); }
  .stat-list .sv { margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; }
  .stat-list .sv.calm { color:var(--ink-soft); font-weight:500; }
  .stat-list .sd { font-size:12px; color:var(--ink-soft); }
  .tips { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; font-size:13px; display:flex; flex-direction:column; gap:8px; }
  .tips b { font-size:13px; }
  .tips ol { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px; color:var(--body-copy); }
  .tips small { color:var(--ink-soft); }
  .tips-banner { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px 14px; font-size:13px; }
  .tips-banner > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; padding:8px 0; user-select:none; }
  .tips-banner > summary::-webkit-details-marker { display:none; }
  .tips-banner > summary .chev { color:var(--ink-soft); font-size:10px; transition:transform 200ms; }
  .tips-banner[open] > summary .chev { transform:rotate(90deg); }
  .tips-banner ol { margin:4px 0 10px; padding-left:18px; display:flex; flex-direction:column; gap:4px; color:var(--body-copy); }
  .gs-x { margin-left:auto; border:0; background:transparent; color:var(--ink-soft); cursor:pointer; font-size:12px; padding:2px 6px; border-radius:6px; }
  .gs-x:hover { background:var(--paper-2); color:var(--ink); }
  .stat-row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .stat-mini { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
  .stat-mini b { font-size:18px; font-weight:600; font-variant-numeric:tabular-nums; }
  @media (max-width:640px) { .analytics-grid { grid-template-columns:1fr 1fr; } .ana-card.span2 { grid-column:1 / -1; } }
  @media (max-width:520px) { .stat-row { grid-template-columns:1fr 1fr; } }
${docsComponentsCss}
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
    <a class="mi" href="${DOCS_URL}" target="_blank" rel="noopener" title="Opens external docs in a new tab"><span class="ic">${ICONS.docs}</span><span class="lbl">Docs</span><span class="ext">${ICONS.external}</span></a>
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
    <div id="homeLeft" style="width:100%;display:flex;flex-direction:column;gap:20px;min-width:0">
    <section id="connectedSection" aria-label="Connected providers">
      <p class="sec-label">Connected providers</p>
      <div class="conn-grid" id="connected"></div>
    </section>
    <details class="browse" id="browseAll">
      <summary><span class="chev">▶</span>Browse all providers <span class="count" id="browseCount"></span></summary>
      <div id="browseCats"></div>
    </details>
    <section aria-label="Quick links">
      <p class="sec-label">Quick links</p>
      <div class="qlinks">
        <a href="/pools"><span class="t">Pools</span> <small>usage per pool</small><span class="go">→</span></a>
        <a href="/keys"><span class="t">API key manager</span> <small>add · view · rotate</small><span class="go">→</span></a>
        <a href="/playground"><span class="t">Playground</span> <small>try a pooled key</small><span class="go">→</span></a>
      </div>
    </section>
    </div>
    <div class="analytics" id="analytics">
      <div class="analytics-head"><h2>Analytics</h2><div class="analytics-controls"><span class="range-pill">◷ Last 14 days</span><button class="icon-btn" id="gsReopen" type="button" title="Show getting started" aria-label="Show getting started" hidden>?</button><button class="icon-btn" id="anaRefresh" type="button" title="Refresh analytics" aria-label="Refresh analytics">↻</button></div></div>
      <details class="tips-banner" id="getStarted" hidden>
        <summary><span class="chev">▶</span><b>Getting started</b><button class="gs-x" id="gsHide" type="button" title="Dismiss" aria-label="Dismiss getting started">✕</button></summary>
        <ol>
          <li>Gather keys for a provider above — one per free-tier account.</li>
          <li>Point your client at <small>/api/pools/:id/proxy</small> and send a request.</li>
          <li>Come back here: usage per key shows up automatically.</li>
        </ol>
      </details>
      <div class="analytics-grid">
        <div class="ana-card primary"><div class="ana-top"><span class="ana-title">Total requests</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statRequests">—</b><span class="ana-delta flat" id="statDeltaReq"></span></div><div class="ana-chart"><svg id="chartRequests" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Total requests"></svg><div class="ana-y" id="yRequests"></div><div class="chart-tip" id="tipRequests"></div></div><div class="ana-cap">Requests served through your pools</div></div>
        <div class="ana-card primary"><div class="ana-top"><span class="ana-title">Keys pooled</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statKeys">—</b></div><div class="ana-chart"><svg id="chartKeys" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Keys pooled"></svg><div class="chart-tip" id="tipKeys"></div></div><div class="ana-cap">API keys rotating across pools</div></div>
      </div>
      <div class="stat-list" id="statList">
        <div class="srow"><span class="sl">Tokens tracked</span><span class="ana-delta flat" id="statDeltaTok"></span><span class="sv" id="statTokens">—</span></div>
        <div class="srow"><span class="sl">Pools</span><span class="sv" id="statPools">—</span></div>
        <div class="srow"><span class="sl">Keys cooling</span><span class="sd" id="statCoolingNote"></span><span class="sv" id="statCooling">—</span></div>
        <div class="srow"><span class="sl">Avg tokens / req</span><span class="sv" id="statAvg">—</span></div>
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
  const connBox = document.getElementById('connected');
  const browseAll = document.getElementById('browseAll');
  const browseCats = document.getElementById('browseCats');
  const browseCount = document.getElementById('browseCount');
  let providers = [];
  const CATS = [
    ['AI Models', ['groq','openrouter','gemini','mistral','cohere','fireworks','huggingface','together','replicate','openai','anthropic','perplexity','anyscale']],
    ['Voice & Speech', ['elevenlabs','deepgram','cartesia']],
    ['Search & Data Retrieval', ['tavily','brave-search','serper','scrapingbee']],
    ['Email & Messaging', ['resend','sendgrid','mailgun','postmark','twilio']],
    ['Business / Maps / Weather', ['finnhub','mapbox','googlemaps','openweather']],
    ['Infrastructure / Database', ['supabase','neon','upstash','turso','appwrite','cloudflare']],
  ];
  const CUSTOM_ID = 'custom';
  let connectedIds = new Set();
  let connStats = {};
  ${clientCoreJs}
  function provById(id) { return providers.find(p => p.id === id); }
  function matches(p, f) {
    if (!f) return true;
    return p.name.toLowerCase().includes(f) || p.id.includes(f);
  }
  function logoImg(p, size) {
    if (!p.logoFile) return null;
    const img = document.createElement('img'); img.alt = '';
    logoSrc(img, p.logoFile);
    return img;
  }
  async function loadProviders() {
    providers = await j(await fetch('/api/providers'));
    // Connected = providers with pools holding keys (+ per-provider usage for status).
    try {
      const pools = await j(await fetch('/api/pools'));
      const withKeys = [];
      for (const pl of (Array.isArray(pools) ? pools : [])) {
        try {
          const s = await j(await fetch('/api/pools/' + pl.id));
          if (s && !s.error && (s.keys || 0) > 0) withKeys.push(s);
        } catch {}
      }
      connectedIds = new Set(withKeys.map(s => s.provider));
      connStats = {};
      for (const st of withKeys) {
        const cur = connStats[st.provider] || { keys: 0, used: 0, quota: null };
        cur.keys += st.keys || 0;
        cur.used += (st.usedInWindow ?? st.used) || 0;
        if (st.quota !== null && st.quota !== undefined) cur.quota = (cur.quota || 0) + st.quota * (st.keys || 0);
        connStats[st.provider] = cur;
      }
    } catch { connectedIds = new Set(); connStats = {}; }
    // Browse stays collapsed by default; only expand on explicit user action (caret click or typing in search).
    browseAll.open = false;
    renderHome('');
    // Exception: /#browseAll deep-link (e.g. provider-page "← all providers" crumb) opens the canonical list.
    if (location.hash === '#browseAll') {
      browseAll.open = true;
      setTimeout(() => document.getElementById('browseAll').scrollIntoView({ block: 'start' }), 100);
    }
  }
  function cardButton(p, i, large) {
    const b = document.createElement('button');
    b.className = large ? 'prov-lg' : 'prov'; b.type = 'button'; b.title = p.name;
    b.style.animationDelay = Math.min(i * 35, 350) + 'ms';
    if (large) {
      const top = document.createElement('div'); top.className = 'top';
      const im = logoImg(p); if (im) top.appendChild(im);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name; top.appendChild(nm);
      b.appendChild(top);
      const st = connStats[p.id] || { keys: 0, used: 0, quota: null };
      const meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = st.keys + (st.keys === 1 ? ' key' : ' keys') + (st.quota ? ' · ' + st.used + ' / ' + st.quota + ' used' : st.used ? ' · ' + st.used + ' tracked' : '');
      b.appendChild(meta);
      if (st.quota) {
        const m = document.createElement('div'); m.className = 'meter';
        const fill = document.createElement('i');
        fill.style.width = Math.min(100, Math.round(st.used / st.quota * 100)) + '%';
        m.appendChild(fill); b.appendChild(m);
      }
    } else {
      const im = logoImg(p); if (im) b.appendChild(im);
      const n = document.createElement('span'); n.textContent = p.name; b.appendChild(n);
    }
    b.onclick = () => { location.href = '/provider/' + p.id; };
    return b;
  }
  function renderHome(f) {
    f = (f || '').toLowerCase();
    // Connected section.
    connBox.innerHTML = '';
    const connList = providers.filter(p => connectedIds.has(p.id) && matches(p, f));
    if (connList.length === 0) {
      const d = document.createElement('div'); d.className = 'conn-empty';
      d.innerHTML = f ? 'No connected providers match.' : '<b>No providers connected yet.</b> Pick one below to pool your first keys.';
      connBox.appendChild(d);
    } else {
      connList.forEach((p, i) => connBox.appendChild(cardButton(p, i, true)));
    }
    // Browse-all categories (custom rendered as its own tile group).
    browseCats.innerHTML = '';
    let total = 0, shown = 0;
    const groups = CATS.map(([label, ids]) => [label, ids.map(provById).filter(Boolean)]);
    const custom = provById(CUSTOM_ID);
    if (custom) groups.push(['Custom', [custom]]);
    const known = new Set(); groups.forEach(([, ps]) => ps.forEach(p => known.add(p.id)));
    const other = providers.filter(p => !known.has(p.id));
    if (other.length) groups.push(['Other', other]);
    groups.forEach(([label, ps]) => {
      const vis = ps.filter(p => matches(p, f));
      total += ps.length; shown += vis.length;
      if (f && vis.length === 0) return;
      const det = document.createElement('details'); det.className = 'cat';
      // Collapsed by default; expand only when filtering so matches are visible, otherwise wait for explicit caret click.
      det.open = Boolean(f);
      const sum = document.createElement('summary');
      const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▶';
      sum.appendChild(chev);
      const lab = document.createElement('span'); lab.className = 'sec-label'; lab.style.margin = '0'; lab.textContent = label;
      sum.appendChild(lab);
      const cnt = document.createElement('span'); cnt.className = 'count'; cnt.style.cssText = 'font-size:11px;color:var(--ink-soft)';
      cnt.textContent = vis.length + ' / ' + ps.length; sum.appendChild(cnt);
      det.appendChild(sum);
      if (vis.length === 0) {
        const e = document.createElement('div'); e.className = 'cat-empty'; e.textContent = 'Nothing here yet.'; det.appendChild(e);
      } else {
        const grid = document.createElement('div'); grid.className = 'cat-grid';
        vis.forEach((p, i) => grid.appendChild(cardButton(p, i, false)));
        det.appendChild(grid);
      }
      browseCats.appendChild(det);
    });
    browseCount.textContent = f ? shown + ' of ' + total : total + ' providers';
  }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const v = input.value.trim();
      if (v) browseAll.open = true; // typing expands browse so matches are visible
      renderHome(v);
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#connected .prov-lg, #browseCats .prov');
      if (first) first.click();
    }
  });
  ${clientChartsJs}
  async function loadAnalytics() {
    try {
      const a = await j(await fetch('/api/analytics'));
      const grid = document.getElementById('homeGrid');
      const gs = document.getElementById('getStarted');
      const gsReopen = document.getElementById('gsReopen');
      const req0 = (a.requests || 0) === 0;
      const dismissed = (() => { try { return localStorage.getItem('gs-dismissed') === '1'; } catch { return false; } })();
      // Zero usage always shows it (fresh workspace recovers automatically);
      // otherwise a collapsed banner under 10 requests, hidden beyond that.
      // Dismissal persists in localStorage; the ? control reopens it anytime.
      if (gs) {
        if (req0) { gs.hidden = false; gs.open = true; }
        else if (dismissed || (a.requests || 0) >= 10) gs.hidden = true;
        else { gs.hidden = false; gs.open = false; }
      }
      if (gsReopen) {
        gsReopen.hidden = !(!req0 && gs.hidden);
        gsReopen.onclick = () => {
          try { localStorage.removeItem('gs-dismissed'); } catch {}
          gs.hidden = false; gs.open = true;
          gsReopen.hidden = true;
          gs.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
      }
      const gsHide = document.getElementById('gsHide');
      if (gsHide) gsHide.onclick = (e) => {
        e.preventDefault();
        try { localStorage.setItem('gs-dismissed', '1'); } catch {}
        document.getElementById('getStarted').hidden = true;
      };
      if (grid) grid.style.display = '';
      const BLUE = '#3b82f6';
      document.getElementById('statRequests').textContent = fmtCompact(a.requests);
      document.getElementById('statRequests').title = String(a.requests);
      const st = document.getElementById('statTokens');
      st.textContent = fmtCompact(a.tokens); st.title = String(a.tokens);
      document.getElementById('statPools').textContent = String(a.pools);
      document.getElementById('statKeys').textContent = String(a.keys);
      document.getElementById('statKeys').title = String(a.keys);
      const cool = document.getElementById('statCooling');
      const cn = document.getElementById('statCoolingNote');
      if ((a.cooling || 0) > 0) {
        cool.textContent = String(a.cooling); cool.className = 'sv';
        cn.textContent = 'in backoff'; cn.className = 'sd';
      } else {
        cool.textContent = '—'; cool.className = 'sv calm'; cool.title = '0';
        cn.textContent = 'all healthy'; cn.className = 'sd';
      }
      document.getElementById('statAvg').textContent = String(a.avgTokens || 0);
      setDelta('statDeltaReq', a.deltaRequestsPct, 'requests, last 7 days vs prior 7 days');
      setDelta('statDeltaTok', a.deltaTokensPct, 'tokens, last 7 days vs prior 7 days');
      const days = (a.series || []).map(p => p.day);
      renderLine('chartRequests', 'tipRequests', 'yRequests', days, (a.series || []).map(p => p.requests), 'Total requests', BLUE);
      renderLine('chartKeys', 'tipKeys', null, (a.keysSeries || []).map(p => p.day), (a.keysSeries || []).map(p => p.count), 'Keys pooled', BLUE);
    } catch (e) { /* analytics is best-effort; search still works */ }
  }
  const anaRefresh = document.getElementById('anaRefresh');
  if (anaRefresh) anaRefresh.onclick = () => loadAnalytics();
  // Refresh when returning from a provider page (covers back-nav and tab switch) so newly gathered keys show up.
  window.addEventListener('pageshow', () => setTimeout(loadAnalytics, 200));
  window.addEventListener('focus', () => setTimeout(loadAnalytics, 200));
  // Deep-link from provider pages: /#browseAll opens the canonical provider list.
  window.addEventListener('hashchange', () => {
    if (location.hash === '#browseAll' && browseAll) {
      browseAll.open = true;
      setTimeout(() => document.getElementById('browseAll').scrollIntoView({ block: 'start' }), 100);
    }
  });
  loadProviders();
  loadAnalytics();
</script>
</body>
</html>`;

export function keysPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>API key manager — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans);background:var(--paper-2);color:var(--ink)}
${shellCss}
${sharedLayoutCss}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.chead{display:flex;align-items:center;gap:10px}.chead img{width:24px;height:24px}
.chead b{font-size:15px}.pill{margin-left:auto;font-size:11px;font-weight:600;background:var(--paper-2);border-radius:999px;padding:3px 10px;white-space:nowrap}
.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
input,select{border:1px solid var(--line);border-radius:8px;min-height:34px;padding:0 10px;font-size:14px;flex:1;min-width:140px}
button{border:1px solid var(--ink);background:var(--ink);color:var(--card);border-radius:8px;min-height:34px;padding:0 12px;font-size:14px;cursor:pointer}
button.ghost{background:var(--card);color:var(--ink)}button.sm{min-height:30px;font-size:12px}
ul{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
li{background:var(--paper-2);border-radius:8px;padding:8px 10px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:120px}
li small{color:var(--ink-soft)}.err{color:var(--danger-ink);font-size:13px;min-height:18px}
@media (max-width:520px){.row>*{flex:1 1 100%}}
${docsComponentsCss}
</style></head><body><div class="shell" id="shell">${shellNav("/keys")}<div class="content">${sharedHeader}<main>
<div class="wrap">
<div class="page-head"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1>API key manager</h1></div>
<a class="back" href="/">← pool search</a>
<div class="err" id="err"></div>
<div class="card"><div class="row"><select id="prov" aria-label="Provider"></select><input id="pname" placeholder="Pool name" aria-label="Pool name"/></div><div class="row"><input id="pbase" placeholder="base_url override (custom / self-host)" aria-label="Base URL override"/><input id="phead" placeholder="key header (default X-API-Key)" aria-label="Key header"/><input id="pprefix" placeholder="key prefix, e.g. Bearer " aria-label="Key prefix"/></div><div class="row"><button id="create">New pool</button></div></div>
<div id="pools" style="display:flex;flex-direction:column;gap:12px"></div>
</div>
</main><script>
let provs=[];
${clientCoreJs}
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
    const fields=(prov.keyFields&&prov.keyFields.length?prov.keyFields:['api_key']);
    const multi=!(fields.length===1&&(fields[0]==='api_key'||fields[0]==='apiToken'));
    const rowEl=document.createElement('div');rowEl.className='row';
    const inputs=fields.map(f=>{const i=document.createElement('input');i.type='password';i.autocomplete='off';i.placeholder='key '+(ks.length+1)+' — '+f;i.setAttribute('aria-label',f);rowEl.appendChild(i);return i;});
    const gatherBtn=document.createElement('button');gatherBtn.textContent='Gather';rowEl.appendChild(gatherBtn);
    const delBtn=document.createElement('button');delBtn.textContent='Delete pool';delBtn.className='ghost sm';rowEl.appendChild(delBtn);
    card.innerHTML='<div class="chead"><img alt=""/><b></b><span class="pill"></span></div><ul></ul>';
    card.appendChild(rowEl);
    logoSrc(card.querySelector('img'),prov.logoFile);
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
        li.querySelector('span').textContent=k.label+' · '+full.api_key+(full.credentials?' · '+Object.entries(full.credentials).map(([a,b])=>a+'='+b).join(' '):'');
      };
      const e=document.createElement('button');e.textContent='Edit';e.className='ghost sm';
      e.onclick=async()=>{
        const full=await j(await fetch('/api/pools/'+p.id+'/keys/'+k.id));
        if(full.error){err(full.error);return;}
        li.innerHTML='';
        const f=document.createElement('div');f.style.cssText='display:flex;gap:6px;flex:1;flex-wrap:wrap';
        f.innerHTML='<input value="'+esc(full.label)+'" style="flex:1;min-width:80px"/><input value="'+esc(full.info||'')+'" placeholder="info" style="flex:1;min-width:80px"/>';
        const credFields=(full.credentials&&Object.keys(full.credentials).length?Object.keys(full.credentials):(k.credentials&&Object.keys(k.credentials).length?Object.keys(k.credentials):['api_key']));
        const kins=credFields.map(cf=>{const i=document.createElement('input');i.type='password';i.placeholder=cf;i.value=(full.credentials&&full.credentials[cf])||(cf==='api_key'?full.api_key:'');i.style.cssText='flex:2;min-width:110px';f.appendChild(i);return i;});
        const [il,ii]=f.querySelectorAll('input');
        const sv=document.createElement('button');sv.textContent='Save';sv.className='sm';
        sv.onclick=async()=>{
          const patch={label:il.value,info:ii.value};
          if(credFields.length===1&&credFields[0]==='api_key')patch.api_key=kins[0].value;
          else patch.credentials=Object.fromEntries(credFields.map((cf,i)=>[cf,kins[i].value]));
          const r=await j(await fetch('/api/pools/'+p.id+'/keys/'+k.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(patch)}));
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
    const del=delBtn,gather=gatherBtn;
    gather.onclick=async()=>{
      err('');
      const vals=inputs.map(i=>i.value.trim());
      if(vals.some(v=>!v)){err('Paste '+(multi?'all '+fields.join(', '):'an API key')+' first.');return;}
      const payload=multi?{label:'key '+(ks.length+1),credentials:Object.fromEntries(fields.map((f,i)=>[f,vals[i]]))}:{label:'key '+(ks.length+1),api_key:vals[0]};
      const r=await j(await fetch('/api/pools/'+p.id+'/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
      if(r.error){err(r.error);return;}
      refresh();
    };
    inputs.forEach(i=>i.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();gather.onclick();}}));
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

export function analyticsPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Analytics — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans);background:var(--paper-2);color:var(--ink)}
${shellCss}
${sharedLayoutCss}
.row{display:flex;gap:8px;align-items:center}
.analytics { width:100%; display:flex; flex-direction:column; gap:10px; }
.analytics-head { display:flex; align-items:center; gap:10px; }
.analytics-head h2 { font-size:15px; font-weight:600; margin:0; }
.analytics-controls { margin-left:auto; display:flex; align-items:center; gap:8px; }
.range-pill { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 12px; color:var(--ink); white-space:nowrap; }
.icon-btn { width:30px; height:30px; display:grid; place-items:center; border-radius:8px; border:1px solid transparent; background:transparent; color:var(--ink-soft); cursor:pointer; font-size:15px; }
.icon-btn:hover { background:var(--paper-2); color:var(--ink); }
.analytics-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.ana-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px 6px; min-width:0; overflow:hidden; transition:border-color 150ms; }
.ana-card:hover { border-color:var(--underline); }
.ana-top { display:flex; align-items:center; gap:6px; }
.ana-title { font-size:12px; color:var(--ink-soft); font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ana-dots { margin-left:auto; color:var(--ink-faint); font-size:14px; letter-spacing:1px; user-select:none; }
.ana-value { display:flex; align-items:baseline; gap:8px; margin-top:2px; }
.ana-value b { font-size:22px; font-weight:600; line-height:1.2; font-variant-numeric:tabular-nums; }
.ana-delta { font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; }
.ana-delta.up { color:var(--green-ink); }
.ana-delta.down { color:var(--danger-ink); }
.ana-delta.flat { color:var(--ink-soft); font-weight:500; }
.ana-chart { position:relative; height:110px; margin:4px -6px 0; }
.ana-chart svg { display:block; width:100%; height:100%; overflow:visible; }
.ana-y { position:absolute; right:0; top:0; bottom:0; display:flex; flex-direction:column; justify-content:space-between; font-size:10px; color:var(--ink-faint); padding:2px 0 14px; pointer-events:none; font-variant-numeric:tabular-nums; }
.chart-tip { position:absolute; display:none; z-index:5; pointer-events:none; background:var(--card); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow-md); padding:8px 10px; min-width:150px; }
.chart-tip .tip-day { font-size:12px; font-weight:600; margin-bottom:4px; font-variant-numeric:tabular-nums; }
.chart-tip .tip-row { display:flex; align-items:center; gap:8px; font-size:12px; }
.chart-tip .dot { width:10px; height:10px; border-radius:999px; background:var(--chart-blue); flex-shrink:0; }
.chart-tip .tip-val { margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; padding-left:12px; }
.no-data { position:absolute; top:38%; left:50%; transform:translate(-50%,-50%); font-size:11px; color:var(--ink-soft); background:var(--card); border:1px solid var(--line); border-radius:999px; padding:3px 10px; white-space:nowrap; }
.ana-card.primary .ana-value b { font-size:26px; }
.ana-card.primary .ana-chart { height:96px; }
.ana-cap { font-size:11px; color:var(--ink-soft); margin-top:2px; }
.stat-list { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px 14px; }
.stat-list .srow { display:flex; align-items:baseline; gap:8px; padding:7px 0; border-top:1px solid var(--paper-2); font-size:13px; }
.stat-list .srow:first-child { border-top:0; }
.stat-list .sl { color:var(--ink-soft); }
.stat-list .sv { margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; }
.stat-list .sv.calm { color:var(--ink-soft); font-weight:500; }
.stat-list .sd { font-size:12px; color:var(--ink-soft); }
.tips-banner { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px 14px; font-size:13px; }
.tips-banner > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; padding:8px 0; user-select:none; }
.tips-banner > summary::-webkit-details-marker { display:none; }
.tips-banner > summary .chev { color:var(--ink-soft); font-size:10px; transition:transform 200ms; }
.tips-banner[open] > summary .chev { transform:rotate(90deg); }
.tips-banner ol { margin:4px 0 10px; padding-left:18px; display:flex; flex-direction:column; gap:4px; color:var(--body-copy); }
.gs-x { margin-left:auto; border:0; background:transparent; color:var(--ink-soft); cursor:pointer; font-size:12px; padding:2px 6px; border-radius:6px; }
.gs-x:hover { background:var(--paper-2); color:var(--ink); }
@media (max-width:640px) { .analytics-grid { grid-template-columns:1fr 1fr; } }
${docsComponentsCss}
</style></head><body><div class="shell" id="shell">${shellNav("/analytics")}<div class="content">${sharedHeader}<main>
<div class="wrap">
<div class="page-head"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1>Analytics</h1></div>
<a class="back" href="/">← pool search</a>
<div class="analytics" id="analytics">
  <div class="analytics-head"><div class="analytics-controls"><span class="range-pill">◷ Last 14 days</span><button class="icon-btn" id="gsReopen" type="button" title="Show getting started" aria-label="Show getting started" hidden>?</button><button class="icon-btn" id="anaRefresh" type="button" title="Refresh analytics" aria-label="Refresh analytics">↻</button></div></div>
  <details class="tips-banner" id="getStarted" hidden>
    <summary><span class="chev">▶</span><b>Getting started</b><button class="gs-x" id="gsHide" type="button" title="Dismiss" aria-label="Dismiss getting started">✕</button></summary>
    <ol>
      <li>Gather keys for a provider on <a href="/">home</a> — one per free-tier account.</li>
      <li>Point your client at <small>/api/pools/:id/proxy</small> and send a request.</li>
      <li>Come back here: usage per key shows up automatically.</li>
    </ol>
  </details>
  <div class="analytics-grid">
    <div class="ana-card primary"><div class="ana-top"><span class="ana-title">Total requests</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statRequests">—</b><span class="ana-delta flat" id="statDeltaReq"></span></div><div class="ana-chart"><svg id="chartRequests" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Total requests"></svg><div class="ana-y" id="yRequests"></div><div class="chart-tip" id="tipRequests"></div></div><div class="ana-cap">Requests served through your pools</div></div>
    <div class="ana-card primary"><div class="ana-top"><span class="ana-title">Keys pooled</span><span class="ana-dots">…</span></div><div class="ana-value"><b id="statKeys">—</b></div><div class="ana-chart"><svg id="chartKeys" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Keys pooled"></svg><div class="chart-tip" id="tipKeys"></div></div><div class="ana-cap">API keys rotating across pools</div></div>
  </div>
  <div class="stat-list" id="statList">
    <div class="srow"><span class="sl">Tokens tracked</span><span class="ana-delta flat" id="statDeltaTok"></span><span class="sv" id="statTokens">—</span></div>
    <div class="srow"><span class="sl">Pools</span><span class="sv" id="statPools">—</span></div>
    <div class="srow"><span class="sl">Keys cooling</span><span class="sd" id="statCoolingNote"></span><span class="sv" id="statCooling">—</span></div>
    <div class="srow"><span class="sl">Avg tokens / req</span><span class="sv" id="statAvg">—</span></div>
  </div>
</div>
</div>
</main><script>
${clientCoreJs}
${clientChartsJs}
async function loadAnalytics() {
  try {
    const a = await j(await fetch('/api/analytics'));
    const gs = document.getElementById('getStarted');
    const gsReopen = document.getElementById('gsReopen');
    const req0 = (a.requests || 0) === 0;
    const dismissed = (() => { try { return localStorage.getItem('gs-dismissed') === '1'; } catch { return false; } })();
    if (gs) {
      if (req0) { gs.hidden = false; gs.open = true; }
      else if (dismissed || (a.requests || 0) >= 10) gs.hidden = true;
      else { gs.hidden = false; gs.open = false; }
    }
    if (gsReopen) {
      gsReopen.hidden = !(!req0 && gs.hidden);
      gsReopen.onclick = () => {
        try { localStorage.removeItem('gs-dismissed'); } catch {}
        gs.hidden = false; gs.open = true;
        gsReopen.hidden = true;
        gs.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    }
    const gsHide = document.getElementById('gsHide');
    if (gsHide) gsHide.onclick = (e) => {
      e.preventDefault();
      try { localStorage.setItem('gs-dismissed', '1'); } catch {}
      document.getElementById('getStarted').hidden = true;
    };
    const BLUE = '#3b82f6';
    document.getElementById('statRequests').textContent = fmtCompact(a.requests);
    document.getElementById('statRequests').title = String(a.requests);
    const st = document.getElementById('statTokens');
    st.textContent = fmtCompact(a.tokens); st.title = String(a.tokens);
    document.getElementById('statPools').textContent = String(a.pools);
    document.getElementById('statKeys').textContent = String(a.keys);
    document.getElementById('statKeys').title = String(a.keys);
    const cool = document.getElementById('statCooling');
    const cn = document.getElementById('statCoolingNote');
    if ((a.cooling || 0) > 0) {
      cool.textContent = String(a.cooling); cool.className = 'sv';
      cn.textContent = 'in backoff'; cn.className = 'sd';
    } else {
      cool.textContent = '—'; cool.className = 'sv calm'; cool.title = '0';
      cn.textContent = 'all healthy'; cn.className = 'sd';
    }
    document.getElementById('statAvg').textContent = String(a.avgTokens || 0);
    setDelta('statDeltaReq', a.deltaRequestsPct, 'requests, last 7 days vs prior 7 days');
    setDelta('statDeltaTok', a.deltaTokensPct, 'tokens, last 7 days vs prior 7 days');
    const days = (a.series || []).map(p => p.day);
    renderLine('chartRequests', 'tipRequests', 'yRequests', days, (a.series || []).map(p => p.requests), 'Total requests', BLUE);
    renderLine('chartKeys', 'tipKeys', null, (a.keysSeries || []).map(p => p.day), (a.keysSeries || []).map(p => p.count), 'Keys pooled', BLUE);
  } catch (e) { /* analytics is best-effort */ }
}
const anaRefresh = document.getElementById('anaRefresh');
if (anaRefresh) anaRefresh.onclick = () => loadAnalytics();
window.addEventListener('pageshow', () => setTimeout(loadAnalytics, 200));
window.addEventListener('focus', () => setTimeout(loadAnalytics, 200));
loadAnalytics();
</script></div></div>${shellJs}</body></html>`;
}

export function poolsPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Pools — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans);background:var(--paper-2);color:var(--ink)}
${shellCss}
${sharedLayoutCss}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
.chead{display:flex;align-items:center;gap:10px}.chead img{width:24px;height:24px}
.chead b{font-size:15px}.pill{margin-left:auto;font-size:11px;font-weight:600;background:var(--paper-2);border-radius:999px;padding:3px 10px;white-space:nowrap}
.row{display:flex;gap:8px;align-items:center}
ul{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
li{background:var(--paper-2);border-radius:8px;padding:8px 10px;font-size:13px;display:flex;gap:8px;align-items:center}
li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li small{color:var(--ink-soft)}
a.manage{font-size:13px}
.empty{color:var(--ink-soft);font-size:14px;text-align:center;padding:24px 0}
${docsComponentsCss}
</style></head><body><div class="shell" id="shell">${shellNav("/pools")}<div class="content">${sharedHeader}<main>
<div class="wrap">
<div class="page-head"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1>Pools</h1></div>
<a class="back" href="/">← pool search</a>
<div id="pools" style="display:flex;flex-direction:column;gap:12px"></div>
</div>
</main><script>
${clientCoreJs}
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
    logoSrc(card.querySelector('img'),prov.logoFile);
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

export function playgroundPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Playground — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans);background:var(--paper-2);color:var(--ink)}
${shellCss}
${sharedLayoutCss}
.pg-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pg-top .spacer{flex:1}
.seg{display:inline-flex;background:var(--line-soft);border-radius:999px;padding:2px}
.seg button{border:0;background:none;border-radius:999px;padding:5px 16px;font-size:13px;cursor:pointer;color:var(--ink-soft);font-family:inherit}
.seg button.on{background:var(--card);box-shadow:var(--shadow-sm);color:var(--ink);font-weight:600}
.ctl{border:1px solid var(--line);border-radius:8px;min-height:34px;padding:0 10px;font-size:13px;background:var(--card);color:var(--ink);font-family:inherit}
select.ctl{max-width:220px}input.ctl.model{min-width:220px}
.btn{border:1px solid var(--line);background:var(--card);border-radius:8px;min-height:34px;padding:0 12px;font-size:13px;cursor:pointer;color:var(--ink);font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.btn:hover{background:var(--paper-2)}
.pg-grid{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:16px;align-items:start;min-height:560px}
.pg-grid.nocode{grid-template-columns:minmax(0,1fr)}
.chat{display:flex;flex-direction:column;gap:12px;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;min-height:560px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
.code{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;display:flex;flex-direction:column;min-width:0;min-height:560px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
.pg-grid.nocode .code{display:none}
.pg-grid[hidden],.studio[hidden]{display:none}
@media (max-width:900px){.pg-grid{grid-template-columns:1fr}}
.fld label{display:block;font-size:11px;letter-spacing:.05em;color:var(--ink-soft);font-weight:600;margin-bottom:4px}
.ghost{width:100%;border:0;background:transparent;outline:0;resize:vertical;font:inherit;font-size:14px;color:var(--ink);padding:2px 0;min-height:24px}
.msg{background:var(--paper-2);border-radius:12px;padding:12px 14px}
.msg.assistant{background:var(--card);border:1px solid var(--line)}
.msg.assistant.err{border-color:var(--danger-line);background:var(--danger-bg)}
.msg .body{font-size:14px;white-space:pre-wrap;word-break:break-word}
.msg .who{display:block;font-size:11px;letter-spacing:.05em;color:var(--ink-soft);font-weight:600;margin-bottom:4px}
.chat-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:12px}
.iconbtn{border:1px solid var(--line);background:var(--card);border-radius:8px;min-width:32px;height:30px;cursor:pointer;font-size:15px;color:var(--ink)}
.submit{margin:0 auto;border:1px solid var(--danger-ink);background:var(--card);border-radius:999px;padding:8px 24px;font-weight:600;font-size:14px;cursor:pointer;color:var(--ink);box-shadow:0 0 0 3px var(--danger-ring);font-family:inherit;display:inline-flex;align-items:center;gap:8px}
.submit:disabled{opacity:.5;cursor:wait}
.submit .hint{font-size:11px;color:var(--ink-faint);font-weight:400}
details.params{font-size:13px}
details.params summary{cursor:pointer;color:var(--ink-soft);font-size:12px}
.params-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px}
.params-grid label{font-size:11px;color:var(--ink-soft);display:flex;flex-direction:column;gap:4px}
.code-head{display:flex;align-items:center;gap:8px;padding:0 0 10px;border-bottom:1px solid var(--line);margin-bottom:12px}
.code-head .spacer{flex:1}
.code pre{margin:0;padding:0;font-family:var(--font-mono);font-size:12.5px;line-height:1.65;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word}
.k{color:var(--tok-kw)}.s{color:var(--tok-str)}.n{color:var(--warn-ink)}.fn{color:var(--link-ink)}.c{color:var(--code-com)}
.err{color:var(--danger-ink);font-size:13px;min-height:18px}
.studio{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:4px}
.gal figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--paper-2)}
.gal img{width:100%;display:block;aspect-ratio:1;object-fit:cover}
.gal figcaption{font-size:11px;color:var(--ink-soft);padding:8px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attach-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.attach-row .filebtn{border:1px solid var(--line);background:var(--card);border-radius:8px;min-height:30px;padding:0 10px;font-size:12.5px;cursor:pointer;color:var(--ink);font-family:inherit}
.attach-row .filebtn:hover{background:var(--paper-2)}
.attach-row .filebtn.off{opacity:.4;cursor:not-allowed}
.cap-note{font-size:12.5px;color:var(--warn-ink);background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:8px 10px}
.cap-note.ok{color:var(--green-ink);background:var(--green-bg);border-color:var(--green-line)}
.mprev{display:flex;gap:8px;flex-wrap:wrap}
.mprev .thumb{position:relative;width:88px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--paper-2)}
.mprev .thumb img{width:100%;height:64px;object-fit:cover;display:block}
.mprev .thumb .tag{font-size:10px;color:var(--ink-soft);padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mprev .thumb audio{width:100%;height:30px}
.mprev .thumb button{position:absolute;top:2px;right:2px;border:0;background:var(--overlay-strong);color:var(--card);border-radius:6px;font-size:11px;cursor:pointer;padding:1px 6px}
.modes{display:inline-flex;background:var(--line-soft);border-radius:999px;padding:2px}
.modes button{border:0;background:none;border-radius:999px;padding:5px 14px;font-size:12.5px;cursor:pointer;color:var(--ink-soft);font-family:inherit}
.modes button.on{background:var(--card);box-shadow:var(--shadow-sm);color:var(--ink);font-weight:600}
.modes button.off{opacity:.4;cursor:not-allowed}
.media-out{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.media-out audio,.media-out video{width:100%;border-radius:10px;background:var(--code-dark)}
.media-out .dl{font-size:13px;color:var(--ink)}
${docsComponentsCss}
</style></head><body><div class="shell" id="shell">${shellNav("/playground")}<div class="content">${sharedHeader}<main>
<div class="wrap">
<div class="page-head"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1>Playground</h1></div>
<a class="back" href="/">← pool search</a>
<div class="pg-top">
<div class="seg"><button id="tabChat" class="on" type="button">Chat</button><button id="tabStudio" type="button">Studio</button></div>
<div class="spacer"></div>
<select class="ctl" id="pool" aria-label="Pool"></select>
<input class="ctl model" id="model" value="" placeholder="model id" aria-label="Model" spellcheck="false" autocomplete="off"/>
<button class="btn" id="copyTop" type="button" title="Copy code">⧉</button>
<button class="btn" id="hideCode" type="button">&lt;/&gt; Hide code</button>
</div>
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
<div class="attach-row" id="attachRow">
<button class="filebtn" id="attachImg" type="button" title="Attach image (png/jpg/webp)">🖼 Image</button>
<button class="filebtn" id="attachAudio" type="button" title="Attach audio">🎙 Audio</button>
<button class="filebtn" id="attachVideo" type="button" title="Attach video (Gemini video models)">🎬 Video</button>
<button class="filebtn" id="recAudio" type="button" title="Record audio with microphone">● Rec</button>
<input type="file" id="fileImg" accept="image/png,image/jpeg,image/webp" hidden/>
<input type="file" id="fileAudio" accept="audio/*" hidden/>
<input type="file" id="fileVideo" accept="video/mp4,video/webm" hidden/>
</div>
<div class="mprev" id="mediaPrev"></div>
<div class="cap-note" id="capNote" hidden></div>
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
<div class="modes" id="studioModes" role="tablist" aria-label="Studio mode">
<button id="modeImage" class="on" type="button">Image</button><button id="modeAudio" type="button">Audio</button><button id="modeVideo" type="button">Video</button>
</div>
<div class="cap-note" id="studioNote" hidden style="margin-top:10px"></div>
<div id="studioImage">
<div class="fld" style="margin-top:12px"><label>PROMPT</label><textarea class="ghost" id="imgPrompt" rows="2" placeholder="Describe the image you want to generate..."></textarea></div>
<div class="params-grid" style="margin-top:12px">
<label>Model<input class="ctl" id="imgModel" value="" placeholder="image model id" spellcheck="false" autocomplete="off"/></label>
<label>Size<select class="ctl" id="imgSize"><option>1024x1024</option><option>1792x1024</option><option>1024x1792</option><option>512x512</option></select></label>
</div>
<div class="chat-foot" style="justify-content:center">
<button class="submit" id="generate" type="button">Generate <span class="hint">⌘↵</span></button>
</div>
<div class="gal" id="gallery"></div>
</div>
<div id="studioAudio" hidden>
<div class="fld" style="margin-top:12px"><label>TEXT TO SPEAK</label><textarea class="ghost" id="audText" rows="2" placeholder="Text for TTS / audio generation..."></textarea></div>
<div class="params-grid" style="margin-top:12px">
<label>Model<input class="ctl" id="audModel" value="" placeholder="audio model id" spellcheck="false" autocomplete="off"/></label>
<label>Voice<input class="ctl" id="audVoice" value="alloy" spellcheck="false" autocomplete="off"/></label>
<label>Format<select class="ctl" id="audFormat"><option>mp3</option><option>wav</option><option>opus</option></select></label>
</div>
<div class="chat-foot" style="justify-content:center">
<button class="submit" id="genAudio" type="button">Synthesize <span class="hint">⌘↵</span></button>
</div>
<div class="media-out" id="audioOut"></div>
</div>
<div id="studioVideo" hidden>
<div class="fld" style="margin-top:12px"><label>PROMPT</label><textarea class="ghost" id="vidPrompt" rows="2" placeholder="Describe the video you want to generate..."></textarea></div>
<div class="params-grid" style="margin-top:12px">
<label>Model<input class="ctl" id="vidModel" value="" placeholder="video model id" spellcheck="false" autocomplete="off"/></label>
<label>Duration<select class="ctl" id="vidDur"><option>4s</option><option>8s</option><option>12s</option></select></label>
<label>Resolution<select class="ctl" id="vidRes"><option>720p</option><option>1080p</option><option>480p</option></select></label>
</div>
<div class="chat-foot" style="justify-content:center">
<button class="submit" id="genVideo" type="button">Generate video <span class="hint">⌘↵</span></button>
</div>
<div class="media-out" id="videoOut"></div>
</div>
</div>
</div>
</main><script>
${clientCoreJs}
const MODELS={groq:'openai/gpt-oss-120b',openai:'gpt-4o-mini',openrouter:'meta-llama/llama-3.3-70b-instruct:free',mistral:'mistral-small-latest',fireworks:'accounts/fireworks/models/llama-v3p3-70b-instruct',together:'meta-llama/Llama-3.3-70B-Instruct-Turbo',gemini:'gemini-2.0-flash',anthropic:'claude-sonnet-4-20250514',perplexity:'sonar',cohere:'command-r',replicate:'ibm-granite/granite-3.3-8b-instruct',huggingface:'meta-llama/Llama-3.3-70B-Instruct',deepgram:'nova-3',elevenlabs:'eleven_multilingual_v2',cartesia:'sonic-2',tavily:'tavily-search',anyscale:'meta-llama/Llama-3.3-70B-Instruct'};
const IMG_MODELS={openai:'gpt-image-1',together:'FLUX.1-schnell',fireworks:'accounts/fireworks/models/flux-1-schnell',replicate:'black-forest-labs/flux-schnell',huggingface:'black-forest-labs/FLUX.1-schnell',openrouter:'black-forest-labs/flux-1-schnell:free',gemini:'imagen-3.0-generate-002',mistral:'mistral-medium'};
const AUD_MODELS={openai:'tts-1',elevenlabs:'eleven_multilingual_v2',cartesia:'sonic-2',deepgram:'aura-2-thalia-en',gemini:'gemini-2.5-flash-preview-tts'};
const VID_MODELS={gemini:'veo-3.0-generate-001',replicate:'stability-ai/stable-video-diffusion'};
const CAPS={openai:{vision:1,audioIn:1,videoIn:0,imageOut:1,audioOut:1,videoOut:0},anthropic:{vision:1,audioIn:0,videoIn:0,imageOut:0,audioOut:0,videoOut:0},gemini:{vision:1,audioIn:1,videoIn:1,imageOut:1,audioOut:1,videoOut:1},groq:{vision:1,audioIn:1,videoIn:0,imageOut:0,audioOut:0,videoOut:0},openrouter:{vision:1,audioIn:0,videoIn:0,imageOut:1,audioOut:0,videoOut:0},mistral:{vision:1,audioIn:0,videoIn:0,imageOut:0,audioOut:0,videoOut:0},fireworks:{vision:1,audioIn:0,videoIn:0,imageOut:1,audioOut:0,videoOut:0},together:{vision:1,audioIn:0,videoIn:0,imageOut:1,audioOut:0,videoOut:0},huggingface:{vision:1,audioIn:0,videoIn:0,imageOut:1,audioOut:0,videoOut:0},replicate:{vision:1,audioIn:0,videoIn:0,imageOut:1,audioOut:0,videoOut:1},perplexity:{vision:1,audioIn:0,videoIn:0,imageOut:0,audioOut:0,videoOut:0},cohere:{vision:1,audioIn:0,videoIn:0,imageOut:0,audioOut:0,videoOut:0},elevenlabs:{vision:0,audioIn:0,videoIn:0,imageOut:0,audioOut:1,videoOut:0},deepgram:{vision:0,audioIn:1,videoIn:0,imageOut:0,audioOut:1,videoOut:0},cartesia:{vision:0,audioIn:0,videoIn:0,imageOut:0,audioOut:1,videoOut:0}};
const NO_VISION_RE=/tts|whisper|transcri|embed|image|flux|diffusion|imagen|dall|sonic|nova|stt|audit/i;
function capsFor(prov,model){
  const b=CAPS[prov]||{vision:0,audioIn:0,videoIn:0,imageOut:0,audioOut:0,videoOut:0};
  const c={vision:b.vision,audioIn:b.audioIn,videoIn:b.videoIn,imageOut:b.imageOut,audioOut:b.audioOut,videoOut:b.videoOut};
  if(!model)return c;
  const m=String(model).toLowerCase();
  if(/embed/.test(m)){c.vision=0;c.audioIn=0;c.videoIn=0;c.imageOut=0;c.audioOut=0;c.videoOut=0;return c;}
  if(/image|flux|diffusion|imagen|dall|stable|midjourney/.test(m)){c.vision=0;c.audioIn=0;c.videoIn=0;return c;}
  if(/video|veo|pika|runway|sora/.test(m)){c.vision=0;c.audioIn=0;c.videoIn=0;return c;}
  if(/tts|sonic|eleven/.test(m)){c.vision=0;c.audioIn=0;c.videoIn=0;return c;}
  if(/whisper|transcri|^nova|stt/.test(m)){c.vision=0;c.videoIn=0;return c;}
  if(NO_VISION_RE.test(m))c.vision=0;
  return c;
}
function curProv(){return window._pgPmap ? (window._pgPmap[document.getElementById('pool').value]||'') : '';}
function gateNote(cap,prov,model){
  const label=cap==='vision'?'image input':cap==='audioIn'?'audio input':cap==='videoIn'?'video input':cap==='imageOut'?'image output':cap==='audioOut'?'audio output':'video output';
  return 'this model doesn'+String.fromCharCode(39)+'t support '+label+' ('+prov+' '+(model||'default model')+')';
}
const IMG_MIMES=['image/png','image/jpeg','image/webp'];
const AUD_MIMES=['audio/mpeg','audio/wav','audio/webm','audio/ogg','audio/mp4'];
const VID_MIMES=['video/mp4','video/webm'];
const MAX_MEDIA_BYTES=8000000;
let pendingMedia=[];
function fmtKB(n){return Math.round(n/1024)+'KB';}
function renderMediaPrev(){
  const box=document.getElementById('mediaPrev');box.innerHTML='';
  pendingMedia.forEach(function(a,i){
    const d=document.createElement('div');d.className='thumb';
    if(a.kind==='image'){const im=document.createElement('img');im.src='data:'+a.mime+';base64,'+a.b64;im.alt=a.name;d.appendChild(im);}
    else if(a.kind==='audio'){const au=document.createElement('audio');au.controls=true;au.src='data:'+a.mime+';base64,'+a.b64;d.appendChild(au);}
    else{const v=document.createElement('video');v.controls=true;v.muted=true;v.preload='metadata';v.src='data:'+a.mime+';base64,'+a.b64;v.style.cssText='width:100%;height:64px;object-fit:cover;display:block';d.appendChild(v);}
    const t=document.createElement('div');t.className='tag';t.textContent=a.kind+' '+fmtKB(Math.round(a.b64.length*0.75));d.appendChild(t);
    const x=document.createElement('button');x.type='button';x.textContent='x';x.title='Remove';
    x.onclick=function(){pendingMedia.splice(i,1);renderMediaPrev();updateMediaUI();updateCode();};
    d.appendChild(x);box.appendChild(d);
  });
}
function addMediaFile(file,kind){
  err('');
  const okMimes=kind==='image'?IMG_MIMES:kind==='audio'?AUD_MIMES:VID_MIMES;
  if(okMimes.indexOf(file.type)<0){err('Unsupported '+kind+' type: '+(file.type||'unknown')+'.');return;}
  if(file.size>MAX_MEDIA_BYTES){err(kind+' file too large (max 8MB).');return;}
  const rd=new FileReader();
  rd.onload=function(){
    const s=String(rd.result||'');
    const b64=s.indexOf(',')>=0?s.slice(s.indexOf(',')+1):s;
    pendingMedia.push({kind:kind,mime:file.type,b64:b64,name:file.name});
    renderMediaPrev();updateMediaUI();updateCode();
  };
  rd.onerror=function(){err('Could not read '+kind+' file.');};
  rd.readAsDataURL(file);
}
function updateMediaUI(){
  const prov=curProv(),model=document.getElementById('model').value.trim();
  const c=capsFor(prov,model);
  const note=document.getElementById('capNote');
  const bi=document.getElementById('attachImg'),ba=document.getElementById('attachAudio'),bv=document.getElementById('attachVideo'),br=document.getElementById('recAudio');
  const setBtn=function(b,on){b.classList.toggle('off',!on);b.disabled=!on;};
  setBtn(bi,!!c.vision);setBtn(ba,!!c.audioIn);setBtn(bv,!!c.videoIn);setBtn(br,!!c.audioIn);
  const bad=pendingMedia.filter(function(a){return (a.kind==='image'&&!c.vision)||(a.kind==='audio'&&!c.audioIn)||(a.kind==='video'&&!c.videoIn);});
  if(bad.length){
    note.hidden=false;note.className='cap-note';
    note.textContent=gateNote(bad[0].kind==='image'?'vision':bad[0].kind==='audio'?'audioIn':'videoIn',prov,model);
  }else if(pendingMedia.length){
    note.hidden=false;note.className='cap-note ok';
    note.textContent=pendingMedia.length+' attachment(s) ready — included in request + code snippet.';
  }else if(!c.vision&&!c.audioIn&&!c.videoIn){
    note.hidden=false;note.className='cap-note';
    note.textContent=gateNote('vision',prov,model)+' — text-only for this model.';
  }else{note.hidden=true;note.textContent='';}
}
function openAiParts(text,media){
  const parts=[{type:'text',text:text}];
  media.forEach(function(a){
    if(a.kind==='image')parts.push({type:'image_url',image_url:{url:'data:'+a.mime+';base64,'+a.b64}});
    else if(a.kind==='audio'){const f=a.mime.indexOf('wav')>=0?'wav':'mp3';parts.push({type:'input_audio',input_audio:{data:a.b64,format:f}});}
    else parts.push({type:'text',text:'[video '+a.mime+' base64 length '+a.b64.length+']'});
  });
  return parts;
}
function anthropicBlocks(text,media){
  const blocks=[{type:'text',text:text}];
  media.forEach(function(a){
    if(a.kind==='image')blocks.push({type:'image',source:{type:'base64',media_type:a.mime,data:a.b64}});
  });
  return blocks;
}
function chatContentFor(prov,text,media){
  if(!media.length)return text;
  if(prov==='anthropic'){
    const nonImg=media.filter(function(a){return a.kind!=='image';});
    if(nonImg.length)return null;
    return anthropicBlocks(text,media);
  }
  return openAiParts(text,media);
}
let lastDefault='';
let lastImgDefault='⌁';
let lastAudDefault='⌁';
let lastVidDefault='⌁';
let mediaRecorder=null,recChunks=[],recording=false;
async function toggleRec(){
  const btn=document.getElementById('recAudio');
  if(recording&&mediaRecorder){mediaRecorder.stop();return;}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){err('Microphone not available in this browser.');return;}
  if(!window.MediaRecorder){err('MediaRecorder not supported — upload an audio file instead.');return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    recChunks=[];
    mediaRecorder=new MediaRecorder(stream);
    mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)recChunks.push(e.data);};
    mediaRecorder.onstop=()=>{
      recording=false;btn.textContent='● Rec';
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(recChunks,{type:mediaRecorder.mimeType||'audio/webm'});
      const f=new File([blob],'recording.'+(blob.type.indexOf('mp4')>=0?'mp4':'webm'),{type:blob.type||'audio/webm'});
      addMediaFile(f,'audio');
      mediaRecorder=null;
    };
    mediaRecorder.start();recording=true;btn.textContent='■ Stop';
    err('');
  }catch{err('Microphone permission denied.');}
}
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
  const prov=curProv();
  let mediaAttached=false;
  document.getElementById('turns').childNodes.forEach(n=>{
    if(n.className&&n.className.indexOf('uturn')>=0){
      const t=n.dataset.locked?(n.dataset.content||''):n.querySelector('textarea').value;
      if(!t.trim()&&!pendingMedia.length)return;
      if(!t.trim()){out.push({role:'user',content:chatContentFor(prov,'(attached media)',pendingMedia)});mediaAttached=true;return;}
      if(pendingMedia.length&&!mediaAttached){
        const c=chatContentFor(prov,t,pendingMedia);
        out.push({role:'user',content:c===null?t:c});
        mediaAttached=true;
      }
      else if(t.trim())out.push({role:'user',content:t});
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
function pyStr(s){return esc(JSON.stringify(s));}
function isStudio(){return document.getElementById('tabStudio').classList.contains('on');}
function updateCode(){
  if(isStudio()){updateStudioCode();return;}
  const p=params(),msgs=collectMessages();
  const pid=document.getElementById('pool').value||'1';
  const url=location.origin+'/api/pools/'+pid+'/proxy';
  const lang=document.getElementById('codeLang').value;
  const prov=curProv(),model=p.model;
  const c=capsFor(prov,model);
  const bad=pendingMedia.filter(function(a){return (a.kind==='image'&&!c.vision)||(a.kind==='audio'&&!c.audioIn)||(a.kind==='video'&&!c.videoIn);});
  if(pendingMedia.length&&bad.length){
    const note=gateNote(bad[0].kind==='image'?'vision':bad[0].kind==='audio'?'audioIn':'videoIn',prov,model);
    rawSnippet='# '+note+'\\n# Remove the '+bad[0].kind+' attachment or switch to a capable model.\\n';
    document.getElementById('code').innerHTML='<span class="c">'+esc(rawSnippet)+'</span>';
    return;
  }
  const body={model:p.model,messages:msgs,temperature:p.temp,max_tokens:p.maxtokens,top_p:p.topp};
  const shortMsgs=JSON.stringify(msgs,function(k,v){return k==='data'&&typeof v==='string'&&v.length>64?v.slice(0,64)+'…<base64 '+v.length+' chars>':k==='url'&&typeof v==='string'&&v.indexOf('base64,')>=0?v.slice(0,80)+'…<base64>':v;});
  if(lang==='curl'){
    rawSnippet='curl -X POST '+url+' \\\\\\n  -H "Content-Type: application/json" \\\\\\n  -d '+pyStr(JSON.stringify({path:p.path,method:'POST',body}))+';\\n';
    document.getElementById('code').innerHTML='<span class="c"># runs through your pooled keys — auth injected server-side</span>\\n'+esc(rawSnippet);
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
  lines.push('            '+pyStr('messages')+': '+esc(shortMsgs)+',');
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
function studioMode(){if(document.getElementById('modeAudio').classList.contains('on'))return 'audio';if(document.getElementById('modeVideo').classList.contains('on'))return 'video';return 'image';}
function setStudioMode(m){
  document.getElementById('modeImage').classList.toggle('on',m==='image');
  document.getElementById('modeAudio').classList.toggle('on',m==='audio');
  document.getElementById('modeVideo').classList.toggle('on',m==='video');
  document.getElementById('studioImage').hidden=m!=='image';
  document.getElementById('studioAudio').hidden=m!=='audio';
  document.getElementById('studioVideo').hidden=m!=='video';
  updateStudioModes();updateCode();
}
function updateStudioModes(){
  const prov=curProv();
  const im=document.getElementById('imgModel').value.trim()||AUD_MODELS[prov]||'';
  const c=capsFor(prov,im);
  const mi=document.getElementById('modeImage'),ma=document.getElementById('modeAudio'),mv=document.getElementById('modeVideo');
  const note=document.getElementById('studioNote');
  mi.classList.toggle('off',!c.imageOut);ma.classList.toggle('off',!c.audioOut);mv.classList.toggle('off',!c.videoOut);
  mi.disabled=!c.imageOut;ma.disabled=!c.audioOut;mv.disabled=!c.videoOut;
  const m=studioMode();
  const need=m==='image'?'imageOut':m==='audio'?'audioOut':'videoOut';
  if(!c[need]){
    note.hidden=false;note.className='cap-note';
    note.textContent=gateNote(need,prov,im)+' — switch studio mode or pool.';
  }else{note.hidden=true;note.textContent='';}
  if(!c.imageOut&&!c.audioOut&&!c.videoOut){note.hidden=false;note.className='cap-note';note.textContent=gateNote('imageOut',prov,im)+' — this pool has no generation output.';}
}
function studioParams(){
  const m=studioMode();
  if(m==='audio')return {mode:m,prompt:document.getElementById('audText').value,model:document.getElementById('audModel').value.trim(),voice:document.getElementById('audVoice').value.trim()||'alloy',format:document.getElementById('audFormat').value};
  if(m==='video')return {mode:m,prompt:document.getElementById('vidPrompt').value,model:document.getElementById('vidModel').value.trim(),duration:document.getElementById('vidDur').value,resolution:document.getElementById('vidRes').value};
  return {
    mode:m,
    prompt:document.getElementById('imgPrompt').value,
    model:document.getElementById('imgModel').value.trim(),
    size:document.getElementById('imgSize').value
  };
}
function studioPayload(s){
  if(s.mode==='audio')return {path:'/audio/speech',body:{model:s.model,input:s.prompt,voice:s.voice,response_format:s.format}};
  if(s.mode==='video')return {path:'/videos/generations',body:{model:s.model,prompt:s.prompt,duration:s.duration,resolution:s.resolution,n:1}};
  return {path:'/images/generations',body:{model:s.model,prompt:s.prompt,size:s.size,n:1}};
}
function updateStudioCode(){
  const s=studioParams();
  const pid=document.getElementById('pool').value||'1';
  const url=location.origin+'/api/pools/'+pid+'/proxy';
  const lang=document.getElementById('codeLang').value;
  const pl=studioPayload(s);
  const body=pl.body;
  if(lang==='curl'){
    rawSnippet='curl -X POST '+url+' \\\\\\n  -H "Content-Type: application/json" \\\\\\n  -d '+pyStr(JSON.stringify({path:pl.path,method:'POST',body}))+';\\n';
    document.getElementById('code').innerHTML='<span class="c"># runs through your pooled keys — auth injected server-side</span>\\n'+esc(rawSnippet);
    return;
  }
  const lines=[];
  lines.push('<span class="k">import</span> requests\\n');
  lines.push('resp = requests.<span class="fn">post</span>(');
  lines.push('    '+pyStr(url)+',');
  lines.push('    json={');
  lines.push('        '+pyStr('path')+': '+pyStr(pl.path)+',');
  lines.push('        '+pyStr('method')+': '+pyStr('POST')+',');
  lines.push('        '+pyStr('body')+': '+esc(JSON.stringify(body,null,4))+',');
  lines.push('    },');
  lines.push('    timeout=<span class="n">120</span>,');
  lines.push(')');
  lines.push('data = resp.<span class="fn">json</span>()');
  lines.push('<span class="fn">print</span>(data[<span class="s">'+pyStr('status')+'</span>])');
  lines.push('<span class="fn">print</span>(data[<span class="s">'+pyStr('body')+'</span>])');
  document.getElementById('code').innerHTML=lines.join('\\n');
  rawSnippet='import requests\\n\\nresp = requests.post(\\n    '+JSON.stringify(url)+',\\n    json='+JSON.stringify({path:pl.path,method:'POST',body},null,4)+',\\n    timeout=120,\\n)\\ndata = resp.json()\\nprint(data["status"])\\nprint(data["body"])\\n';
}
function mediaResultBox(id){return document.getElementById(id);}
function appendMediaOut(boxId,kind,src,mime,caption,downloadName){
  const box=mediaResultBox(boxId);
  const wrap=document.createElement('div');
  const el=document.createElement(kind==='audio'?'audio':'video');
  el.controls=true;el.src=src;
  if(kind==='video'){el.preload='metadata';}
  wrap.appendChild(el);
  const cap=document.createElement('div');cap.style.cssText='font-size:12px;color:var(--ink-soft)';cap.textContent=caption;
  wrap.appendChild(cap);
  const a=document.createElement('a');a.className='dl';a.href=src;a.download=downloadName;a.textContent='Download '+kind;
  wrap.appendChild(a);
  box.prepend(wrap);
}
function audioMimeFor(fmt){return fmt==='wav'?'audio/wav':fmt==='opus'?'audio/ogg':'audio/mpeg';}
function detectMediaInBody(r){
  if(r.encoding==='base64'&&r.body){
    const ct=String(r.contentType||'');
    if(/audio/i.test(ct))return {kind:'audio',src:'data:'+ct+';base64,'+r.body,mime:ct};
    if(/video/i.test(ct))return {kind:'video',src:'data:'+ct+';base64,'+r.body,mime:ct};
    if(/image/i.test(ct))return {kind:'image',src:'data:'+ct+';base64,'+r.body,mime:ct};
    return {kind:'audio',src:'data:audio/mpeg;base64,'+r.body,mime:'audio/mpeg'};
  }
  try{
    const d=JSON.parse(r.body);
    const first=d.data&&d.data[0];
    if(first){
      if(first.b64_json){
        const kind=studioMode()==='audio'?'audio':studioMode()==='video'?'video':'image';
        const mime=kind==='audio'?'audio/mpeg':kind==='video'?'video/mp4':'image/png';
        return {kind:kind,src:'data:'+mime+';base64,'+first.b64_json,mime:mime,json:true};
      }
      if(first.url)return {kind:studioMode(),src:first.url,mime:'',json:true,caption:first.revised_prompt||''};
    }
    if(d.audio||d.audio_base64||d.data_base64){
      const b=d.audio||d.audio_base64||d.data_base64;
      return {kind:'audio',src:'data:audio/mpeg;base64,'+b,mime:'audio/mpeg',json:true};
    }
  }catch{}
  return null;
}
async function sendStudio(){
  err('');
  const s=studioParams();
  const pl=studioPayload(s);
  if(s.mode==='image'&&!s.prompt.trim()){err('Describe the image first.');return;}
  if(s.mode!=='image'&&!s.prompt.trim()){err(s.mode==='audio'?'Type text to synthesize first.':'Describe the video first.');return;}
  if(!s.model){err('Enter a model id.');return;}
  const prov=curProv();
  const need=s.mode==='image'?'imageOut':s.mode==='audio'?'audioOut':'videoOut';
  if(!capsFor(prov,s.model)[need]){err(gateNote(need,prov,s.model));return;}
  const pid=Number(document.getElementById('pool').value);
  const btn=s.mode==='image'?document.getElementById('generate'):s.mode==='audio'?document.getElementById('genAudio'):document.getElementById('genVideo');
  const label=btn.innerHTML;
  btn.disabled=true;btn.textContent=s.mode==='image'?'Generating…':s.mode==='audio'?'Synthesizing…':'Rendering…';
  try{
    const r=await j(await fetch('/api/pools/'+pid+'/proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:pl.path,method:'POST',body:pl.body})}));
    if(r.error){err(r.error);return;}
    const hit=detectMediaInBody(r);
    if(!hit){err('No media in upstream response (status '+r.status+').');return;}
    if(s.mode==='image'){
      let src=hit.src;
      if(hit.kind!=='image'&&!hit.json){err('Unexpected media kind in response.');return;}
      const gal=document.getElementById('gallery');
      const fig=document.createElement('figure');
      const img=document.createElement('img');img.src=src;img.alt=s.prompt;img.loading='lazy';
      const cap=document.createElement('figcaption');cap.textContent=s.model+' · '+(hit.caption||s.prompt);
      fig.appendChild(img);fig.appendChild(cap);
      gal.prepend(fig);
      return;
    }
    appendMediaOut(s.mode==='audio'?'audioOut':'videoOut',s.mode,hit.src,hit.mime,s.model+' · '+s.prompt.slice(0,60),s.mode+'-output');
  }finally{btn.disabled=false;btn.innerHTML=label;updateCode();}
}
async function send(){
  err('');
  const btn=document.getElementById('submit');
  const p=params(),msgs=collectMessages();
  if(!msgs.some(m=>m.role==='user')){err('Type a user message first.');return;}
  if(!p.model){err('Enter a model id.');return;}
  const prov=curProv();
  const c=capsFor(prov,p.model);
  const bad=pendingMedia.filter(function(a){return (a.kind==='image'&&!c.vision)||(a.kind==='audio'&&!c.audioIn)||(a.kind==='video'&&!c.videoIn);});
  if(bad.length){err(gateNote(bad[0].kind==='image'?'vision':bad[0].kind==='audio'?'audioIn':'videoIn',prov,p.model));return;}
  const pid=Number(document.getElementById('pool').value);
  btn.disabled=true;
  lockComposers();
  try{
    const r=await j(await fetch('/api/pools/'+pid+'/proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:p.path,method:'POST',body:{model:p.model,messages:msgs,temperature:p.temp,max_tokens:p.maxtokens,top_p:p.topp}})}));
    pendingMedia=[];renderMediaPrev();updateMediaUI();
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
  window._pgPmap={};
  const pmap=window._pgPmap;
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
  const applyAudDefault=()=>{
    const m=document.getElementById('audModel');
    if(m.value===lastAudDefault){m.value=AUD_MODELS[pmap[sel.value]]||'';lastAudDefault=m.value;}
  };
  const applyVidDefault=()=>{
    const m=document.getElementById('vidModel');
    if(m.value===lastVidDefault){m.value=VID_MODELS[pmap[sel.value]]||'';lastVidDefault=m.value;}
  };
  applyDefault();
  applyImgDefault();
  applyAudDefault();
  applyVidDefault();
  lastDefault=document.getElementById('model').value;
  lastImgDefault=document.getElementById('imgModel').value;
  lastAudDefault=document.getElementById('audModel').value;
  lastVidDefault=document.getElementById('vidModel').value;
  sel.onchange=()=>{applyDefault();applyImgDefault();applyAudDefault();applyVidDefault();lastDefault=document.getElementById('model').value;lastImgDefault=document.getElementById('imgModel').value;lastAudDefault=document.getElementById('audModel').value;lastVidDefault=document.getElementById('vidModel').value;updateMediaUI();updateStudioModes();updateCode();};
  addUserTurn('');
  ['system','model','path','temp','maxtokens','topp'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{if(id==='model')lastDefault='⌁';if(id==='model'){updateMediaUI();updateStudioModes();}updateCode();}));
  ['imgPrompt','imgModel','imgSize'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{if(id==='imgModel')lastImgDefault='⌁';updateStudioModes();updateCode();}));
  ['audText','audModel','audVoice','audFormat'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{if(id==='audModel')lastAudDefault='⌁';updateStudioModes();updateCode();}));
  ['vidPrompt','vidModel','vidDur','vidRes'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{if(id==='vidModel')lastVidDefault='⌁';updateStudioModes();updateCode();}));
  document.getElementById('generate').onclick=()=>sendStudio();
  document.getElementById('genAudio').onclick=()=>sendStudio();
  document.getElementById('genVideo').onclick=()=>sendStudio();
  document.getElementById('modeImage').onclick=()=>setStudioMode('image');
  document.getElementById('modeAudio').onclick=function(){if(!this.disabled)setStudioMode('audio');};
  document.getElementById('modeVideo').onclick=function(){if(!this.disabled)setStudioMode('video');};
  document.getElementById('attachImg').onclick=()=>document.getElementById('fileImg').click();
  document.getElementById('attachAudio').onclick=()=>document.getElementById('fileAudio').click();
  document.getElementById('attachVideo').onclick=()=>document.getElementById('fileVideo').click();
  document.getElementById('fileImg').onchange=e=>{if(e.target.files[0])addMediaFile(e.target.files[0],'image');e.target.value='';};
  document.getElementById('fileAudio').onchange=e=>{if(e.target.files[0])addMediaFile(e.target.files[0],'audio');e.target.value='';};
  document.getElementById('fileVideo').onchange=e=>{if(e.target.files[0])addMediaFile(e.target.files[0],'video');e.target.value='';};
  document.getElementById('recAudio').onclick=()=>toggleRec();
  document.getElementById('clear').onclick=()=>{document.getElementById('turns').innerHTML='';pendingMedia=[];renderMediaPrev();addUserTurn('');updateMediaUI();updateCode();};
  document.getElementById('codeLang').onchange=updateCode;
  document.getElementById('submit').onclick=send;
  document.getElementById('addMsg').onclick=()=>{addUserTurn('').focus();};
  const copy=()=>{navigator.clipboard.writeText(rawSnippet).catch(()=>{});};
  document.getElementById('copyCode').onclick=copy;
  document.getElementById('copyTop').onclick=copy;
  document.getElementById('hideCode').onclick=e=>{const g=document.getElementById('grid');g.classList.toggle('nocode');e.target.textContent=g.classList.contains('nocode')?'</> Show code':'</> Hide code';};
  document.getElementById('tabChat').onclick=()=>setTab(true);
  document.getElementById('tabStudio').onclick=()=>setTab(false);
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(document.getElementById('tabStudio').classList.contains('on'))sendStudio();else send();}});
  updateMediaUI();updateStudioModes();updateCode();
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

export function providerPage(): string {
return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Provider — pool-anything</title>
<link rel="icon" type="image/png" href="/logo.png" />
<style>
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans);background:var(--paper-2);color:var(--ink)}
${shellCss}
${sharedLayoutCss}
.chead{display:flex;align-items:center;gap:10px}.chead img{width:28px;height:28px}
.title-wrap{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.title-wrap b{font-size:16px;line-height:1.25}
.use-stat{font-size:12.5px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
.pill{margin-left:auto;font-size:11px;font-weight:600;background:var(--paper-2);border-radius:999px;padding:3px 10px;white-space:nowrap;flex-shrink:0}
.hint{font-size:13px;color:var(--ink-soft);margin:10px 0 0}
.row{display:flex;gap:8px;align-items:center}
.err{color:var(--danger-ink);font-size:13px;min-height:18px}
.krow{display:flex;align-items:center;gap:8px;background:var(--paper-2);border-radius:10px;padding:8px 10px;font-size:13px;animation:fadeSlide .25s ease both}
.krow .meta{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.krow .use{font-size:11px;color:var(--ink-soft);margin:0;white-space:nowrap}
.krow button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;min-height:30px;padding:0 12px;font-size:13px;cursor:pointer}
.slotrow{display:flex;gap:8px}
.slotrow input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;min-height:34px;padding:0 12px;font-size:14px}
.slotrow button{border:1px solid var(--ink);background:var(--ink);color:var(--card);border-radius:8px;min-height:34px;padding:0 12px;font-size:14px;cursor:pointer}
.pmore{border:0;background:none;cursor:pointer;font-size:13px;color:var(--ink-soft);padding:0}
${docsComponentsCss}
</style></head><body><div class="shell" id="shell">${shellNav("")}<div class="content">${sharedHeader}<main>
<div class="wrap">
<div class="page-head"><a href="/"><img src="/logo.png" alt="pool-anything" width="28" height="28"/></a><h1 id="pTitle">Provider</h1></div>
<a class="back" id="crumbAll" href="/#browseAll">← all providers</a>
<div class="err" id="err"></div>
<div class="page-card" id="pcard" hidden>
<div class="chead"><img id="pLogo" alt=""/><div class="title-wrap"><b id="pName"></b><span class="use-stat" id="pUse"></span></div><span class="pill" id="pQuota"></span></div>
<p class="hint" id="pHint"></p>
<p class="sec-label" id="keyLabel" style="margin:12px 0 8px">Keys</p>
<div id="krows" style="display:flex;flex-direction:column;gap:6px"></div>
<div id="pslots" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"></div>
<div style="margin-top:10px"><button class="pmore" id="pmore" type="button">＋ key slot</button></div>
</div>
<div class="support-grid" id="supportGrid" hidden>
<div class="support-card"><p class="sec-label">Related pools</p><div id="related"></div></div>
<div class="support-card"><p class="sec-label">Use this pool</p><code id="proxySnippet"></code><div style="display:flex;gap:12px;flex-wrap:wrap"><a id="tryPlay" href="/playground">Try in Playground →</a><a href="/keys">Manage all keys →</a><a href="/analytics">View analytics →</a></div><small>Requests rotate across this provider's keys automatically.</small></div>
</div>
</div>
</main><script>
${clientCoreJs}
const id=(location.pathname.split('/')[2]||'');
let pool=null,keyTotal=0,usageMap={},cur=null,allProvs=[],allPools=[];
async function init(){
  if(!/^[a-z0-9-]+$/.test(id)){err('Unknown provider.');return;}
  const provs=await j(await fetch('/api/providers'));
  allProvs=provs;
  const p=provs.find(x=>x.id===id);
  cur=p;
  if(!p){err('Unknown provider.');return;}
  document.title=p.name+' — pool-anything';
  document.getElementById('pTitle').textContent=p.name;
  const logo=document.getElementById('pLogo');
  logoSrc(logo,p.logoFile);
  document.getElementById('pName').textContent=p.name;
  document.getElementById('pQuota').textContent=p.quota;
  document.getElementById('pHint').textContent=p.hint+(p.poolable===false?' · control-plane only, not poolable for data':'');
  document.getElementById('pcard').hidden=false;
  const pools=await j(await fetch('/api/pools'));
  allPools=Array.isArray(pools)?pools:[];
  pool=allPools.find(x=>x.provider===p.id);
  if(!pool)pool=await j(await fetch('/api/pools',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:p.id,name:p.name+' pool'})}));
  if(!pool||pool.error){err((pool&&pool.error)||'Could not load pool.');return;}
  refresh();
}
async function refresh(){
  const [ks,us]=await Promise.all([j(await fetch('/api/pools/'+pool.id+'/keys')),j(await fetch('/api/pools/'+pool.id+'/usage'))]);
  usageMap={};
  (us.perKey||[]).forEach(k=>{usageMap[k.id]=k.used;});
  const used=us.quota?(us.usedInWindow ?? us.used):us.used;
  const nKeys=ks.length;
  const keyWord=nKeys===1?'key':'keys';
  document.getElementById('pUse').textContent=us.quota
    ?used+' / '+(us.quota*nKeys)+' tokens used across '+nKeys+' '+keyWord+' this period'
    :used+' tokens used across '+nKeys+' '+keyWord+' this period';
  document.getElementById('keyLabel').textContent='Keys · '+nKeys;
  renderSupport(nKeys);
  const box=document.getElementById('krows');box.innerHTML='';
  ks.forEach((k,i)=>{
    const row=document.createElement('div');
    row.className='krow';row.style.animationDelay=Math.min(i*40,300)+'ms';
    const m=document.createElement('span');m.className='meta';m.textContent=k.label+' · '+k.masked;row.appendChild(m);
    const u=document.createElement('span');u.className='use';u.textContent=(usageMap[k.id]||0)+' tokens';row.appendChild(u);
    const v=document.createElement('button');v.textContent='View';v.type='button';
    v.onclick=async()=>{
      if(v.dataset.open){delete v.dataset.open;v.textContent='View';m.textContent=k.label+' · '+k.masked;return;}
      const full=await j(await fetch('/api/pools/'+pool.id+'/keys/'+k.id));
      if(full.error){err(full.error);return;}
      v.dataset.open='1';v.textContent='Hide';
      m.textContent=k.label+' · '+full.api_key+(full.credentials?' · '+Object.entries(full.credentials).map(([a,b])=>a+'='+b).join(' '):'');
    };
    const e=document.createElement('button');e.textContent='Edit';e.type='button';
    e.onclick=async()=>{
      const full=await j(await fetch('/api/pools/'+pool.id+'/keys/'+k.id));
      if(full.error){err(full.error);return;}
      row.innerHTML='';
      const f=document.createElement('div');f.style.cssText='display:flex;gap:6px;flex:1;flex-wrap:wrap';
      f.innerHTML='<input value="'+esc(full.label)+'" style="flex:1;min-width:70px"/>';
      const credFields=(full.credentials&&Object.keys(full.credentials).length?Object.keys(full.credentials):(k.credentials&&Object.keys(k.credentials).length?Object.keys(k.credentials):((cur.keyFields&&cur.keyFields.length?cur.keyFields:['api_key']))));
      const kins=credFields.map(cf=>{const i=document.createElement('input');i.type='password';i.placeholder=cf;i.value=(full.credentials&&full.credentials[cf])||(cf==='api_key'?full.api_key:'');i.style.cssText='flex:2;min-width:100px';f.appendChild(i);return i;});
      const [il]=f.querySelectorAll('input');
      const sv=document.createElement('button');sv.textContent='Save';sv.type='button';
      sv.onclick=async()=>{
        const patch={label:il.value};
        if(credFields.length===1&&credFields[0]==='api_key')patch.api_key=kins[0].value;
        else patch.credentials=Object.fromEntries(credFields.map((cf,i)=>[cf,kins[i].value]));
        const r=await j(await fetch('/api/pools/'+pool.id+'/keys/'+k.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(patch)}));
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
function renderSupport(nKeys){
  try{
    document.getElementById('supportGrid').hidden=false;
    document.getElementById('proxySnippet').textContent='POST /api/pools/'+pool.id+'/proxy';
    document.getElementById('tryPlay').href='/playground?pool='+pool.id;
    const rel=document.getElementById('related');rel.innerHTML='';
    const others=allPools.filter(x=>x.provider!==id);
    if(!others.length){
      const d=document.createElement('div');d.style.cssText='font-size:13px;color:var(--ink-soft)';
      d.textContent='No other pools yet — gather keys for another provider from Home.';
      rel.appendChild(d);
    }else{
      others.slice(0,5).forEach(x=>{
        const prov=allProvs.find(v=>v.id===x.provider);
        const row=document.createElement('div');row.className='rel-row';
        const a=document.createElement('a');a.href='/provider/'+x.provider;a.textContent=(prov?prov.name:x.provider)+' · '+x.name;
        row.appendChild(a);
        rel.appendChild(row);
      });
    }
  }catch{}
}
function addSlot(){
  const n=keyTotal+document.querySelectorAll('#pslots .slotrow').length+1;
  const fields=(cur.keyFields&&cur.keyFields.length?cur.keyFields:['api_key']);
  const multi=!(fields.length===1&&(fields[0]==='api_key'||fields[0]==='apiToken'));
  const form=document.createElement('form');form.className='slotrow';
  const inputs=fields.map(f=>{const i=document.createElement('input');i.type='password';i.autocomplete='off';i.placeholder='key '+n+' — '+f;i.setAttribute('aria-label',f+' '+n);form.appendChild(i);return i;});
  const btn=document.createElement('button');btn.type='submit';btn.textContent='Gather';form.appendChild(btn);
  form.onsubmit=async(e)=>{
    e.preventDefault();
    err('');
    const vals=inputs.map(i=>i.value.trim());
    if(vals.some(v=>!v)){err(multi?'Paste all '+fields.join(', ')+' first.':'Paste an API key first.');return;}
    const payload=multi?{label:'key '+n,credentials:Object.fromEntries(fields.map((f,i)=>[f,vals[i]]))}:{label:'key '+n,api_key:vals[0]};
    const r=await j(await fetch('/api/pools/'+pool.id+'/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
    if(r.error){err(r.error);return;}
    form.remove();refresh();
  };
  document.getElementById('pslots').appendChild(form);inputs[0].focus();
}
document.getElementById('pmore').onclick=()=>addSlot();
init();
</script></div></main></div></div>${shellJs}</body></html>`;
}
