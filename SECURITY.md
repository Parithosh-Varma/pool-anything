# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report them privately via [GitHub Security Advisories](https://github.com/Parithosh-Varma/pool-anything/security/advisories/new) or email the maintainer through the contact info on the GitHub profile. Include:

- A description of the issue and its impact
- Steps to reproduce (or a proof of concept)
- Affected version / commit

You should get an acknowledgement within a few days, and a fix or mitigation before any public disclosure.

## Scope & deployment notes

pool-anything stores provider API keys in a local SQLite file and serves them over HTTP. It is designed to run on your own machine or inside a trusted network. The server binds `127.0.0.1` (loopback) by default. Set `POOL_API_TOKEN` to a long random value to require `Authorization: Bearer <token>` for raw-key reads, all writes, rotation (`/next`), and proxy/consume calls; masked read-only summaries stay public so the dashboard keeps working. If you set `HOST` to another interface, set `POOL_API_TOKEN` or put it behind your own auth layer (reverse proxy, VPN, etc.).

Before deploying it anywhere shared, be aware:

- **Do not expose it publicly with real keys inside.** Put it behind your own auth layer (reverse proxy, VPN, etc.).
- `data/*.db` files contain raw API keys and are git-ignored — never commit or share them.
- List endpoints return masked keys only, but the single-key `GET /api/pools/:id/keys/:keyId` endpoint returns the raw key.
- `ALLOW_PRIVATE_UPSTREAM=1` disables all upstream SSRF protections (https-only, private-host block, redirect refusal). Test/loopback only — never with real keys or a public bind. The server logs a warning at startup when it is set.
- Proxy SSRF note: literal-IP bypasses (decimal/hex/octal IPv4, trailing-dot FQDN, bracketed/`::ffff:`/ULA/link-local/multicast IPv6) are canonicalized and blocked, every upstream hostname is DNS-resolved and rejected if any address is private (single-label names fail closed), and redirects are never followed. DNS re-resolution between check and fetch remains a residual risk; keep the server on loopback.
- Abuse caps: single `tokens` values are capped at 1,000,000 per request, pools at 1000, keys at 100 per pool, upstream bodies at 1 MB. These bound disk/memory growth; they are not rate limiting.

## Supported versions

Only the latest version of `main` is supported with security fixes.
