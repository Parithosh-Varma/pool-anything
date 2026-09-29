# AGENTS.md — pool-anything

## Standing rules (always apply)

- **Landing page:** `https://pool-anything.pages.dev/` (Pages project `pool-anything`, source dir `landing/`). `landing/` is gitignored — deploy is manual only: `npx wrangler pages deploy landing --project-name pool-anything`. There is no CI redeploy; a checkout can't contain `landing/`.
- **GitHub repo:** `https://github.com/Parithosh-Varma/pool-anything`. Already authenticated — use `git`/`gh` directly, never ask for login.
- **Browser autonomy:** browser / webfetch / websearch use is allowed and encouraged. Research and configure external services end-to-end yourself (e.g. Search Console SEO) instead of asking the user to do it manually.

## Full instructions

Read `instructions.md` for the complete guide: install, `serve` flags, assistant shell, Web UI routes, REST + proxy usage, env config, security, troubleshooting.

## Working conventions

- Node >= 22.5 (`node:sqlite`, no DB to install). Server core is dependency-free (Node built-ins only); do not add runtime deps.
- `npm run typecheck` must pass (strict TS). `npm test` before finishing. `npm run dev` serves `http://localhost:3000`.
- Keys print masked only (`gsk_…ab`); never commit `data/pool-anything.db`; redact keys from logs/bug reports.
- Default bind `127.0.0.1` with no auth — set `POOL_API_TOKEN` if binding non-loopback.
