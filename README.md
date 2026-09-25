<p align="center">
  <img src="src/logo.png" alt="pool-anything logo" width="96" height="96" />
</p>

<h1 align="center">pool-anything</h1>

<p align="center"><b>Gather free-tier API keys into one pool. Rotate through them automatically.</b></p>

<p align="center">
  <a href="https://github.com/Parithosh-Varma/pool-anything/actions/workflows/ci.yml"><img src="https://github.com/Parithosh-Varma/pool-anything/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg" alt="Node" /></a>
  <a href="tsconfig.json"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="Dependencies" /></a>
</p>

<hr />

Most AI/API providers hand you a free tier: a rate limit, a daily quota, a handful of trial tokens. One key's worth is small — but *several* keys, rotated, adds up. **pool-anything** lets you gather N keys for the same provider into a pool, then serves them through a single endpoint that round-robins across them and tracks usage per key.

- 🔁 **Round-robin rotation** — every request draws the next key in the pool
- 📊 **Usage & quota tracking** — per-key and per-pool token counts in SQLite
- 🌐 **Drop-in HTTP proxy** — point your client at pool-anything; it forwards with the right key, header, and auth scheme
- 🔌 **36 providers preconfigured** — Groq, OpenRouter, Gemini, OpenAI, Anthropic, and more (plus any custom provider)
- 🖥️ **Built-in web UI** — search providers, gather keys, watch usage on the Analytics dashboard
- 🧰 **Zero runtime dependencies** — Node built-ins + TypeScript only, `node:sqlite` for storage

## Quick start

```bash
git clone https://github.com/Parithosh-Varma/pool-anything.git
cd pool-anything
npm install
npm run dev
```

Open **http://localhost:3000**, search for a provider (try `groq`), paste one or more API keys, and hit **Gather**. Your pool is live.

Then proxy a request through it straight from `curl` (every proxy call reports the `key_id` that served it, so you can see keys take turns):

```bash
# Pick the next key from pool 1 (round-robin)
curl http://localhost:3000/api/pools/1/next

# Proxy a request — pool-anything injects the key + auth header
curl -X POST http://localhost:3000/api/pools/1/proxy \
  -H 'content-type: application/json' \
  -d '{"path": "/chat/completions", "method": "POST",
       "body": {"model": "llama-3.3-70b", "messages": [{"role": "user", "content": "hi"}]},
       "tokens": 25}'
```

## How it works

```
                ┌──────────────────────────────────────────┐
   your app ───▶│  POST /api/pools/:id/proxy               │
                │                                          │
                │  1. nextKeyRaw()  → round-robin pick     │
                │  2. inject key    → header / query param │
                │  3. forward       → provider baseUrl     │
                │  4. record usage  → SQLite (per key)     │
                └──────────────────────────────────────────┘
                     │              │              │
                     ▼              ▼              ▼
                  key 1          key 2     …    key N
                  (Groq)         (Groq)         (Groq)
```

A **pool** is a named group of keys for one provider. Rotation is a simple cursor over the key list (`cursor % keys.length`), so keys are used evenly. Usage rows record how many tokens each key consumed, and `/usage` rolls that up per key and per pool against the provider's quota.

## API reference

All responses are JSON. `:id` is a pool ID.

### Providers

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/providers` | List all known providers (id, name, quota, hints) |

### Pools

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/pools` | List all pools |
| `POST` | `/api/pools` | Create a pool — `{ provider, name, base_url?, key_header?, key_prefix? }` |
| `GET` | `/api/pools/:id` | Pool summary: key count, usage, quota, per-key breakdown |
| `DELETE` | `/api/pools/:id` | Delete a pool and its keys + usage |
| `GET` | `/api/pools/:id/next` | Rotate: return the next key (masked — never the raw key) |
| `POST` | `/api/pools/:id/consume` | Record usage — `{ tokens: <positive int ≤ 1000000>, key_id? }` (with `key_id`, bills that key without rotating) |
| `GET` | `/api/pools/:id/usage` | Usage rollup — `{ used, usedInWindow, quota, quotaWindow, remaining, perKey }` (`used` is lifetime; `remaining`/`usedInWindow`/`perKey` are windowed for monthly quotas) |
| `POST` | `/api/pools/:id/proxy` | Proxy a request through the pool (see below) |

### Keys

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/pools/:id/keys` | List keys (masked) |
| `POST` | `/api/pools/:id/keys` | Add a key — `{ label, api_key, info? }` |
| `GET` | `/api/pools/:id/keys/:keyId` | Fetch one key (raw) |
| `PATCH` | `/api/pools/:id/keys/:keyId` | Update label / api_key / info |
| `DELETE` | `/api/pools/:id/keys/:keyId` | Remove a key |

### Proxy request body

```jsonc
{
  "path": "/chat/completions",   // path appended to the provider baseUrl
  "method": "POST",              // HTTP method (default POST)
  "body": { "…": "…" },          // JSON body, forwarded as-is
  "headers": { "…": "…" },       // extra headers (override defaults)
  "tokens": 25                   // optional: usage to record for this call
}
```

The response reports which key was used and the upstream status:

```json
{
  "key_id": 3,
  "label": "key 1",
  "masked": "gsk_…ab",
  "status": 200,
  "body": "{ … upstream response, first 4000 chars … }"
}
```

### Health

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness check → `ok` |
| `GET` | `/api/db/ping` | SQLite reachability → `{ ok: true }` |
| `GET` | `/api/analytics` | Totals + 7-day deltas + 14-day daily series (drives the dashboard) |

## Web UI

| Route | Page |
| --- | --- |
| `/` | Provider search + setup panel + Analytics dashboard |
| `/pools` | Pools holding keys, with usage |
| `/keys` | API key manager — add, view, edit, remove keys |
| `/analytics` | Analytics dashboard (totals, 7-day deltas, 14-day charts) |
| `/docs` | Redirect → canonical docs on Cloudflare Pages |

The home page also shows an Analytics dashboard driven by `GET /api/analytics`; the same dashboard lives on its own `/analytics` page.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface to bind (loopback by default; no auth, so keep it local) |
| `PORT` | `3000` | Main server port |
| `LOCAL_DB_PATH` | `data/pool-anything.db` | SQLite database location |
| `PROXY_TIMEOUT_MS` | `30000` | Per-attempt upstream timeout for `/proxy` |
| `ALLOW_PRIVATE_UPSTREAM` | _(unset)_ | `1` disables SSRF protections — tests/loopback only, never in prod |

Providers are defined in [`data/providers.json`](data/providers.json). See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-provider) for the schema — adding a provider is a one-line JSON edit, no code changes.

## Project structure

```
src/
  server.ts          Main HTTP server + web UI (search, pools, keys, playground, analytics; /docs redirects out)
  pool/index.ts      Pool logic: providers, quotas, usage, analytics (SQLite)
  pool/rotation.ts   Round-robin rotation, cooldown, quota windows
  proxy/forward.ts   Upstream forwarding + SSRF guard
  upstream/index.ts  Auth injection (header / query param)
  config/env.ts      PORT, HOST, DB path, timeouts
  db/                SQLite helpers + init script
data/
  providers.json     36 preconfigured providers
  pool-anything.db   SQLite database (git-ignored)
public/logos/        Provider logos
```

## Development

```bash
npm run dev          # watch mode, http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run build        # compile to dist/
npm run start:dist   # run the compiled output
npm run db:init      # initialize the local database
npm test             # run the test suite
```

## Security notes

- Keys are stored in a local SQLite file (`data/pool-anything.db`), which is **git-ignored** — never commit it.
- List endpoints return **masked** keys (`gsk_…ab`); raw keys are only returned by the single-key `GET`.
- The server binds `127.0.0.1` by default; set `HOST` to another interface only behind your own auth layer.
- pool-anything has **no authentication** — run it locally or behind your own auth layer, and don't expose it publicly with real keys inside.

## License

Licensed under the [Apache License 2.0](LICENSE).
