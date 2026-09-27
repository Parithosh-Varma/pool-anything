# pool-anything — Design System (extracted from implemented source)

> Audited from real rendered styles, not a spec. Zero-dependency repo: **no `.css` files, no Tailwind, no theme provider, no tokens file, no dark mode.**
> All styling is inline `<style>` blocks + `style=""` attributes in server-rendered TS templates and static HTML.
> Primary sources (with line refs):
> - `src/admin/shell.ts:3-34` (`shellCss`), `src/admin/shell.ts:72-97` (`sharedLayoutCss`, the closest thing to a token file: `:root { --line:#e5e5e5; --subtle:#737373; --bg:#fafafa; --card:#fff; }`)
> - `src/admin/pages.ts:118-326` (home `page` style block), `src/admin/pages.ts:702-718` (keys), `src/admin/pages.ts:834-886` (analytics), `src/admin/pages.ts:981-995` (pools), `src/admin/pages.ts:1042-1107` (playground), `src/admin/pages.ts:1704-1725` (provider)
> - `src/admin/branding.ts:18-30` (icon helper + sizes)
> - `landing/index.html:12-314` (`:root` at lines 13-30), `landing/docs.html:9-~400` (two `:root` blocks at lines 10-27 and 100-104), `landing/404.html:12-78` (`:root` at 13-23)
> - `scripts/tools-api-base.js:162-176` (floating backend widget CSS; mirrored in `tools-site/api-base.js:166-176`)
> - `tools-site/**/*.html` are **generated mirrors** of `src/admin/pages.ts` (via `scripts/export-tools-ui.ts`) — not separately audited.
> - `color-scheme:light` is set explicitly (`src/admin/pages.ts:119`). **No dark-mode values exist.**

There are **three independent visual languages** that share almost no tokens (see §8 Cleanup checklist):
| Surface | Theme | Ink / bg character |
|---|---|---|
| Admin app (`src/admin/*`) | neutral gray minimal, system sans | `#111` on `#fafafa`, borders `#e5e5e5` |
| Landing (`landing/index.html`) | warm editorial cream + terracotta | `#141413` on `#ffffff`, borders `#e8e6dc`, serif display |
| Docs (`landing/docs.html`) | paper + burnt-orange accent | `#1B1917` on `#FFFFFF`, borders `#E8E3D9`, accent `#C15F3C` |
| 404 (`landing/404.html`) | porcelain + teal/copper one-off | `#15211E` on `#E9EFEA`, accent `#0E7C6B` / `#B44A1F` |

---

## 1. Color palette

### 1a. Admin app — canonical tokens (`src/admin/shell.ts:73`, `src/admin/pages.ts:119`)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#fafafa` | `body`, page background (`shell.ts:73`, `pages.ts:703,835,982,1043,1707`) |
| `--card` | `#fff` | cards, header, sidebar (`shell.ts:73-75`) |
| `--line` | `#e5e5e5` | all 1px borders (`shell.ts:73`) |
| `--subtle` | `#737373` | secondary text, icons (`shell.ts:73`) |
| `--ink` (implicit, hardcoded) | `#111` | primary text, solid buttons (`pages.ts:124,142`) |

### 1b. Admin full gray scale, light → dark (all values observed in `src/admin/*`)

| Step | Value | Where |
|---|---|---|
| 0 | `#fff` | cards, buttons, header, sidebar |
| 1 | `#fafafa` | app bg, quick-links strip (`pages.ts:260`), gallery fig (`pages.ts:1085`), thumb (`pages.ts:1095`) |
| 2 | `#f5f5f5` | hover (`prov`, `prov-lg`, `.btn`, search), `krow`/`li` bg, search-box bg (`pages.ts:187,193,207`) |
| 3 | `#f0f0f0` | hover (`mi`, header btn, icon-btn, gs-x), `.pill` bg, row dividers, chart gridlines (`clientChartsJs`, `pages.ts:44`) |
| 4 | `#ececec` | active nav (`.mi.active`), segmented track (`.seg`, `.modes`) (`pages.ts:1048,1100`) |
| 5 | `#e5e5e5` | `--line`; all bordered inputs/buttons, empty chart stroke (`pages.ts:58`) |
| 6 | `#d4d4d4` | `ana-card:hover` border only (`pages.ts:277,848`) |
| 7 | `#eee` | `.meter` track only (`pages.ts:231`) |
| 8 | `#a3a3a3` | `ana-dots`, `ana-y`, submit `.hint` (`pages.ts:281,292,1073`) |
| 9 | `#9ca3af` | code comment `.c` only (`pages.ts:1081`) |
| 10 | `#737373` | `--subtle` secondary text |
| 11 | `#525252` | segmented/mode button text, `kbd` text (`pages.ts:191,1049,1101`) |
| 12 | `#404040` | tips `ol` text (`pages.ts:311,318,882`) |
| 13 | `#111` | primary text, solid buttons |
| 14 | `#000` | media-out video bg (`pages.ts:1105`) |

### 1c. Admin primary / accent (blue — charts, meters, focus)

| Token | Value | Where |
|---|---|---|
| `accent-chart` | `#3b82f6` | meter fill (`pages.ts:232`), analytics `BLUE` const (`pages.ts:942`), line charts |
| `accent-chart-alt` | `#4290F0` | chart-tip `.dot` default (`pages.ts:296`) — ⚠️ drift vs `#3b82f6` |
| `accent-chart-fill` | `rgba(59,130,246,0.10)` | area fill under blue lines (`pages.ts:55`) |
| `accent-focus-ring` | `rgba(59,130,246,.4)` as `0 0 0 1.5px` | search-box `:focus-within` (`pages.ts:219`) |

### 1d. Admin semantic colors

| Token | Value | Usage |
|---|---|---|
| `success` | `#15803d` | `.ana-delta.up` (`pages.ts:286,855`) |
| `success-strong` | `#166534` | `.cap-note.ok` text (`pages.ts:1093`) |
| `success-bg` | `#f0fdf4` | `.cap-note.ok` bg |
| `success-border` | `#bbf7d0` | `.cap-note.ok` border |
| `error` | `#dc2626` | `.ana-delta.down` (`pages.ts:287,856`) |
| `error-text` | `#b00` | `.err`, `.perr` (`pages.ts:216,716,1082`) — ⚠️ drift: 3 reds for "error text" |
| `error-strong` | `#f04438` | `.submit` border (`pages.ts:1071`) |
| `error-ring` | `rgba(240,68,56,.15)` as `0 0 0 3px` | `.submit` ring |
| `error-border-soft` | `#f3b7b3` | `.msg.assistant.err` border (`pages.ts:1066`) |
| `error-bg-soft` | `#fff5f4` | `.msg.assistant.err` bg |
| `error-chart` | `#ef4444` | red chart lines; area fill `rgba(239,68,68,0.08)` (`pages.ts:55`) |
| `warning-text` | `#92400e` | `.cap-note` text (`pages.ts:1092`) |
| `warning-bg` | `#fef3c7` | `.cap-note` bg |
| `warning-border` | `#f5d67b` | `.cap-note` border |
| `ok-dot` (widget only) | `#16a34a` | `scripts/tools-api-base.js:168` — ⚠️ third green, drift vs `#15803d`/`#166534` |
| `err-dot` (widget only) | `#dc2626` | same file — consistent with `error` ✓ |

### 1e. Admin code-syntax colors (playground `pages.ts:1081`)

`.k #a626a4` (keyword) · `.s #50a14f` (string) · `.n #b76b01` (number) · `.fn #0184bc` (function) · `.c #9ca3af` (comment).

### 1f. Admin background / surface colors

`html #fff` (`pages.ts:120`); `body var(--bg)`; header/sidebar/cards `var(--card)`; overlays: `dialog::backdrop rgba(0,0,0,.3)` (`pages.ts:200`), thumb-remove `rgba(0,0,0,.55)` (`pages.ts:1099`); shadows use `rgba(0,0,0,.12)` / `rgba(0,0,0,.15)` (§5).

### 1g. Landing (`landing/index.html:13-30`)

| Token | Value |
|---|---|
| `--cream` | `#ffffff` (named cream, actually white) |
| `--cream-2` | `#f5f5f4` |
| `--card` | `#ffffff` |
| `--ink` | `#141413` |
| `--ink-soft` | `#30302e` |
| `--ink-faint` | `#5e5d59` |
| `--line` | `#e8e6dc` |
| `--line-soft` | `#efede4` |
| `--line-strong` | `#d1cfc5` |
| `--dark` | `#141413` |
| `--dark-2` | `#1e1e1c` |
| `--accent` | `#d97757` (terracotta) |
| `--accent-soft` | `#ebc9b7` |
| `--blue` | `#2F6FED` |
| `--green` | `#1F7A4D` |
| `--radius` | `14px` |
| one-offs | `#000` (btn hover), `#f5f4ed` (dark surfaces text / meter track / news btn), `#E8E2D2`, `#E8C47A` (cursor/token), `#8AB4FF`, `#7BD88F`, `#97948a`, `#d6d3c8`, `#A8A396`, `#C9C2B0`, `#B9B09A` (conduit dash), `#F6F3EA` (lit ledger), `#26251F`/`#3A3833` (install pill), `#0C0B0A`/`#2E2C27` (terminal), bands `#D96C3F`/`#2E9E63`/`#5B8DEF`, shot tints `#F6EDE2`/`#E4EFE5`/`#E4EAF6`, dial `#d97757` dot / `#141413` hub |

### 1h. Docs (`landing/docs.html:10-27` + `:root` override at `100-104`)

`--paper #FFFFFF` · `--paper-2 #F5F5F4` · `--card #FFFFFF` · `--ink #1B1917` · `--ink-soft #57534E` · `--ink-faint #8A8680` · `--line #E8E3D9` · `--line-soft #EFEAE1` · `--active-pill #E9E5DB` · `--accent #C15F3C` · `--accent-ink #9A4A2E` · `--code-bg #F5F5F4` · `--green-bg #EBF6EC` · `--green-line #BFE3C4` · `--green-ink #1E6B32` · `--radius 8px` · `--primary #C15F3C` · `--primary-ink #9A4A2E` · `--primary-soft rgba(193,95,60,0.1)` (duplicate accent under a second name — ⚠️). Callouts: info bg `#EAF1FE`/border `#C9DAFA`/ink `#2456C6`; warn bg `#FFF3E4`/border `#F0D9B5`/ink `#9A5A00`; danger bg `#FDECEC`/border `#F5C6C2`/ink `#B3261E`; sidenav hover `rgba(87,83,78,0.07)`; selection `#F0D9CC`; code rainbow `#23201C #3F3B36 #7A3DC0 #B3401E #22A355 #0E6E3E #E2DED4 #D6D0C4 #C9C2B4 #A8A29E #9B9489`.

### 1i. 404 (`landing/404.html:13-23`, one-off theme)

`--porcelain #E9EFEA` · `--card #F6F9F6` · `--ink #15211E` · `--ink-soft #3A4A46` · `--teal #0E7C6B` · `--teal-deep #0A5A4E` · `--copper #B44A1F` · `--mist #9AA9A3` · `--line #C9D4CE`.

### 1j. Color drift (same purpose, different value) → see cleanup checklist §8

Chart blue `#3b82f6` vs `#4290F0`; error text `#dc2626` / `#b00` / `#f04438` / `#ef4444`; success `#15803d` / `#166534` / widget `#16a34a`; hover gray `#f0f0f0` / `#f5f5f5` / `#ececec`; track gray `#eee` vs `#f0f0f0` vs `#f5f5f5`; secondary text `#525252` vs `#737373`; four unrelated `--ink` values (`#111`, `#141413`, `#1B1917`, `#15211E`); three unrelated `--line` values (`#e5e5e5`, `#e8e6dc`/`#E8E3D9`, `#C9D4CE`); accent `#d97757` (landing) vs `#C15F3C` (docs) vs `#B44A1F` (404).

---

## 2. Typography

### 2a. Font families (actual `font-family` declarations)

| Role | Admin app | Landing | Docs | 404 |
|---|---|---|---|---|
| Body | `ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif` (`pages.ts:124,703`) | `"Inter",ui-sans-serif,system-ui,sans-serif` (`index.html:37`) | `-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif` (`docs.html:32`) | `"Inter",ui-sans-serif,system-ui,sans-serif` |
| Headings | same as body, weight 600 | `"Source Serif 4",Georgia,serif`, weight 400 (`index.html:45-50`) | same as body (no serif) | `"Bricolage Grotesque","Inter",sans-serif`, weight 700 |
| Mono/code | `ui-monospace,SFMono-Regular,monospace` (`shell.ts:97`, `pages.ts:1080`); playground also `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace` | `"IBM Plex Mono",monospace` | mono snippets (same Plex stack in code blocks) | `"IBM Plex Mono",monospace` |
| External webfonts | **none** (system only) | Inter 400/500/600 · IBM Plex Mono 400/500 · Source Serif 4 400/600 via Google Fonts (`index.html:9-11`) | system stack (no webfont link) | Bricolage Grotesque 400/600/700 · Inter · IBM Plex Mono via Google Fonts (`404.html:11`) |

### 2b. Font sizes actually used, ascending (with usage)

**Admin (`src/admin/*`):**
| Size | Usage |
|---|---|
| `10px` | chev markers, `ana-y`, thumb `.tag`, sub rails (`pages.ts:154,242,316,860,880,1097`) |
| `10.5px` ⚠️ | `.sub small` only (`pages.ts:154`) |
| `11px` | `sec-label`, `pill`, `krow .use`, `ana-cap`, `fld label`, `submit .hint`, thumb button, params-grid label (`pages.ts:88,204,209,301,1062,1073,1099,1077`) |
| `12px` | kbd, `p-foot`, `icon-btn` label, `ana-title`, chart-tip rows, `stat-list .sd`, chev, attach `.filebtn` (`pages.ts:141,214,280,850,863,876,1089`) |
| `12.5px` ⚠️ | `range-pill`, `ana-delta`, code `pre`, modes buttons, `use-stat` (`pages.ts:272,285,1080,1101,1711`) |
| `13px` | body copy default: rows, lists, `krow`, buttons, back/crumb, tips, stat rows, `prov-lg` (`pages.ts:84,210,303,993`) |
| `13.5px` ⚠️ | `qlinks a` only (`pages.ts:262`) |
| `14px` | inputs, `mi` nav, header links, `sb-acct`, msg body, `.btn`, message ghost (`pages.ts:127,142,1049`) |
| `15px` | `chead b`, `icon-btn`, `analytics-head h2` (`pages.ts:708,841`) |
| `16px` | `p-head b`, `title-wrap b` (`pages.ts:203,1710`) |
| `18px` | `stat-mini b` (`pages.ts:323`) |
| `20px` | `.ana-card.small .ana-value b` (`pages.ts:284`) |
| `22px` | `.ana-value b` (`pages.ts:283,853`) |
| `26px` | `.ana-card.primary .ana-value b` (`pages.ts:299,867`) |
| `clamp(22px,5vw,30px)` → later overridden to `clamp(20px,4vw,26px)` | home `h1` (`pages.ts:183,222`) — ⚠️ duplicate rule, second wins |
| `clamp(20px,4vw,26px)` | `.page-head h1` (`shell.ts:82`) |

**Landing / docs / 404:** `11, 11.5, 12, 12.2, 12.3, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 22, 23, 24, 29, 34px` + hero clamps `clamp(40px,4.6vw,58px)` (h1), `clamp(28px,3.2vw,40px)` / `clamp(28px,3vw,40px)` (h2), `clamp(26px,2.6vw,34px)`, 404 `clamp(30px,5vw,42px)`. Body: landing 15px, docs 14.5px, 404 15px.

### 2c. Weights & line-heights

Weights in use: **400 / 500 / 600 only** (admin + landing); docs adds **700** (`.brand b`, headings); 404 adds **700** (h1). One `font-weight:650` anomaly in docs sidenav active state. No 300/800/900 anywhere.
Line-heights: admin `1.2` (ana values), `1.25` (title-wrap), `1.65` (code pre); landing `1.08` (serif display), `1.55` (body), `1.6/1.65/1.7` (code/term); docs `1.15/1.45/1.5/1.6/1.65`; 404 `1.08/1.55`.
Letter-spacing: `.08em` uppercase labels (`sec-label`, admin), `.05em` (`fld label`, playground), `1px` (`ana-dots`), landing `-.015em` serif / `-.02em` 404 h1 / `.06em` footer h5.
Tabular numerals: `font-variant-numeric:tabular-nums` on all stats/deltas/meters (`pages.ts:230,283,874`).

### 2d. One-off size flags ⚠️
`10.5px` (single `.sub small`), `13.5px` (single `qlinks a`), `12.5px` (5 scattered uses — quasi-scale, keep or round to 12/13), `12.2/12.3px` terminal type (landing), `11.5px` term-bar (landing), `17px` eyebrow glyph (landing). Clean core is otherwise 10/11/12/13/14/15/16.

---

## 3. Spacing & layout

### 3a. Spacing scale actually used (gaps + paddings, sorted)

Gaps (flex/grid `gap`): `1, 2, 4, 6, 7, 8, 10, 12, 14, 16, 18, 24, 28, 30, 32, 40, 48px`. Dominant: **8px (41 uses), 10px (19), 6px (10), 4px (10), 12px (9), 16px (6)**. Outliers: 7px (inline ledger rows), 1-2px (title stacks, tabs), 30/40/48px (landing hero/split grids only).
Padding idioms (admin): cards **`18px`** universal (`page-card`, `support-card`, `.card`, `.chat`, `.code`, `.studio`); pills `3px 10px` / `6px 12px`; list rows `8px 10px` / `7px 0`; header `0 16px`; sidebar nav `12px 11px 12px 14px`; `ana-card 12px 14px 6px`; buttons by height (below).
Heights: header **56px**; `sb-header` 58px; `sb-footer` 48px; buttons **28 / 30 / 32 / 34 / 36 / 38px** (⚠️ 6 heights — §8); inputs **34 / 36 / 38px**; search-box 34px; icon-btn 30/32/34px; meter 4px.

### 3b. Grid / containers / breakpoints

| Item | Value | Source |
|---|---|---|
| Admin content max | `1400px` (`.wrap`), side pad `0 8px`, detail gap 16 / home gap 24 | `shell.ts:80`, `pages.ts:176` |
| Home grid | `minmax(0,1fr) minmax(320px,380px)`, sticky analytics `top 72px` | `pages.ts:178-179` |
| Playground grid | `minmax(0,1fr) 400px`, min-h 560px, 1fr under 900px | `pages.ts:1055-1061` |
| Support grid | `1fr 1fr` → 1fr under 900px | `shell.ts:89-90` |
| Landing page | `1180px`; wells/panels `1020px`; plans `940px`; faq `720px` | `index.html:84,141,158,172,231` |
| Docs layout | `1440px`, grid `250px minmax(0,1fr) 220px`, gap 32 | `docs.html:44-46,106-110` |
| Breakpoints in use | `520, 640, 720, 900/901, 960, 1024, 1100, 1120px` + `prefers-reduced-motion` (4 sites) | grep §media |
| Admin collapse | sidebar var `--sbw:260px` ↔ `57px`; peeking 260px; mobile ≤720px forced 57px | `shell.ts:6-7,34` |
| Card padding convention | **18px both mobile + desktop** (no responsive step — ⚠️ gap: 16px mobile convention missing) | `shell.ts:86`, `pages.ts:706` |
| Detail top pad | `32px 16px 24px`; home hero `16vh 16px 24px` | `shell.ts:79`, `pages.ts:175` |

---

## 4. Components

### Buttons
| Variant | Style | States | Source |
|---|---|---|---|
| Header/nav text btn | 14px, pad 6/12, r8, transparent; hover `#f0f0f0` | default/hover/focus-visible (2px `#111`) | `pages.ts:127-128` |
| Keys solid (default `button`) | bg `#111`, white, border `#e5e5e5`, r8, h36, pad 0/14, 14px | default only (no hover/disabled defined — ⚠️) | `pages.ts:711` |
| Keys `ghost` / `ghost sm` | bg `#fff`, ink `#111`; sm h28 12px | default only | `pages.ts:712` |
| Slotrow primary | bg `#111` white, r10, h38, pad 0/16 (home) vs 0/14 + border (provider, ⚠️ drift) | default only | `pages.ts:213` vs `1722` |
| Playground `.btn` | bg `#fff`, border `#e5e5e5`, r8, h34, 13px, inline-flex gap 6; hover `#f5f5f5` | default/hover (no focus/disabled — ⚠️) | `pages.ts:1053-1054` |
| `.iconbtn` / `.icon-btn` | 30-32px square, r8, border `#e5e5e5` (playground) or transparent (analytics); hover `#f0f0f0` + ink | default/hover | `pages.ts:844,1070` |
| `.submit` (playground CTA) | pill r999, border `#f04438`, bg `#fff`, pad 8/24, 600 14px, ring `0 0 0 3px rgba(240,68,56,.15)`; `:disabled` opacity .5 + `cursor:wait` | default/disabled (no hover — ⚠️) | `pages.ts:1071-1072` |
| Segmented `.seg` / `.modes` | track `#ececec` r999 pad 2; btn transparent r999 pad 5/16 (seg) or 5/14 (modes), `#525252`; `.on` bg `#fff` + `0 1px 2px rgba(0,0,0,.15)` + `#111` 600; `.modes .off` opacity .4 not-allowed | default/on/off | `pages.ts:1048-1050,1100-1103` |
| `.filebtn` | r8 h32 12.5px border `#e5e5e5`; hover `#f5f5f5`; `.off` opacity .4 not-allowed | default/hover/off | `pages.ts:1089-1091` |
| Landing `.btn-dark` / `.btn-light` | r8 pad 9/16 13.5px 500; dark bg ink→`#000` hover; light bg card border line→ink hover; footer inverted cream/transparent variants (inline `404`/`index` footer) | default/hover | `index.html:68-82,617-618` |
| Widget `#pa-panel button` | bg `#111` white r8 h32; `.ghost` bg `#fff` ink | default only | `tools-api-base.js:174-175` |
| Global | `button:focus-visible, a:focus-visible { outline:2px solid #111; offset 2px }` | focus | `pages.ts:217` |

⚠️ No loading spinner state, no destructive variant (delete uses `ghost sm`), no primary/secondary naming — "primary" is just bare `button`.

### Inputs / selects / textareas
| Variant | Style | Source |
|---|---|---|
| Keys `input,select` | border `#e5e5e5`, r8, h36, pad 0/10, 14px, `flex:1 min-width:140px` | `pages.ts:710` |
| Slotrow input | r10, h38 (home `height`, provider `min-height` — ⚠️), same border/pad | `pages.ts:212,1721` |
| Search-box (home) | bg `#f5f5f5`, border line, r9, h34, pad `0 4px 0 10px`; inner input transparent borderless 14px; `:focus-within` border transparent + blue ring | `pages.ts:187-189,219` |
| Playground `.ctl` | border `#e5e5e5`, r8, h34, 13px, bg `#fff`; `select.ctl` max-w 220; `input.model` min-w 220 | `pages.ts:1051-1052` |
| Ghost textarea `.ghost` | borderless transparent, 14px, pad 2/0, min-h 24, `resize:vertical` | `pages.ts:1063` |
| `kbd` | h20 min-w 20, r4, bg `#fff`, border `#e5e5e5`, 12px, `#525252` | `pages.ts:191` |
| Edit-row inline inputs | `flex:1/2`, min-w 70-110px, no dedicated error ring (relies on `.err` text) | `pages.ts:776,778` |
| Widget input | border `#e5e5e5` r8 h34 13px | `tools-api-base.js:172` |

### Cards / surfaces
`.page-card` + `.support-card` + keys/pools `.card` + `.chat` + `.code` + `.studio`: **bg card, 1px line, r16, pad 18** (consistent ✓). `ana-card`: r12, pad `12/14/6`, hover border `#d4d4d4`. `stat-list`/`tips`/`tips-banner`: r12, pad `4/14`–`12/14`. `prov` (grid tile): r10, pad 10/6, min-h 76, 11px 500, hover `#f5f5f5`. `prov-lg`: r12, pad 10/12, 13px 600. `msg`: r12 pad 12/14; user `#f5f5f5`; assistant `#fff` + `#e5e5e5` border; err variant border `#f3b7b3` + bg `#fff5f4`. `krow`/`li`: bg `#f5f5f5`, r8-10, pad 8/10, 13px. `pill`: bg `#f0f0f0`, r999, 11px 600, pad 3/10, `margin-left:auto`. `range-pill`: card bg, line border, r999, pad 6/12, 12.5px 500. `meter`: h4 r999, track `#eee` (admin) / `#f5f4ed` (landing), fill `#3b82f6` (admin) / ink (landing), w64 (prov-lg).

### Modal / dialog
`dialog`: 1px line, **r16**, pad 0, max-w 640, `width:calc(100vw-48px)`; `::backdrop rgba(0,0,0,.3)`; sections `p-head` (pad 16/20/12, img 28, b 16) / `p-body` (pad 12/20/16, gap 8) / `p-foot` (border-top line, 12px subtle). No animation, no size variants (⚠️).

### Nav / tabs / tables / tooltip
- Sidebar `.mi`: flex gap 10, h34 min, pad 0/12, r8, 14px 500 `#111`, icon 18px @.5 opacity; hover `#f0f0f0`; `.active #ececec`; chev 12px @.4; sub-rail 1px line at left 19px. Collapse btn 34px r8, `#737373` → hover `#f0f0f0`/`#111`.
- Header: 56px sticky, card bg, bottom line, pad 0/16.
- Landing `.tabs`: card border r999 pad 4, btn r999 pad 7/16 13px, `.on` ink bg white. Docs tabs: underline idiom (2px transparent → ink, 600 on).
- Tables: **no `<table>`** — the table idiom is `.stat-list .srow` (flex baseline, 13px, divider `#f0f0f0`, pad 7/0; `.sv` 600 tabular right; `.sl` subtle left) and `.qlinks a` rows (pad 9/2, r8, hover `#ececec`, arrow slides 4px).
- Tooltip `.chart-tip`: absolute, `#fff`, line border, r10, `0 8px 24px rgba(0,0,0,.12)`, pad 8/10, min-w 150; dot 10px r999 `#4290F0`; `.no-data` pill (11px, r999, border line, centered 38%/50%).

---

## 5. Elevation & effects

| Level | Value | Usage |
|---|---|---|
| `none` | `box-shadow:none` | search-card, search-box (explicit reset) |
| `sm` | `0 1px 2px rgba(0,0,0,.15)` | `.seg button.on`, `.modes button.on` |
| `md` | `0 8px 24px rgba(0,0,0,.12)` | `.chart-tip` |
| `md-widget` | `0 4px 16px rgba(0,0,0,.08)` / `0 12px 40px rgba(0,0,0,.14)` | widget btn / panel |
| `lg` | `0 12px 40px rgba(31,30,28,.1)` | landing hero `.win`; `0 20px 60px rgba(0,0,0,.18)` docs modal-ish; `0 8px 24px rgba(20,20,19,.06)` run-card hover |
| rings | search `0 0 0 1.5px rgba(59,130,246,.4)`; submit `0 0 0 3px rgba(240,68,56,.15)` | focus / CTA glow |

Borders: **all 1px solid** (except 404 `.go a.secondary` 1.5px, docs tab underline 2px, `cap` left rail 2px, transparent 1px placeholders on `.icon-btn`/`.ctl`). Colors: `var(--line)` 31 uses + `#e5e5e5` 13 direct (⚠️ same value, two spellings), dividers `#f0f0f0`, dashed `var(--line)` once (`.conn-empty`).
Focus: admin `outline:2px solid #111; offset:2px` (buttons/links) but `input:focus-visible { outline:none }` (relies on container ring — ⚠️ keyboard affordance lives on wrapper only); landing `2px ink offset 3 r6`; docs `2px accent offset 2 r4` (+`2px primary offset -1` sidenav); 404 `2px copper offset 3 r4`.
Motion: `grid-template-columns 250ms cubic-bezier(0.77,0,0.175,1)` (sidebar); `opacity 150ms ease` (labels); `border-color 150ms` (ana-card); `transform 200ms` (chevrons); `translateX 4px 150ms` (qlinks arrow); `fadeSlide .28s cubic-bezier(.2,.7,.3,1)` (cards/tiles) + `.25s ease` (krows); `pageIn .3s ease` (content); landing `travel 2.6s linear` conduit, `blink 1.1s steps(1)`, reveal `.6s ease`; dial cursor `.45s cubic-bezier(.3,1.4,.4,1)`; `prefers-reduced-motion` disables all (4 sites ✓).

---

## 6. Iconography

- **No icon library / no icon font / no emoji font dependency.** All icons are **custom inline stroke SVGs** (`src/admin/branding.ts:18-30`), `stroke="currentColor"`, `fill="none"`, round caps+joins.
- Sizes: nav/home/pools/keys/playground/analytics/docs icons **18×18** (`svgIcon`, rendered via `.mi .ic svg { 18px }`, `shell.ts:20`); collapse glyph 18×18 @1.5 (inline in `shell.ts:44`); external-link marker **12×12** @2.2 (`.mi .ext`); sidebar icon slot 16px box holding 18px svg (intentional 2px bleed). Logos: 36px (sidebar/home), 28px (page-head), 24px (chead/prov tile), 22px (landing grids), 16px (hero ledger).
- Stroke widths: **1.8** standard, **1.5** collapse, **2.2** external marker; chart lines 1.8, grid 1, dial rings 1.5-2.
- Landing decorative glyphs (✦ ❖ ▦ ⚙ ◍ ✓ + – ↗ ↘ ― ◷ ↻ ⧉ ＋ ● ▶ ✕ ⌘) are text characters, not a system.

---

## 7. Token export — canonical files (Phase 2 — docs-derived, supersedes the draft below)

- **`design-tokens.json`** — single source of truth (all values,with `uses` + provenance). Verified against:
- **`src/admin/tokens.ts`** — `tokensCss` `:root` block interpolated by admin pages at runtime. Parity enforced by **`scripts/check-tokens.ts`** (`npx tsx scripts/check-tokens.ts` → "tokens OK — 53 values").
- Key excerpts (see files for the full set):
```css
:root {
  --paper:#FFFFFF; --paper-2:#F5F5F4; --card:#FFFFFF; --bg:#FFFFFF;
  --ink:#1B1917; --ink-soft:#57534E; --ink-faint:#8A8680; --body-copy:#3F3B36;
  --line:#E8E3D9; --line-soft:#EFEAE1; --active-pill:#E9E5DB;
  --accent:#C15F3C; --accent-ink:#9A4A2E; --accent-soft:rgba(193,95,60,0.1);
  --green-bg:#EBF6EC; --green-line:#BFE3C4; --green-ink:#1E6B32;
  --danger-bg:#FDECEC; --danger-line:#F5C6C2; --danger-ink:#B3261E;
  --radius-xs:5px; --radius-sm:6px; --radius-md:8px; --radius-lg:10px; --radius-xl:12px; --radius-pill:999px;
  --ctl-sm:26px; --ctl-icon:30px; --ctl-md:34px;
  --font-sans:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-serif:Georgia,"Times New Roman",serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light;
}
```
Tailwind seed: map `design-tokens.json` keys 1:1 (`colors.ink`, `fontFamily.serif`, `borderRadius.xl`, `height.ctl-md`, …) — no separate seed kept, the JSON *is* the seed.

### 7x. Superseded draft — pre-docs `:root`/tailwind seed (kept for history, do not use)

### 7a. `:root` CSS variables (admin app — paste-ready; drift resolved toward the majority value, alternatives in §8)

```css
:root {
  /* surfaces */
  --bg: #fafafa;
  --card: #ffffff;
  --surface-hover: #f5f5f5;
  --surface-active: #ececec;
  /* lines & text */
  --line: #e5e5e5;
  --line-hover: #d4d4d4;
  --ink: #111111;
  --subtle: #737373;
  --muted: #a3a3a3;
  --divider: #f0f0f0;
  /* accent (chart/meter/focus) */
  --accent: #3b82f6;
  --accent-fill: rgba(59, 130, 246, 0.10);
  --accent-ring: rgba(59, 130, 246, 0.4);
  /* semantic */
  --success: #15803d;
  --success-bg: #f0fdf4;
  --success-border: #bbf7d0;
  --warning-text: #92400e;
  --warning-bg: #fef3c7;
  --warning-border: #f5d67b;
  --error: #dc2626;
  --error-text: #b00000; /* canonicalizes #b00 */
  --error-border: #f3b7b3;
  --error-bg: #fff5f4;
  --error-ring: rgba(240, 68, 56, 0.15);
  /* shape & type */
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 999px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
```

### 7b. `tailwind.config.js` theme seed (admin app)

```js
/** Seed generated from implemented admin styles — see design-system.md §8 before adopting. */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: '#fafafa',
        card: '#ffffff',
        line: '#e5e5e5',
        subtle: '#737373',
        muted: '#a3a3a3',
        divider: '#f0f0f0',
        hover: '#f5f5f5',
        active: '#ececec',
        ink: '#111111',
        accent: '#3b82f6',
        success: '#15803d',
        'success-bg': '#f0fdf4',
        warning: '#92400e',
        'warning-bg': '#fef3c7',
        error: '#dc2626',
        'error-bg': '#fff5f4',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: '11px', sm: '12px', base: '13px', md: '14px',
        lg: '15px', xl: '16px', '2xl': '22px', '3xl': '26px',
      },
      borderRadius: { sm: '8px', md: '10px', lg: '12px', xl: '16px', pill: '999px' },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,.15)',
        md: '0 8px 24px rgba(0,0,0,.12)',
        ring: '0 0 0 1.5px rgba(59,130,246,.4)',
        'ring-error': '0 0 0 3px rgba(240,68,56,.15)',
      },
      maxWidth: { wrap: '1400px' },
    },
  },
};
```

---

## 8. Cleanup checklist (inconsistencies — same purpose, different value)

- [ ] **Chart blue:** `#3b82f6` (`pages.ts:232,942` meter + analytics const) vs `#4290F0` (`pages.ts:296` tooltip dot). Pick one.
- [ ] **Error reds (4):** `#dc2626` (deltas) vs `#b00` (`.err`) vs `#f04438` (submit border) vs `#ef4444` (charts). Pick text/border/chart roles.
- [ ] **Success greens (3):** `#15803d` (delta) vs `#166534` (cap-note) vs `#16a34a` (widget dot, `tools-api-base.js:168`). Pick one.
- [ ] **Hover gray (3):** `#f0f0f0` (nav/header) vs `#f5f5f5` (tiles/buttons) vs `#ececec` (active/qlinks hover) — sometimes hover is darker than active. Define `hover`/`active` ramps.
- [ ] **Track gray:** `#eee` (`.meter`, `pages.ts:231`) vs `#f0f0f0` vs `#f5f5f5`. Unify to one track token.
- [ ] **Secondary text:** `#525252` (seg/modes/kbd) vs `#737373` (`--subtle`). Merge or name distinct roles.
- [ ] **Border spelling:** `1px solid #e5e5e5` (13× hardcoded, e.g. `pages.ts:710-711`) vs `1px solid var(--line)` (31×, identical value). Lint to the var.
- [ ] **Slotrow primary padding:** `0 16px` borderless (home, `pages.ts:213`) vs `0 14px` + `1px solid #e5e5e5` (provider, `pages.ts:1722`).
- [ ] **Input heights:** 28 / 30 / 32 / 34 / 36 / 38px across `button`, `.btn`, `.ctl`, `.iconbtn`, slotrow, widget. Collapse to 3 (sm/md/lg).
- [ ] **Radii:** 4 / 6 / 8 / 9 / 10 / 12 / 16 / 999px in admin alone (plus landing 5/6/7/14/20/50%). `9px` (search-box) and `4px` (kbd) are the outliers.
- [ ] **Duplicate `h1` rule:** `clamp(22px,5vw,30px)` then `clamp(20px,4vw,26px)` (`pages.ts:183,222`) — dead first rule, delete.
- [ ] **Duplicate accent names:** docs `--accent` + `--primary` are both `#C15F3C` (`docs.html:20,101`). Keep one.
- [ ] **Four `--ink`s / three `--line`s / three accents** across admin/landing/docs/404 (`#111` vs `#141413` vs `#1B1917` vs `#15211E`). Either bless separate brand themes per surface or converge.
- [ ] **`--cream: #ffffff`** (landing `index.html:14`) — name lies; rename to `--paper`/`--white` or give it the intended cream value.
- [ ] **Focus asymmetry:** `input:focus-visible { outline:none }` (`pages.ts:218`) leaves keyboard users dependent on the search-box wrapper ring; bare `button`/`input` elsewhere have no focus style besides the global `#111` outline. Audit all focusables.
- [ ] **`font-weight:650`** (docs sidenav) — non-standard step; use 600/700.
- [ ] **Stray `color:#eee`-style leftovers:** `background:#eee` meter, `#000` video bg, `#9ca3af` single-use code gray — fold into scale or tokenize.

## 9. Gaps (what a design system normally needs that this codebase lacks)

1. **No central theme file.** Tokens live in 7+ `<style>` blocks across 6 files; `sharedLayoutCss` (`shell.ts:72-97`) is the closest thing and only holds 4 vars. Any token change must be edited per-page.
2. **No dark mode.** `color-scheme:light` only; every surface hardcodes light hexes.
3. **No spacing scale.** Gaps/paddings are ad-hoc (8px-dominant but 1–48px observed); no 4pt grid enforcement, no responsive card-padding step.
4. **No button hierarchy.** No named primary/secondary/destructive/loading API; destructive "Delete pool"/"Remove" reuse `ghost sm`; submit has `:disabled` but nothing else does; zero `:hover` on keys-page buttons.
5. **No input error state.** Invalid input surfaces only as `.err` text (`#b00`); no red border/ring/icon convention.
6. **No table component.** Usage data is flex `.srow` divs, not `<table>` — no sortable-header, numeric-alignment (beyond tabular-nums), or empty-state pattern beyond `.conn-empty`.
7. **No toast/tooltip/popover system** beyond the chart `.chart-tip` and widget panel; no modal size variants or animations.
8. **Hardcoded colors instead of tokens.** 13× `#e5e5e5`, 38× `#111`, 22× `#fff` written literally; only `--line/--subtle/--bg/--card` are var-ified (admin), and landing/docs/404 each re-declare their own same-named vars with different values, so vars are **not global**.
9. **No type scale doc.** 10–26px + 4 clamp rules + 4 one-off fractional sizes (10.5/12.5/13.5/12.2-12.3); body size differs per surface (13 admin / 15 landing / 14.5 docs).
10. **No icon contract.** Sizes 12/16/18px and strokes 1.5/1.8/2.2 are per-call-site constants in `branding.ts`; no `size=` prop, no stroke standard, no library to tree-shake.
11. **No elevation scale.** 6 shadow values with overlapping roles (tooltip vs card-hover vs widget); nothing above `lg` for modals/drawers.
12. **A11y gaps:** `outline:none` on inputs, `color:#a3a3a3`-on-white microcopy (~4.0:1 at 10-11px — borderline), no visible focus on segmented controls, `.mi .ic` icons at 50% opacity over white.

---

## 10. Docs canonical reference (Phase 0 — docs-first source of truth)

> Everything below is from `landing/docs.html` only (983 lines, re-read end-to-end). Docs is **not** the webfont trio from `landing/index.html`:
> body = system stack (Inter is 3rd fallback, effectively unused), headings = **Georgia** serif (not Source Serif 4), code = **system mono** (not IBM Plex Mono).
> Docs has exactly **two** callout variants (`info`, `tip`) — no blue/amber variant exists. Corrections to §§1h/2a/4 where they blended landing numbers are noted inline.

### 10a. Docs `:root` exact (`docs.html:10-27` + `100-104`)

```css
:root {
  --paper: #FFFFFF;  --paper-2: #F5F5F4;  --card: #FFFFFF;
  --ink: #1B1917;  --ink-soft: #57534E;  --ink-faint: #8A8680;
  --line: #E8E3D9;  --line-soft: #EFEAE1;  --active-pill: #E9E5DB;
  --accent: #C15F3C;  --accent-ink: #9A4A2E;
  --code-bg: #F5F5F4;
  --green-bg: #EBF6EC;  --green-line: #BFE3C4;  --green-ink: #1E6B32;
  --radius: 8px;
  /* second block re-declares the accent under new names (dup — §8 #12): */
  --primary: #C15F3C;  --primary-ink: #9A4A2E;  --primary-soft: rgba(193, 95, 60, 0.1);
}
```

Docs gray scale light→dark: `#FFFFFF` (paper/card) · `#F5F5F4` (paper-2/code-bg) · `#EFEAE1` (line-soft) · `#E9E5DB` (active-pill) · `#E8E3D9` (line) · `#E2DED4` (info icon chip) · `#D6D0C4` (scrollbar thumb) · `#C9C2B4` (link underline) · `#A8A29E` (chevron btn) · `#9B9489` (tok-com) · `#8A8680` (ink-faint) · `#57534E` (ink-soft) · `#3F3B36` (**body copy color**) · `#23201C` (code text) · `#1C1917` (dark code bg) · `#1B1917` (ink). Note body copy is `#3F3B36`, not `--ink`.

### 10b. Docs font mapping exact (corrects §2a: this replaces, not merges)

| Role | Stack | Source |
|---|---|---|
| Body | `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`, **14.5px / 1.65** | `docs.html:30-34` |
| Headings | `Georgia, "Times New Roman", serif`, weight **500**; h1 34px/1.15/-0.01em (29px ≤860px), h2 23px, h3 14.5px **650** | `docs.html:186-204,369` |
| Code | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, 12.5px/1.6 | `docs.html:218-222,245-249` |
| Eyebrow | body stack, **11px, 700, .08em**, `ink-faint` | `docs.html:184` |

Docs type scale (freq-verified): 13px ×16 (base UI), 12.5px ×8 (code/meta/toc), 13.5px ×7 (callouts/tables/ep), 11px ×4, 14px ×3, 12px ×3, 15px ×2 (brand/h-anchor), 14.5px ×2 (body/h3), 34/29/23 headings. No fractional strays besides the intentional 12.5/13.5/14.5 steps.

### 10c. Docs spacing scale (grep-verified, docs-only)

Gaps: `1×2, 2×2, 4, 6×5, 8×3, 9, 10×6, 12×3, 18, 24, 28, 32`. Dominant **10px / 6px / 8px / 12px** — cf. admin's 8/10/6/4 (§3a): same atoms, different ranking.
Radii: `5×2` (m badge, search kbd), `6×4` (inline code, code-tools btn, lang), `7` (copy-page), `8×3 + var(--radius)×2` (code, callout, search, open-btn, icon-btn), `10×2` (acc, ep), `12×2` (sidenav rows), `50%` (callout icon), `999×2` (feedback pill). **No 4/9/16px radii anywhere in docs.**
Heights (computed): code-tools 26 · copy-page/feedback ≈28–30 · icon-btn/search 30 · open-btn ≈33–34 · acc-btn ≈42. Canonical set: **{26, 30, 34}** (sm/icon, md/control, lg/open) — replaces admin's 6-height sprawl (§8 #9).
Layout: topbar-row + tabs-inner + layout + footer-inner all `max-width:1440px`, pad `0 20px`; article `max-width:760px`, pad `26px 0 20px`, measure `70ch`; grid `250px minmax(0,1fr) 220px` gap 32 (→230px+1fr ≤1120px, →1fr drawer ≤860px); breakpoints **860 / 1020 / 1120** only (+reduced-motion).

### 10d. Docs components in §4 format (for diffing vs admin/landing)

| Component | Variants / states | Radius / shadow / border | Source |
|---|---|---|---|
| Button `.open-btn` (primary) | default (`ink` bg, white, 13px 600, pad 7/12) / hover `#000` | r8, `1px solid ink` | `docs.html:72-77` |
| Button `.icon-btn` | 30px square, card bg, line border, ink-soft 14px; `.menu-btn` hidden→shown ≤860px | r8, no shadow | `docs.html:78-83,353-356` |
| Button `.lang` (text) | borderless, 13px ink-soft pad 6/8 r6; hover active-pill + ink | r6 | `docs.html:52-56` |
| Button `.copy-page` | 12.5px ink-soft, card bg, line border, pad 5/10; hover paper-2 + ink; JS swaps to `✓ Copied` 1300ms | r7 | `docs.html:190-195,763-769` |
| Button `.code-tools button` (copy-on-code) | 26px icon, transparent, ink-faint 13px; hover paper-2 + ink + line border; JS swaps glyph to `✓` 1100ms | r6, border transparent→line | `docs.html:256-262,755-762` |
| Button `.feedback button` (pill) | r999 pad 5/12 12.5px, line border card bg ink-soft; hover ink + ink-faint border; `.picked` ink bg white | r999, no shadow | `docs.html:317-322` |
| Button `.acc-btn` (accordion row) | full-width, 13.5px 600 ink, pad 11/14, chev 11px faint rotates 90° on `.open`; hover paper | r10 (on `.acc` shell) | `docs.html:276-289` |
| Input `.search` (⌘K) | card bg, line border, r8, pad 6/10, 13px faint, max-w 420; inner input borderless ink; `kbd ⌘K` (11px, line border, r5, paper bg); filters sidenav live, Enter jumps, Esc clears; `⌘K/Ctrl+K` focuses globally | r8 / r5 | `docs.html:57-68,844-889` |
| Card `.code` (+`.dark`) | card bg, line border, r8(`--radius`), margin 8/0/12, overflow hidden; `pre` pad `13/46/13/14` (right gutter reserves copy btn); `.dark` bg/border `#1C1917`, text `#EDE6DA` | r8, no shadow | `docs.html:241-264` |
| Callout `.callout.info` | paper-2 bg, line border, r8, pad 11/14, 13.5px `#3F3B36`, 20px `ⓘ` chip (`#E2DED4`/`#57534E`), max-w 70ch | r8, no shadow | `docs.html:266-274` |
| Callout `.callout.tip` (green) | green-bg, green-line border, `✓` chip `#22A355`/white — same geometry as info | r8, no shadow | `docs.html:272-273` |
| Tabs `.ptabs` (+`.subtabs`) | underline idiom: 13px ink-soft pad 8/12, 2px transparent underline; hover ink; `.on` ink 600 + **accent** underline; subtabs `.on` uses **ink** underline instead (⚠️ kept as-is, docs is reference) | no radius/shadow | `docs.html:224-238` |
| Sidebar nav (2-level) | sticky top 118, 13px; row `a` pad 6/12/6/16 r12, `#57534E`; hover `rgba(87,83,78,.07)` + ink; `[data-active]` bg primary-soft + primary + faux-bold text-shadow; parent `.nav-row` (link + `.chev-btn` 28px `#A8A29E`, svg rotates 90°); `.sub-list` children pad-left 32; group headers 13px 600 | r12 rows | `docs.html:112-179` |
| Right-rail `.toc` scroll-spy | sticky top 118, 12.5px; links pad 3/0/3/12, 2px transparent left rail; hover ink; `.on` ink 600 + **accent** rail; `.sub` pad-left 24; same rAF scroll-spy as sidebar (mark 140px) | no radius/shadow | `docs.html:328-333,891-958` |
| Table `table.grid` | 13.5px; `th` 12px 600 faint, pad 8/10, bottom line; `td` pad 9/10, bottom line-soft, `#3F3B36` (first col ink); links underlined `#C9C2B4`→accent hover | no radius (wrap scrolls) | `docs.html:291-300` |
| Endpoint plate `.ep` + `.m` badges | card bg, line border, r10, pad 13/15; route mono 13px 600; `.m` 11px 700 r5 pad 2/8: get `#EAF1FE/#2456C6/#C9DAFA`, post `#1B1917`/white, patch `#FFF3E4/#9A5A00/#F0D9B5`, delete `#FDECEC/#B3261E/#F5C6C2` | r10 / r5, no shadow | `docs.html:302-309` |
| Inline code | mono 12.5px, code-bg, line-soft border, r6, pad 1/6, ink, nowrap | r6 | `docs.html:218-222` |
| Token colors | cmd `#B3401E` 600 · url `#2456C6` · str `#0E6E3E` · com `#9B9489` · k `#7A3DC0` | — | `docs.html:251-255` |
| Focus / motion | `:focus-visible { 2px accent, offset 2, r4 }`; sidenav rows `2px primary offset -1`; chev `.18s ease`; sidenav drawer `transform .22s ease` + scrim `rgba(0,0,0,.3)` + open shadow `0 20px 60px rgba(0,0,0,.18)`; h-anchor `opacity .15s` | — | `docs.html:37,153,175,361-367,207-215` |

Net-new vs admin (additive, no admin equivalent): sidebar 2-level nav w/ scroll-spy active, right-rail toc, ptabs/subtabs, callouts, ⌘K search, code+copy pattern, table.grid, endpoint plates, accordion, feedback pills, h-anchor permalinks. Closest admin analogues for re-skin: home `.search-box`→search idiom, playground copy buttons→code-tools, `.tips-banner`→callout, `.stat-list`→table.grid idiom, `.mi.active`→primary-soft/primary.

---

## 11. Reconciliation decisions — docs-tiebreaker version (Phase 1, supersedes §8)

> Rule: docs's value wins wherever docs has an equivalent; otherwise the most-used value stands. This section **replaces** §8 as the decision log — §8 is retained as the original finding list only.

| # | Conflict (§8) | Docs equivalent? | Decision (winner) | What changes |
|---|---|---|---|---|
| 1 | Chart blue `#3b82f6` vs `#4290F0` | None (docs has no chart lines; `#2456C6` is link-only) | **Fallback: `#3b82f6`**; tooltip dot converges to it | `pages.ts:296` dot `#4290F0`→`#3b82f6` |
| 2 | Error reds ×4 (`#dc2626/#b00/#f04438/#ef4444`) | **Yes** — danger plate: text `#B3261E`, bg `#FDECEC`, border `#F5C6C2` (`docs.html:309`) | **Docs wins for text/bg/border**; chart pair `#ef4444` + `rgba(239,68,68,.08)` kept (paired, no equiv) | `.err`/`ana-delta.down`/widget dot → `#B3261E`; `msg.err` → `#FDECEC/#F5C6C2`; submit border `#f04438`→`#B3261E`, ring → `rgba(179,38,30,.15)` |
| 3 | Success greens ×3 (`#15803d/#166534/#16a34a`) | **Yes** — `#1E6B32` / `#EBF6EC` / `#BFE3C4` (+ chip `#22A355`) | **Docs wins** | delta-up + cap-note.ok + widget dot → `#1E6B32`; ok bg/border → docs pair |
| 4 | Hover gray ×3 (`#f0f0f0/#f5f5f5/#ececec`) | **Yes** — hover `paper-2`, active `primary-soft`+`primary` text (sidenav) | **Docs wins**: hover → `#F5F5F4`; **nav active → `rgba(193,95,60,.1)` bg + `#C15F3C` text** (replaces `.mi.active #ececec`) | All hovers converge spelling to `#F5F5F4`; admin sidebar active becomes accent-tinted per docs sidenav |
| 5 | Meter track `#eee` | None | **Judgment: track = `--line` `#E8E3D9`** | `pages.ts:231` `#eee`→`var(--line)` |
| 6 | Secondary text `#525252` vs `#737373` | **Yes** — `ink-soft #57534E`, `faint #8A8680` | **Docs wins**: secondary → `#57534E` (retires both), microcopy → `#8A8680` (retires `#a3a3a3`); primary `#111`→`#1B1917` | Global textRamp swap; prose contexts may use `#3F3B36` (docs body-copy precedent) |
| 7 | Border spelling `#e5e5e5` vs `var(--line)` | **Yes** — everything via `var(--line)` | **Docs wins**: literal → var; `--line` value → `#E8E3D9` | 13 hardcoded borders → var |
| 8 | Slotrow padding `0/16` vs `0/14` (+border) | Partial (button pad-x idiom 12: open-btn, feedback) | **Docs idiom wins**: pad `0 12px`, `border:1px solid var(--ink)` (border matches bg, open-btn precedent) | Both slotrow variants unified |
| 9 | 6 button/input heights | **Yes** — computed set {26, 30, ≈34} | **Docs wins: {26 sm/icon, 30 control-icon, 34 md}**; inputs min-h 34 | Retire 28/32/36/38; widget 34/32→34/30 |
| 10 | Radii 4/6/8/9/10/12/16/999 | **Yes** — docs set {5,6,7,8,10,12,999}, no 4/9/16 | **Docs wins**: kbd 4→5, search 9→8, **page cards + dialog 16→12** (docs max), slotrow inputs 10→8 | Retire 4/9/16 |
| 11 | Duplicate `h1` clamp | N/A (hygiene) | Delete dead first rule | `pages.ts:183` removed |
| 12 | `--accent` + `--primary` dup | **Yes** — same value, two names | Canonical `--accent`/`--accent-ink`; `--primary*` dropped from token file (docs.html itself untouched as reference) | Token file only |
| 13 | Four `--ink`s / three `--line`s / three accents | **Yes** | **Docs wins**: ink `#1B1917`, line `#E8E3D9`, line-soft `#EFEAE1`, accent `#C15F3C` on all surfaces | Landing/404 migrate; landing hero size exempt (§Phase 4 exception) |
| 14 | `--cream: #ffffff` misnomer | **Yes** — `--paper: #FFFFFF` | Rename to `--paper` in token file + landing migration | — |
| 15 | Focus asymmetry (`#111` outline vs blue ring vs none) | **Yes** — `2px accent, offset 2, r4` (+`offset -1` on tinted rows) | **Docs wins globally**; delete `input:focus-visible{outline:none}`; search wrapper adopts accent outline, blue ring retired; submit keeps danger-tinted ring (retinted, no docs equiv) | `pages.ts:217-219` reworked |
| 16 | `font-weight:650` | **Yes** — docs h3 itself is 650 | **Blessed, scoped to headings (h3) only**; UI text stays 600 | Reverses §8 #16 recommendation |
| 17 | Leftovers (`#eee`, `#000` video, `#9ca3af`) | Partial (dark `#1C1917`, `tok-com #9B9489`) | track→line (#5); video bg→`#1C1917`; code tokens→docs tok palette: cmd `#B3401E`, str `#0E6E3E`, num `#9A5A00` (patch-amber precedent), fn `#2456C6`, com `#9B9489` | `pages.ts:1081,1105` reworked |

Cross-cutting consequences: admin body 13px stays (density — Phase 4 adjustment note, not a token conflict); admin `ana-value` 22/26px numerals stay (no docs equiv — dashboard data-viz, fallback most-used); landing hero clamp stays larger (documented exception, Phase 4).

---

## 12. Component mapping — surface selector → docs canonical (Phase 3)

> `src/admin/components.ts` ships both layers. Rebuilt = same selector, docs values (Phase 4 applies). Net-new = `ds-*` class, available everywhere, no admin markup yet (additive).

| Surface selector | Docs canonical | Disposition |
|---|---|---|
| Admin bare `button` (keys solid), `.slotrow button`, `.btn`, `.iconbtn/.icon-btn`, `.filebtn`, widget buttons | `.open-btn` (solid) / `.icon-btn` (30px) / `.code-tools button` (26px) / `.feedback button` (pill) | Rebuilt: solid h34 r8 pad 0/12 + ghost; icon 30px r8; copy 26px (§11 #9) |
| Admin `input/select/.ctl`, slotrow input, widget input | `.search input` idiom (borderless-in-bar) + `.code` blocks use bare `pre` | Rebuilt: r8, line border, h34, 13–14px; search-bar variant r8 |
| Admin `.page-card/.support-card/.card/.chat/.code/.studio` (r16) | `.ep` r10 / `.code` r8 / `.acc` r10; docs max radius 12 | Rebuilt → r12 containers (docs max), pad 18 kept (admin density note, Phase 4) |
| Admin `.pill/.range-pill` | `.m` badges (r5!) / `.feedback` pill r999 / `.active-pill` | Rebuilt: pill r999 kept (feedback precedent); method-badge idiom new as `ds-m` |
| Admin `.mi` nav + `.active` | sidenav `[data-active]` (accent-soft + primary) | Bridge rule in components.ts (accent tint replaces `#ececec`) |
| Admin `.chart-tip` | none (kept) | Kept: r10→r8? **r10 kept** — tooltip has no docs equiv; shadow already `md`-identical. Fallback most-used |
| Admin `.search-box` + `.kbd` | `.search` + `kbd ⌘K` | Bridge rule (r8, kbd r5, accent focus) |
| Admin `.tips-banner` | `.callout.info` | Bridge rule (paper-2, r8, pad 11/14) |
| Admin `.stat-list` | `table.grid` | Bridge rule (faint 12/600 labels, line-soft dividers); full `table.ds-grid` available |
| Admin playground `.k/.s/.n/.fn/.c` | `.tok-*` palette | Bridge rule → docs tok colors |
| Admin `.err/.msg.err/.cap-note/.ana-delta/.submit/.meter` | danger/warn/green plates | Bridge rules (all §11 #2/#3/#5) |
| — (none) | `.callout`, `.ds-code`, `.ds-ptabs`, `.ds-toc`, `.ds-ep`, `.ds-acc`, `.ds-search`, `.ds-feedback`, `.ds-eyebrow` | **Net-new** `ds-*` in components.ts (11 components) |
| Landing `.btn-dark/.btn-light` | `.open-btn` / `.lang`-adjacent light | Phase 4: dark→ink solid r8 (already r8 ✓, pad 9/16 kept — density exception, hover `#000` kept as docs precedent) |
| Landing `.win/.plan/.well/.run-card` (r12–20) | `.ep` r10 / `.code` r8 | Phase 4: converge to r10/r12, keep hero `lg` shadow (docs drawer precedent covers `0 20px 60px` only for drawers — hero keeps `0 12px 40px` as documented exception) |
| 404 `.go a.primary/.secondary` | `.open-btn` / bordered light | Phase 4: full re-skin (simplest surface) |

---

## 13. Surface decisions & density adjustments (Phases 4–5)

> No copy, layout structure, or behavior changed — selectors, markup, IDs, and JS are identical; only declarations. Verified: `tsc --noEmit` clean, all 6 admin routes 200, zero old-hex leaks in rendered HTML (only allowlisted JS chart consts `BLUE #3b82f6`, red `#ef4444`, grid `#EFEAE1`, empty `#E8E3D9`).

### Admin density adjustments (proposed, not silently forced)
- **Body 13px + card pad 18px kept.** Docs article is 14.5px / ep pad 13/15, but admin is a dense dashboard (stat lists, key rows, playground panes); 13px + tabular-nums preserved, colors/dividers converge. Revisit only if readability complaints arise.
- **`ana-value` 22/26px numerals kept** (no docs equiv — data-viz, fallback most-used per §11).
- **Form labels stay `ink-soft`, not faint.** Docs `th` precedent is 12/600/faint, but admin's 11px labels at `#8A8680` would sit at ~4.3:1; `ink-soft` keeps ~5.5:1. Conscious deviation.
- **`.chart-tip` keeps r10.** No docs tooltip exists; shadow already matches `md`.
- **`.pill` count badges → `paper-2`, not `active-pill`.** Matches docs `.change .tag` (cream-2 chip) precedent; `active-pill` reserved for selected states.
- **Sidebar active is the boldest change:** `.mi.active` goes `#ececec` → accent-soft wash + accent text (docs sidenav). Headings go sans-600 → Georgia-500 (docs h-mapping carried exactly). Both are high-visibility; flag for visual review.
- **Pre-existing tree state note:** `src/admin/pages.ts` + `src/admin/shell.ts` already had uncommitted modifications before Phase 4 (see worktree status at Phase 0 start); the Phase 4 commit includes that prior diff alongside the token migration. `landing/*`, `scripts/tools-api-base.js`, and all new files are pure per-phase diffs.

### Landing exceptions (editorial surface)
- **Keeps `max-width:1180px` page + larger display type** (`clamp(40px,4.6vw,58px)` hero). Body, buttons, cards, spacing, focus, and radii converge; headline *scale* stays editorial. Typefaces converge (Georgia/mono/sans vars); terminal/illustration categoricals (`#8AB4FF`, `#7BD88F`, bands, shot tints, conduit) kept — no docs equiv.
- **Breakpoints:** 1100→**1120** (merged to canonical); **960 kept** (top-nav density needs its own collapse — logged exception, not merged to 860).

### 404 (fully in line)
Serif h1 (500, size clamp kept), eyebrow-style status (11/700/.08em/faint, exact docs eyebrow), 1px borders, accent focus, `#000` primary-hover (open-btn precedent). Bricolage/Inter/Plex webfont link retained (zero-risk; Inter still reachable via font stack on Linux).

### Layout decisions (Phase 5)
- Containers per-surface: docs **1440** (chrome) / 760 article / 70ch measure · admin **1400** wrap (kept) · landing **1180** page / 1020 wells / 720 faq (kept editorial) · 404 **560** (kept).
- Canonical breakpoint set: **520 / 640 / 720 / 860 / 900 / 1120** (+reduced-motion). Exceptions: landing **960** (nav), admin `min-901` sticky pair (structural, not a breakpoint addition).
### Layout decisions (Phase 5)
- Containers per-surface: docs **1440** (chrome) / 760 article / 70ch measure · admin **1400** wrap (kept) · landing **1180** page / 1020 wells / 720 faq (kept editorial) · 404 **560** (kept).
- Canonical breakpoint set: **520 / 640 / 720 / 860 / 900 / 1120** (+reduced-motion). Exceptions: landing **960** (nav), admin `min-901` sticky pair (structural, not a breakpoint addition).
- Card padding: admin **18px** both breakpoints (no responsive step — matches docs behavior of fixed card padding; the "16px mobile" convention from §3 was aspirational, never implemented).

---

## 14. Gap closure + verification (Phase 6)

### Gap status vs §9 (framed against docs's component set)
| # | Gap | Status |
|---|---|---|
| 1 | No central theme file | **Closed** — `design-tokens.json` + `src/admin/tokens.ts` + `scripts/check-tokens.ts` (53 values verified) + `src/admin/components.ts` |
| 2 | No dark mode | **Open** — explicitly out of scope; `color-scheme:light`, all tokens light-only |
| 3 | No spacing scale | **Closed as documentation** — `space` scale + canonical gaps in JSON/§10c; no automated enforcement (no linter) |
| 4 | No button hierarchy | **Closed** — solid/icon/copy/pill/ghost + {26,30,34} heights mapped (§12); destructive still reuses ghost (docs has no destructive variant either) — partial by inheritance |
| 5 | No input error state | **Open** — docs has none; errors remain `.err` text, now `danger-ink`. Unchanged capability |
| 6 | No table component | **Closed** — `table.ds-grid` shared + stat-list bridged to table idiom |
| 7 | No toast/tooltip/popover | **Partial** — chart-tip kept + shadow-tokenized; toast system still absent (docs has none) |
| 8 | Hardcoded colors | **Closed** — zero old-hex leaks in rendered admin HTML; landing/404 converge except illustration categoricals (logged, §13) and standalone contexts (widget CSS, SVG attrs use canonical literals) |
| 9 | No type scale | **Closed** — `fontSize` scale in JSON + §10b; fractional strays retired except intentional 12.5/13.5/14.5 steps |
| 10 | No icon contract | **Open** — untouched (no docs equivalent beyond chev rotation, now `.18s`) |
| 11 | No elevation scale | **Closed** — `shadow.sm/md/drawer` + danger/accent rings as tokens |
| 12 | A11y gaps | **Partial** — focus standardized to 2px accent (all surfaces), `outline:none` removed; faint microcopy still borderline by design (docs parity); icon opacity untouched |

### Verification performed
- `npx tsc --noEmit` clean; `node --check scripts/tools-api-base.js` clean; `npx tsx scripts/check-tokens.ts` → 53 values OK.
- All 6 admin routes 200 (`/`, `/pools`, `/keys`, `/playground`, `/analytics`, `/provider/groq`); grep over rendered HTML: **zero** old-hex leaks (only allowlisted JS chart consts).
- `landing/docs.html`: **zero diff** — reference byte-identical in behavior and appearance.
- Screenshots (Chrome headless, /tmp/pa-shots): 4 surfaces × 3 widths (1440/900/480) = 12 PNGs, all visually reviewed: docs unchanged; admin/landing/404 read as the same family (serif headings, accent actives, warm lines, r8–r12 geometry); admin icon-rail collapse (480), docs drawer + hamburger (480), docs TOC-hide (900), landing hero stack (900) all behave as before.
- Net-new shared components introduced (11, §12): `ds-callout`, `ds-code`, `ds-ptabs/subtabs`, `ds-toc`, `ds-table`, `ds-ep`+`ds-m`, `ds-acc`, `ds-search`, `ds-feedback`, `ds-eyebrow`, `ds-inline` (+`ds-code-tools`, `ds-plabel`, `ds-tbl-wrap` helpers).
- Changelog: §11 is the final docs-tiebreaker record (replaces §8, retained as findings).
