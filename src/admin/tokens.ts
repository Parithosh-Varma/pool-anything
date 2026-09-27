/** Canonical design tokens as a CSS `:root` block — docs-first source of truth.
 *  Values mirror design-tokens.json (verified by scripts/check-tokens.ts).
 *  Admin pages interpolate `tokensCss` instead of declaring their own `:root`.
 *  Custom code only — no framework theming layer involved. */

export const tokensCss = `
  :root {
    --paper:#FFFFFF; --paper-2:#F5F5F4; --card:#FFFFFF; --bg:#FFFFFF;
    --ink:#1B1917; --ink-soft:#57534E; --ink-faint:#8A8680; --body-copy:#3F3B36;
    --line:#E8E3D9; --line-soft:#EFEAE1; --active-pill:#E9E5DB;
    --accent:#C15F3C; --accent-ink:#9A4A2E; --accent-soft:rgba(193,95,60,0.1);
    --code-bg:#F5F5F4; --code-ink:#23201C; --code-dark:#1C1917; --code-dark-ink:#EDE6DA;
    --green-bg:#EBF6EC; --green-line:#BFE3C4; --green-ink:#1E6B32; --green-chip:#22A355;
    --info-chip:#E2DED4;
    --warn-bg:#FFF3E4; --warn-line:#F0D9B5; --warn-ink:#9A5A00;
    --danger-bg:#FDECEC; --danger-line:#F5C6C2; --danger-ink:#B3261E; --danger-ring:rgba(179,38,30,0.15);
    --link-bg:#EAF1FE; --link-ink:#2456C6; --link-line:#C9DAFA;
    --underline:#C9C2B4; --nav-hover:rgba(87,83,78,0.07);
    --scrollbar:#D6D0C4; --chev:#A8A29E;
    --tok-cmd:#B3401E; --tok-str:#0E6E3E; --tok-kw:#7A3DC0; --tok-com:#9B9489;
    --chart-blue:#3b82f6; --chart-blue-fill:rgba(59,130,246,0.10);
    --chart-red:#ef4444; --chart-red-fill:rgba(239,68,68,0.08);
    --scrim:rgba(0,0,0,0.3); --overlay-strong:rgba(0,0,0,0.55);
    --radius:8px; --radius-xs:5px; --radius-sm:6px; --radius-copy:7px;
    --radius-md:8px; --radius-lg:10px; --radius-xl:12px; --radius-pill:999px;
    --shadow-sm:0 1px 2px rgba(0,0,0,.15); --shadow-md:0 8px 24px rgba(0,0,0,.12);
    --shadow-drawer:0 20px 60px rgba(0,0,0,.18);
    --ctl-sm:26px; --ctl-icon:30px; --ctl-md:34px;
    --font-sans:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    --font-serif:Georgia,"Times New Roman",serif;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    color-scheme:light;
  }`;
