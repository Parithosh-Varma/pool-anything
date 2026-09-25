# ADR 0001 — Pool proxy design

## Rotation
Round-robin over eligible keys (`cursor % n`), ordered by last-observed
latency (unknown first so new keys get tried). Dumb cursor kept because it
is fair and predictable; latency only biases order, never starves.
`POST /consume` rotates by default but accepts `key_id` to attribute usage
without advancing the cursor (so a `GET /next` → `POST /consume {key_id}`
flow bills the key that was shown).

## Failover
Upstream `429` / `5xx` / network errors mark the key cooling down with
exponential backoff (30s, 60s, … capped 600s) and the proxy retries the
next eligible key in the same request. Other 4xx return immediately.
Consecutive-failure count resets on success, which also records latency.

## Quotas
Only quotas we can defend are enforced, each with a window. Countable per-key
limits live in `QUOTA` with a `QUOTA_WINDOW` of `"month"` (calendar month, UTC;
elevenlabs, tavily, brave-search, resend, postmark, upstash) or `"all"`
(lifetime; cartesia, serper, scrapingbee, mailgun). Everything else is
rate/credit/dollar-based upstream, so quota is `null` (unlimited locally) and
usage is still recorded per key. Keys at/over quota within the window are
skipped by rotation; `remaining` is computed against windowed usage.

## Auth styles
`keyHeader` is either a header name (optional `keyPrefix`, e.g. `Bearer `)
or `query:<param>` for token-in-URL providers (mapbox, openweather…).
Raw keys never leave the server except upstream.

## SSRF
`checkTarget` enforces https + non-private literal hosts (canonicalized:
decimal/hex/octal IPv4, bracketed and `::ffff:` IPv6 are all normalized before
matching) unless `ALLOW_PRIVATE_UPSTREAM=1` (tests/loopback only). The proxy
fetches with `redirect: manual` and never follows `Location` off the validated
base URL; 3xx responses are reported without cooling the key. Caller-supplied
`path`/`method`/`headers` are validated before any key is touched, so malformed
input can neither cool the pool nor reach the network. Upstream bodies are
streamed with a 1 MB cap. Residual risk: DNS names are checked as strings, so a
rebinding hostname resolving to a private IP is not caught — see SECURITY.md.
