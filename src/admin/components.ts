/** Shared component layer — docs-first.
 *  Net-new `ds-*` components ported from landing/docs.html (see
 *  design-system.md §10d) with literals swapped to tokensCss vars.
 *  `ds-` prefix avoids collisions with existing admin selectors
 *  (notably admin playground `.code` vs docs `.code`).
 *  Bridge rules at the bottom re-skin existing admin analogues
 *  (same selectors, docs values) — no markup/JS changes.
 *  Interpolate AFTER page CSS so equal-specificity rules win. */

export const docsComponentsCss = `
  /* — global focus (docs :focus-visible, §11 #15) — */
  button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible,
  textarea:focus-visible, summary:focus-visible {
    outline:2px solid var(--accent); outline-offset:2px; border-radius:4px;
  }
  /* — eyebrow label (docs .eyebrow) — */
  .ds-eyebrow { font-size:11px; letter-spacing:.08em; font-weight:700; color:var(--ink-faint); margin:0 0 4px; }
  /* — inline code (docs .article code) — */
  .ds-inline { font-family:var(--font-mono); font-size:12.5px; background:var(--code-bg);
    border:1px solid var(--line-soft); border-radius:var(--radius-sm); padding:1px 6px;
    color:var(--ink); white-space:nowrap; }
  /* — code block + copy (docs .code / .code-tools) — */
  .ds-code { position:relative; background:var(--card); border:1px solid var(--line);
    border-radius:var(--radius-md); margin:8px 0 12px; overflow:hidden; }
  .ds-code pre { margin:0; padding:13px 46px 13px 14px; overflow-x:auto;
    font-family:var(--font-mono); font-size:12.5px; line-height:1.6; color:var(--code-ink); }
  .ds-code pre code { background:none; border:0; padding:0; white-space:pre; }
  .ds-code.dark { background:var(--code-dark); border-color:var(--code-dark); }
  .ds-code.dark pre { color:var(--code-dark-ink); }
  .ds-code-tools { position:absolute; top:8px; right:8px; display:flex; gap:4px; }
  .ds-code-tools button { border:1px solid transparent; background:none; border-radius:var(--radius-sm);
    cursor:pointer; width:26px; height:26px; display:inline-flex; align-items:center;
    justify-content:center; color:var(--ink-faint); font-size:13px; }
  .ds-code-tools button:hover { background:var(--paper-2); color:var(--ink); border-color:var(--line); }
  .ds-tok-cmd { color:var(--tok-cmd); font-weight:600; } .ds-tok-url { color:var(--link-ink); }
  .ds-tok-str { color:var(--tok-str); } .ds-tok-com { color:var(--code-com); } .ds-tok-k { color:var(--tok-kw); }
  /* — callouts (docs .callout info/tip) — */
  .ds-callout { display:flex; gap:10px; border:1px solid var(--line); border-radius:var(--radius-md);
    background:var(--paper-2); padding:11px 14px; margin:14px 0; font-size:13.5px; color:var(--body-copy); }
  .ds-callout .ic { flex-shrink:0; width:20px; height:20px; border-radius:50%;
    display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; margin-top:2px; }
  .ds-callout.info .ic { background:var(--info-chip); color:var(--ink-soft); }
  .ds-callout.tip { background:var(--green-bg); border-color:var(--green-line); }
  .ds-callout.tip .ic { background:var(--green-chip); color:#fff; }
  .ds-callout a { color:var(--ink); text-decoration:underline; text-underline-offset:2px; }
  /* — tabs (docs .ptabs / .subtabs) — */
  .ds-ptabs { display:flex; gap:2px; border-bottom:1px solid var(--line); margin:14px 0 4px; overflow-x:auto; }
  .ds-ptabs button { border:0; background:none; font:inherit; font-size:13px; color:var(--ink-soft);
    padding:8px 12px; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap; }
  .ds-ptabs button:hover { color:var(--ink); }
  .ds-ptabs button.on { color:var(--ink); font-weight:600; border-bottom-color:var(--accent); }
  .ds-subtabs { display:flex; gap:18px; margin:12px 0 2px; font-size:13px; }
  .ds-subtabs button { border:0; background:none; font:inherit; color:var(--ink-soft);
    cursor:pointer; padding:4px 0; border-bottom:2px solid transparent; }
  .ds-subtabs button.on { color:var(--ink); font-weight:600; border-bottom-color:var(--accent); }
  .ds-tabpanel { display:none; } .ds-tabpanel.on { display:block; }
  .ds-plabel { font-size:13px; font-weight:600; margin:16px 0 6px; }
  /* — data table (docs table.grid) — */
  .ds-tbl-wrap { overflow-x:auto; margin:12px 0; }
  table.ds-grid { width:100%; border-collapse:collapse; font-size:13.5px; }
  table.ds-grid th { text-align:left; font-size:12px; font-weight:600; color:var(--ink-faint);
    padding:8px 10px; border-bottom:1px solid var(--line); }
  table.ds-grid td { padding:9px 10px; border-bottom:1px solid var(--line-soft);
    vertical-align:top; color:var(--body-copy); }
  table.ds-grid td:first-child { color:var(--ink); }
  table.ds-grid a { color:var(--ink); text-decoration:underline;
    text-decoration-color:var(--underline); text-underline-offset:3px; }
  /* — endpoint plate + method badges (docs .ep / .m) — */
  .ds-ep { background:var(--card); border:1px solid var(--line); border-radius:var(--radius-lg);
    padding:13px 15px; margin:12px 0; }
  .ds-ep-head { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .ds-ep-head .route { font-family:var(--font-mono); font-size:13px; font-weight:600; }
  .ds-m { font-family:var(--font-mono); font-size:11px; font-weight:700;
    border-radius:var(--radius-xs); padding:2px 8px; letter-spacing:.03em; }
  .ds-m.get { background:var(--link-bg); color:var(--link-ink); border:1px solid var(--link-line); }
  .ds-m.post { background:var(--ink); color:#fff; }
  .ds-m.patch { background:var(--warn-bg); color:var(--warn-ink); border:1px solid var(--warn-line); }
  .ds-m.delete { background:var(--danger-bg); color:var(--danger-ink); border:1px solid var(--danger-line); }
  .ds-ep p { font-size:13.5px; margin:7px 0 0; }
  /* — accordion (docs .acc) — */
  .ds-acc { border:1px solid var(--line); border-radius:var(--radius-lg); overflow:hidden;
    margin:12px 0; background:var(--card); }
  .ds-acc-item + .ds-acc-item { border-top:1px solid var(--line-soft); }
  .ds-acc-btn { width:100%; display:flex; align-items:center; gap:10px; text-align:left;
    background:none; border:0; font:inherit; font-size:13.5px; font-weight:600; color:var(--ink);
    padding:11px 14px; cursor:pointer; }
  .ds-acc-btn:hover { background:var(--paper); }
  .ds-acc-btn .chev { color:var(--ink-faint); font-size:11px; width:14px; transition:transform .18s ease; }
  .ds-acc-item.open .ds-acc-btn .chev { transform:rotate(90deg); }
  /* — right-rail scroll-spy (docs .toc) — */
  .ds-toc { font-size:12.5px; }
  .ds-toc a { display:block; color:var(--ink-soft); text-decoration:none;
    padding:3px 0 3px 12px; border-left:2px solid transparent; }
  .ds-toc a:hover { color:var(--ink); }
  .ds-toc a.on { color:var(--ink); font-weight:600; border-left-color:var(--accent); }
  .ds-toc a.sub { padding-left:24px; }
  /* — search input (docs .search) — */
  .ds-search { display:flex; align-items:center; gap:8px; background:var(--card);
    border:1px solid var(--line); border-radius:var(--radius-md); padding:6px 10px;
    font-size:13px; color:var(--ink-faint); }
  .ds-search input { border:0; outline:0; background:none; width:100%; font-size:13px; color:var(--ink); }
  .ds-search kbd { font-family:inherit; font-size:11px; border:1px solid var(--line);
    border-radius:var(--radius-xs); padding:0 5px; background:var(--paper); color:var(--ink-faint); }
  /* — feedback pill + pager (docs) — */
  .ds-feedback { display:flex; align-items:center; gap:10px; margin:26px 0 8px;
    font-size:13px; color:var(--ink-soft); }
  .ds-feedback button { display:inline-flex; align-items:center; gap:6px; font-size:12.5px;
    border:1px solid var(--line); background:var(--card); border-radius:var(--radius-pill);
    padding:5px 12px; cursor:pointer; color:var(--ink-soft); }
  .ds-feedback button:hover { color:var(--ink); border-color:var(--ink-faint); }
  .ds-feedback button.picked { background:var(--ink); color:#fff; border-color:var(--ink); }

  /* ══ bridge: existing admin analogues re-skinned to docs values ══ */
  /* nav active → docs sidenav [data-active] (§11 #4) */
  .mi.active { background:var(--accent-soft); color:var(--accent); }
  .mi.active .ic { opacity:1; }
  /* home search → docs search idiom (§11 #10, #15); ring lives on the outer
     card so overflow:hidden containment never clips the focus affordance */
  .search-card { overflow:hidden; }
  .search-card:focus-within { border-color:var(--ink-faint); box-shadow:none; }
  .search-box { background:var(--card); border-radius:var(--radius-md); overflow:hidden; }
  .search-box input { height:100%; }
  .kbd { align-items:center; }
  .kbd kbd { border-radius:var(--radius-xs); color:var(--ink-soft); border-color:var(--line); }
  /* tips banner → callout.info geometry */
  .tips-banner { background:var(--paper-2); border-radius:var(--radius-md); padding:11px 14px; }
  /* stat-list → table.grid idiom */
  .stat-list .sl { color:var(--ink-faint); font-size:12px; font-weight:600; }
  .stat-list .srow { border-top-color:var(--line-soft); }
  .stat-list .sv { color:var(--ink); }
  /* playground copy buttons → code-tools 26px */
  #copyTop.btn, #copyCode.btn { min-height:26px; min-width:26px; padding:0 6px; border-color:transparent;
    color:var(--ink-faint); }
  #copyTop.btn:hover, #copyCode.btn:hover { background:var(--paper-2); color:var(--ink);
    border-color:var(--line); }
  /* playground token colors → docs tok palette (§11 #17) */
  .k { color:var(--tok-kw); } .s { color:var(--tok-str); } .n { color:var(--warn-ink); }
  .fn { color:var(--link-ink); } .c { color:var(--code-com); }
  /* error text + note boxes → docs danger/warn (§11 #2-3) */
  .err, .perr { color:var(--danger-ink); }
  .msg.assistant.err { border-color:var(--danger-line); background:var(--danger-bg); }
  .cap-note { color:var(--warn-ink); background:var(--warn-bg); border-color:var(--warn-line); }
  .cap-note.ok { color:var(--green-ink); background:var(--green-bg); border-color:var(--green-line); }
  .ana-delta.up { color:var(--green-ink); } .ana-delta.down { color:var(--danger-ink); }
  .submit { border-color:var(--danger-ink); box-shadow:0 0 0 3px var(--danger-ring); }
  .meter { background:var(--line); } .meter i { background:var(--chart-blue); }

  /* ══ custom dropdown: trigger + menu over a hidden native select ══ */
  /* trigger mirrors .ctl geometry; menu mirrors endpoint-plate cards */
  .dd { position:relative; display:inline-flex; min-width:0; vertical-align:middle; }
  .dd-block { display:flex; width:100%; }
  .dd-btn { display:inline-flex; align-items:center; gap:8px; width:100%;
    border:1px solid var(--line); background:var(--card); border-radius:8px;
    min-height:34px; padding:0 10px; font-size:13px; color:var(--ink);
    font-family:inherit; cursor:pointer; text-align:left; }
  .dd-btn:hover { background:var(--paper-2); }
  .dd-btn:disabled { opacity:.4; cursor:not-allowed; }
  .dd-ghost .dd-btn { border-color:transparent; font-weight:600; }
  .dd-ghost .dd-btn:hover { background:var(--paper-2); border-color:var(--line); }
  .dd-val { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dd-btn .chev { display:inline-flex; flex-shrink:0; color:var(--ink-faint);
    transition:transform .18s ease; }
  .dd.open .dd-btn .chev { transform:rotate(180deg); }
  .dd-menu { position:absolute; top:calc(100% + 4px); left:0; min-width:100%;
    max-height:240px; overflow:auto; background:var(--card);
    border:1px solid var(--line); border-radius:10px;
    box-shadow:var(--shadow-md); padding:4px; z-index:60; margin:0; }
  .dd-item { display:flex; align-items:center; gap:8px; width:100%; border:0;
    background:none; font-family:inherit; font-size:13px; color:var(--ink);
    border-radius:6px; padding:7px 8px; cursor:pointer; text-align:left; }
  .dd-item:hover { background:var(--paper-2); }
  .dd-item:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .dd-item:disabled { opacity:.4; cursor:not-allowed; }
  .dd-item .dd-txt { flex:1; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .dd-item .tick { display:inline-flex; flex-shrink:0; width:14px; opacity:0; }
  .dd-item[aria-selected="true"] { font-weight:600; }
  .dd-item[aria-selected="true"] .tick { opacity:1; }
  .row>.dd { flex:1 1 auto; min-width:140px; }
  .pg-top>.dd { max-width:220px; }`;

const DD_CHEV = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

/** Custom dropdown markup: visible trigger + menu over a hidden native select.
 *  Client JS (clientDropdownJs in pages.ts) builds the menu from the select's
 *  options and dispatches real input/change events, so existing `.value`
 *  reads, `.onchange` handlers, and option-population code keep working.
 *  wrapClass: "dd-block" (full-width, e.g. form rows + studio fields) or
 *  "dd-ghost" (borderless, e.g. the code-language picker). */
export function ddSelect(id: string, ariaLabel: string, options: string, wrapClass = ""): string {
  return `<span class="dd${wrapClass ? " " + wrapClass : ""}" id="dd-${id}"><select id="${id}" aria-label="${ariaLabel}" hidden>${options}</select><button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${ariaLabel}"><span class="dd-val"></span><span class="chev">${DD_CHEV}</span></button><div class="dd-menu" role="listbox" hidden></div></span>`;
}
