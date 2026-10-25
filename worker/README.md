# pool-anything on Cloudflare Workers

The same `/api/*` contract as the Node server, running entirely on Cloudflare:
one Worker and one SQLite-backed Durable Object. No D1 database to create, no
server to keep awake. The existing hosted UI can point at it with `?api=`.

- **Worker:** `https://pool-anything.parithosh.workers.dev`
- **UI:** <https://pool-anything-tools.pages.dev/?api=https%3A%2F%2Fpool-anything.parithosh.workers.dev>
- **Storage:** a single Durable Object named `PoolDB` (`idFromName("pool-anything")`)

## Why one Durable Object?

Rotation needs coherent state. The Node server gets that from SQLite plus a
single process; the Worker gets it from one SQLite-backed Durable Object. Every
request shares the same database, and the object's synchronous SQL execution
keeps cursor advances, `picks`/`last_used_at`, cooldowns, and failover in one
order — without a separate D1 database (and without hitting the free plan's D1
database limit).

Durable Objects with SQLite storage are available on the Workers Free plan
(100k requests/day, 100k SQLite writes/day). This build targets personal and
small-team use, not multi-region hot-hot throughput: every stateful request
goes through the one object.

The data layer (`worker/src/db.ts`) is written against D1's async API and runs
unchanged inside the object through a small synchronous adapter
(`worker/src/durable.ts`). That keeps the Worker, Node, and tests on one SQL
schema and one rotation implementation.

## Local development

```bash
npm install
npm run dev:worker            # http://localhost:8787
npm run dev:worker -- --port 8791
```

The local Durable Object store lives under `.wrangler/` (git-ignored). To require
a token locally, create `.dev.vars`:

```dotenv
POOL_API_TOKEN=dev-token
```

Then use `Authorization: Bearer dev-token`. Stop with `Ctrl-C`; the local
database persists across restarts.

## Deploy

```bash
npx wrangler login            # once
npx wrangler deploy           # creates the Worker + first DO migration
npx wrangler secret put POOL_API_TOKEN
```

Set `POOL_API_TOKEN`. Without it, anyone who finds the `workers.dev` URL can
create pools, read raw keys (with a key id), and spend your provider quota. The
secret is stored by Cloudflare and is not part of the repository or
`wrangler.jsonc`.

To rotate the token later, run `wrangler secret put POOL_API_TOKEN` again.

## Use it from the hosted UI

1. Open <https://pool-anything-tools.pages.dev/?api=https%3A%2F%2Fpool-anything.parithosh.workers.dev>.
2. Open the **Backend** pill (bottom-left).
3. Paste the API base `https://pool-anything.parithosh.workers.dev` and the
   bearer token, then **Save**.
4. Add keys and pools as usual. The shim sends the token on `/api/*` calls and
   handles CORS preflights.

`?token=...` also works for throwaway tokens but puts the token in browser
history and referer headers. Prefer the Backend pill.

`GET /ui` redirects to the hosted UI with the Worker's origin already filled in:

```
https://pool-anything.parithosh.workers.dev/ui
```

## API

Identical paths to the Node server. The production alias `POST /proxy/:id` is
also available.

```bash
BASE=https://pool-anything.parithosh.workers.dev
TOKEN=...   # POOL_API_TOKEN

# Create a custom pool
curl -s "$BASE/api/pools" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"provider":"custom","name":"my-pool","base_url":"https://api.example.com","strategy":"round-robin"}'

# Add a key
curl -s "$BASE/api/pools/1/keys" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"label":"key-1","api_key":"sk-..."}'

# Rotate (returns the masked key)
curl -s "$BASE/api/pools/1/next" -H "authorization: Bearer $TOKEN"

# Proxy a request through the pool
curl -s "$BASE/api/pools/1/proxy" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"/v1/models","method":"GET"}'
```

For sticky/session routing, pass `?sticky=<session>` on `/next` or
`x-pool-sticky: <session>` on `/proxy` / `/api/pools/:id/proxy`.

## Configuration

Set these as Worker variables (`wrangler.jsonc` → `vars`) or secrets
(`wrangler secret put`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `POOL_API_TOKEN` | _(unset)_ | Bearer gate for raw keys, call history, writes, rotation, and proxy |
| `ALLOWED_ORIGINS` | Pages hosts | Comma-separated CORS allowlist; `localhost`/`127.0.0.1` are always allowed for dev |
| `UI_URL` | `https://pool-anything-tools.pages.dev/` | Target of `GET /ui` (gets `?api=<worker-origin>` appended) |
| `PROXY_TIMEOUT_MS` | `30000` (max `60000`) | Per-attempt upstream timeout |
| `POOL_ROTATION_STRATEGY` | `round-robin` | Default strategy for pools with no strategy of their own |
| `POOL_ROTATION_OPTIONS` | _(unset)_ | JSON options, e.g. `{"time-based":{"everyN":50}}` |
| `POOL_DEBUG` | _(unset)_ | `1` logs proxy attempt summaries (never bodies or keys) |
| `ALLOW_PRIVATE_UPSTREAM` | _(unset)_ | `1` allows private/HTTP upstreams. Local testing only |

`POOL_API_TOKEN` is set as a secret, not a plain `vars` entry.

## Limits vs. the Node server

| Item | Node | Worker |
| --- | --- | --- |
| Proxy request JSON | streamed | 6 MB buffered |
| Upstream response | streamed | 6 MB buffered |
| Returned relay body | unbounded | 8M chars |
| Calls text / media preview | 16k / 600k | 16k / 600k |
| In-flight state | process-local | Durable Object–local |
| Storage | `node:sqlite` file | DO SQLite (auto-created) |

Workers cannot resolve DNS before `fetch`, so the SSRF check is a literal-IP /
hostname check plus Cloudflare's platform egress controls. This is weaker than
the Node server's resolve-then-check DNS guard. Do not set
`ALLOW_PRIVATE_UPSTREAM=1` on the public deployment.

## Schema

The Durable Object creates the schema on first use. It is the same logical
schema as the Node server (`pools`, `pool_keys`, `usage`, `calls`) with the
strategy and selection columns folded in. There is no separate migration step;
`wrangler.jsonc` contains only the DO class migration (`new_sqlite_classes`).

## Troubleshooting

- **401 on writes / `/next` / `/calls`:** send `authorization: Bearer <POOL_API_TOKEN>`.
- **CORS preflight fails:** add the UI origin to `ALLOWED_ORIGINS` and redeploy.
- **`/next` says "all keys cooling down or quota-exhausted":** the last upstream
  failures cooled every key; wait for the cooldown or check provider status.
- **`/proxy` says "upstream redirected":** redirects are deliberately not
  followed; point the request at the final URL.
- **Local changes to `wrangler.jsonc` not picked up:** restart `npm run dev:worker`.
