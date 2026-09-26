import { ICONS, DOCS_URL } from "./branding.js";

export const shellCss = `
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

export function shellNav(active: string): string {
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

