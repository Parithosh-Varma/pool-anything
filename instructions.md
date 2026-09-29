# pool-anything — Instructions

Gather free-tier API keys into one pool. Rotate through them automatically via round-robin + drop-in HTTP proxy.

## 0. Agent operating notes

See `AGENTS.md` — it is the single source of truth for standing instructions (landing page deploys, GitHub auth, browser autonomy). Follow it before anything below.

## 1. Prerequisites

- Node.js >= 22.5 (uses built-in `node:sqlite`, no DB to install)
- A provider API key (e.g. Groq `gsk_…`, OpenRouter `sk-or-v1-…`, Gemini key)
- Optional: `curl` for API testing

## 2. Install

### Option A — Global (recommended)

```bash
npm install -g pool-anything
pool-anything
```

Data lives in `~/.pool-anything/pool-anything.db` so it works from any directory and survives upgrades.

### Option B — From source

```bash
git clone https://github.com/Parithosh-Varma/pool-anything.git
cd pool-anything
npm install
npm run dev        # watch mode, http://localhost:3000
npm run db:init    # init local SQLite (data/pool-anything.db)
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Watch mode server on `:3000` |
| `npm run build` + `npm run start:dist` | Compile to `dist/` and run it |
| `npm run typecheck` | `tsc --noEmit` (must pass) |
| `npm test` | `tsx --test "tests/**/*.test.ts"` |

## 3. Start the server

```bash
pool-anything serve --port 4000 --open   # web UI + API on :4000, open browser
pool-anything --help                     # all flags
PORT=4000 pool-anything serve            # env-var equivalent
```

Flags: `-p/--port`, `-H/--host` (default `127.0.0.1`), `--db <path>`, `--data-dir <dir>`, `--open`.

Running bare `pool-anything` (TTY) opens the interactive assistant shell instead of the server.

## 4. Create a pool + add keys

### Web UI (easiest)

1. Open `http://localhost:3000`, search provider (try `groq`).
2. Paste one or more keys, hit **Gather**.
3. Pool is live. Manage at `/pools`, `/keys`, test at `/playground`, monitor at `/analytics`.

Routes: `/` (search + dashboard), `/provider/:id`, `/pools`, `/keys`, `/playground`, `/analytics`, `/history`.

### Assistant shell

No subcommands — plain language:

| Say | Does |
| --- | --- |
| `list pools` / `list providers` | Show pools / 36 preconfigured providers |
| `create pool Prod Groq for groq` | New pool for provider `groq` |
| `add 5 keys to groq` | Paste keys, one per line, blank line finishes |
| `show usage for groq` | Tokens, quota, per-key breakdown |
| `next for groq` / `consume 100 on groq` | Rotate / record usage |
| `watch groq` | Live usage, 2s refresh (`q` exits) |
| `update` | Upgrade the global install via npm (also `upgrade`) |
| `uninstall` | `npm uninstall -g pool-anything`; SQLite pools/keys are kept |
| `serve` | Start web UI + API from inside shell |
| `exit` | Quit |

One-shot (no shell):

```bash
pool-anything "list pools"
pool-anything -e "add keys to groq"
echo "gsk_abc" | pool-anything -e "add keys to groq"
```

Keys always print masked (`gsk_…ab`).

### REST API

```bash
# Create pool for groq
curl -X POST http://localhost:3000/api/pools \
  -H 'content-type: application/json' \
  -d '{"provider":"groq","name":"Prod Groq"}'   # -> {"id":1,...}

# Add a key to pool 1
curl -X POST http://localhost:3000/api/pools/1/keys \
  -H 'content-type: application/json' \
  -d '{"label":"key 1","api_key":"gsk_abc"}'

# Rotate (masked) / record usage / usage rollup
curl http://localhost:3000/api/pools/1/next
curl -X POST http://localhost:3000/api/pools/1/consume \
  -H 'content-type: application/json' -d '{"tokens":100}'
curl http://localhost:3000/api/pools/1/usage
```

## 5. Proxy requests through the pool

Point your client at pool-anything; it injects the key + auth header, forwards to the provider `baseUrl`, records usage.

```bash
curl -X POST http://localhost:3000/api/pools/1/proxy \
  -H 'content-type: application/json' \
  -d '{"path":"/chat/completions","method":"POST",
       "body":{"model":"llama-3.3-70b","messages":[{"role":"user","content":"hi"}]},
       "tokens":25}'
```

Body fields: `path` (appended to provider `baseUrl`), `method` (default `POST`), `body` (forwarded as-is), `headers` (extra, override defaults), `tokens` (usage to record).

Response reports who served it:

```json
{"key_id":3,"label":"key 1","masked":"gsk_…ab","status":200,"body":"{ …first 4000 chars… }"}
```

Flow: `nextKeyRaw()` round-robin (`cursor % keys.length`) → inject key → forward → record per-key usage in SQLite. Recent attempts: `GET /api/pools/:id/calls?limit=50`.

## 6. Configuration

Copy `.env.example` to `.env`. All optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind interface (keep loopback unless behind auth) |
| `PORT` | `3000` | Server port |
| `POOL_API_TOKEN` | _(unset)_ | Bearer gate for raw-key reads, writes, rotation, proxy. Send `Authorization: Bearer <token>` |
| `ALLOWED_ORIGINS` | Pages hosts | CORS allowlist (localhost always allowed) |
| `LOCAL_DB_PATH` / `--db` | `data/pool-anything.db` or `~/.pool-anything/*.db` | Exact SQLite file |
| `POOL_DATA_DIR` / `--data-dir` | _(unset)_ | Dir holding `pool-anything.db` |
| `PROXY_TIMEOUT_MS` | `30000` | Upstream timeout per attempt |
| `POOL_DEBUG` | _(unset)_ | `1` = proxy trace to stderr (no bodies/keys) |
| `ALLOW_PRIVATE_UPSTREAM` | _(unset)_ | `1` = disable SSRF guard. Tests/loopback only |

Providers: `data/providers.json` (36 preconfigured: Groq, OpenRouter, Gemini, OpenAI, Anthropic, …). Add one with a single JSON entry — see `CONTRIBUTING.md#adding-a-provider`. `keyHeader` can be a header, `query:<param>`, or custom header; `keyPrefix` handles `Bearer `/`Token ` schemes.

## 7. Security

- DB file (`data/pool-anything.db`) is git-ignored — never commit it.
- List endpoints return masked keys only; raw key only from `GET /api/pools/:id/keys/:keyId`.
- Default bind is loopback with no auth. If you bind non-loopback or expose publicly, set `POOL_API_TOKEN` and keep it behind your own auth layer.

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Unknown option` / CLI confusion | `pool-anything --help`; server needs `serve` or a server flag (`-p`, `--db`, `--open`) |
| DB locked / wrong DB | Check `--db` / `LOCAL_DB_PATH` / `--data-dir`; global uses `~/.pool-anything/` |
| Proxy 4xx/5xx | Check `GET /api/pools/:id/calls` for upstream status/body; verify key + `path` + provider `baseUrl` |
| CORS blocked (Pages UI) | Set `ALLOWED_ORIGINS` to include your UI origin |
| Ink shell won't start | Falls back to plain REPL automatically; pipe mode uses `-e` |
| Type/test failure | `npm run typecheck`, `npm test`, Node >= 22.5 |

Health checks: `GET /health` → `ok`, `GET /api/db/ping` → `{ok:true}`, `GET /api/analytics` → totals + 7-day deltas + 14-day series.
