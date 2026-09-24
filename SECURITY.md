# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report them privately via [GitHub Security Advisories](https://github.com/Parithosh-Varma/pool-anything/security/advisories/new) or email the maintainer through the contact info on the GitHub profile. Include:

- A description of the issue and its impact
- Steps to reproduce (or a proof of concept)
- Affected version / commit

You should get an acknowledgement within a few days, and a fix or mitigation before any public disclosure.

## Scope & deployment notes

pool-anything stores provider API keys in a local SQLite file and serves them over HTTP with **no built-in authentication**. It is designed to run on your own machine or inside a trusted network.

Before deploying it anywhere shared, be aware:

- **Do not expose it publicly with real keys inside.** Put it behind your own auth layer (reverse proxy, VPN, etc.).
- `data/*.db` files contain raw API keys and are git-ignored — never commit or share them.
- List endpoints return masked keys only, but the single-key `GET /api/pools/:id/keys/:keyId` endpoint returns the raw key.
- The sandbox server binds to `127.0.0.1` only; the main server binds to all interfaces (`PORT`).

## Supported versions

Only the latest version of `main` is supported with security fixes.
