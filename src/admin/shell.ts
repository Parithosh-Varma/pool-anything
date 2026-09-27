import { ICONS, DOCS_URL } from "./branding.js";
import { tokensCss } from "./tokens.js";

export const shellCss = `
  html { scrollbar-gutter:stable; scrollbar-width:none; -ms-overflow-style:none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display:none; }
  .shell { display:grid; grid-template-columns:var(--sbw,260px) 1fr; min-height:100vh; transition:grid-template-columns 250ms cubic-bezier(0.77,0,0.175,1); }
  .shell.collapsed { --sbw:57px; }
  .sidebar { background:var(--card); border-right:1px solid var(--line); display:flex; flex-direction:column; min-height:100vh; height:100vh; position:sticky; top:0; overflow:hidden; white-space:nowrap; }
  .sb-header { height:58px; flex-shrink:0; display:flex; align-items:center; gap:4px; border-bottom:1px solid var(--line); padding:0 12px; overflow:hidden; }
  .sb-acct { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 12px; border-radius:8px; border:0; background:transparent; font-size:14px; }
  .sb-acct span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
  .sb-logo { width:40px; height:40px; flex-shrink:0; display:grid; place-items:center; overflow:hidden; }
  .sb-logo img { width:36px; height:36px; object-fit:contain; }
  .sb-nav { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:12px 11px 12px 14px; scrollbar-width:none; }
  .sb-nav::-webkit-scrollbar { display:none; }
  .mi { display:flex; align-items:center; gap:10px; width:100%; min-height:34px; padding:0 12px; border-radius:8px; border:0; background:transparent; font-size:14px; font-weight:500; color:var(--ink); cursor:pointer; text-decoration:none; text-align:left; }
  .mi:hover { background:var(--paper-2); }
  .mi.active { background:var(--line-soft); }
  .mi .ic { opacity:.5; flex-shrink:0; width:16px; text-align:center; }
  .mi .ic svg { display:block; width:18px; height:18px; }
  .mi .ext { margin-left:auto; opacity:.45; display:inline-flex; flex-shrink:0; }
  .sb-footer { height:48px; flex-shrink:0; display:flex; align-items:center; padding:0 14px; border-top:1px solid var(--line); position:sticky; bottom:0; background:var(--card); }
  .collapse-btn { width:34px; height:34px; display:grid; place-items:center; border-radius:8px; border:0; background:transparent; color:var(--ink-soft); cursor:pointer; }
  .collapse-btn:hover { background:var(--paper-2); color:var(--ink); }
  .shell.collapsed:not(.peeking) .lbl, .shell.collapsed:not(.peeking) .ext { display:none; }
  .shell.collapsed:not(.peeking) .sb-header { padding:0 8px; justify-content:center; }
  .shell.collapsed:not(.peeking) .sb-acct { display:none; }
  .shell.collapsed:not(.peeking) .mi { justify-content:center; padding:0; }
  .shell.peeking { --sbw:260px; }
  .shell .lbl, .shell .sb-acct { opacity:1; transition:opacity 150ms ease; }
  .shell.closing .lbl, .shell.closing .sb-acct { opacity:0; }
  @keyframes pageIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
  .content { animation:pageIn .3s ease both; }
  @media (max-width:720px) { .shell { --sbw:57px; } .lbl, .ext { display:none; } }`;

export function shellNav(active: string): string {
  const item = (href: string, icon: string, label: string) => {
    const ext = href.startsWith("http");
    return `<a class="mi${href === active ? " active" : ""}" href="${href}"${ext ? ' target="_blank" rel="noopener" title="Opens external link in a new tab"' : ""}><span class="ic">${icon}</span><span class="lbl">${label}</span>${ext ? `<span class="ext">${ICONS.external}</span>` : ""}</a>`;
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

export const sharedHeader = `<header>
  <div></div>
  <div class="spacer">
    <a href="${DOCS_URL}" target="_blank" rel="noopener">Docs</a>
  </div>
</header>`;

/** Shared page layout matching Home exactly (container, cards, typography).
 *  Home tokens: --line/--subtle/--bg/--card, .wrap max-width 1400, card
 *  radius 16 + padding 18. Detail pages use compact top padding (32px, not
 *  Home's 16vh hero offset) so short content doesn't strand whitespace. */
export const sharedLayoutCss = `
  ${tokensCss}
  .content { flex:1; min-width:0; display:flex; flex-direction:column; }
  header { height:56px; background:var(--card); border-bottom:1px solid var(--line); display:flex; align-items:center; padding:0 16px; gap:8px; position:sticky; top:0; z-index:5; }
  header .spacer { margin-left:auto; display:flex; gap:4px; }
  header a { font-size:14px; padding:6px 12px; border-radius:8px; border:0; background:inherit; color:var(--ink); text-decoration:none; cursor:pointer; }
  header a:hover { background:var(--paper-2); }
  main { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:32px 16px 24px; }
  .wrap { width:100%; max-width:1400px; margin:0 auto; display:flex; flex-direction:column; align-items:stretch; gap:16px; padding:0 8px; }
  .page-head { display:flex; align-items:center; gap:10px; }
  .page-head h1 { font-family:var(--font-serif); font-size:clamp(20px, 4vw, 26px); font-weight:500; margin:0; flex:1; }
  .page-head img { width:28px; height:28px; object-fit:contain; }
  a.back, a.crumb { font-size:13px; color:var(--ink-soft); text-decoration:none; }
  a.back:hover, a.crumb:hover { color:var(--ink); text-decoration:underline; text-underline-offset:2px; }
  .page-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; animation:fadeSlide .28s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes fadeSlide { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
  .sec-label { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); margin:0 0 8px; }
  .support-grid { width:100%; display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
  @media (max-width:900px) { .support-grid { grid-template-columns:1fr; } }
  .support-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:8px; font-size:13px; }
  .support-card .rel-row { display:flex; align-items:center; gap:10px; padding:8px 2px; border-top:1px solid var(--paper-2); font-size:13px; }
  .support-card .rel-row:first-of-type { border-top:0; }
  .support-card a { color:var(--ink); font-weight:500; text-decoration:none; }
  .support-card a:hover { text-decoration:underline; text-underline-offset:2px; }
  .support-card small { color:var(--ink-soft); font-weight:400; }
  .support-card code { font-family:var(--font-mono); font-size:12px; background:var(--paper-2); border:1px solid var(--line); border-radius:8px; padding:8px 10px; overflow-x:auto; white-space:pre; display:block; }`;

export const shellJs = `<script>
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

