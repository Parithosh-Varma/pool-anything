# ADR 0001 — Pool proxy design

## Rotation
Round-robin over eligible keys (`cursor % n`), ordered by last-observed
latency (unknown first so new keys get tried). Dumb cursor kept because it
is fair and predictable; latency only biases order, never starves.

## Failover
Upstream `429` / `5xx` / network errors mark the key cooling down with
exponential backoff (30s, 60s, … capped 600s) and the proxy retries the
next eligible key in the same request. Other 4xx return immediately.
Consecutive-failure count resets on success, which also records latency.

## Quotas
Only token quotas we can defend are enforced. Today: cartesia 20,000
tokens per key. Everything else is rate/credit-based upstream, so quota
is `null` (unlimited locally) and usage is still recorded per key.
Keys at/over quota are skipped by rotation.

## Auth styles
`keyHeader` is either a header name (optional `keyPrefix`, e.g. `Bearer `)
or `query:<param>` for token-in-URL providers (mapbox, openweather…).
Raw keys never leave the server except upstream.

## SSRF
`checkTarget` enforces https + public hosts unless
`ALLOW_PRIVATE_UPSTREAM=1` (tests/loopback only).
