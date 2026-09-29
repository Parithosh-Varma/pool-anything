# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Changes land here. Move them under a version heading at release time. -->

## [0.1.1] — 2026-09-29

- Ink-powered assistant shell: colors, bordered panels, live `watch` view, and command history, with a plain-text fallback when Ink can't initialize.
- `/history` page: every upstream attempt stored and shown with status, tokens, response body, and generated media; Deepgram Flux fix.
- Self-update and uninstall: `GET /api/version`, `POST /api/update`, an Update pill in the web UI header, and `update` / `uninstall` assistant commands.
- SEO: landing meta/OG/JSON-LD plus `/robots.txt` and `/sitemap.xml` served by the app (static routes + one entry per provider).
- Pools page shows each pool's `#id` on its card.

## [0.1.0] — 2026-09-28

First npm release.

- Pools of free-tier keys with round-robin rotation, cooldown/failover on `429`/`5xx`, and per-key usage + quota tracking in SQLite (`node:sqlite`).
- Drop-in HTTP proxy (`POST /api/pools/:id/proxy`) that injects the right key, header, and auth scheme, with SSRF guards on the upstream side.
- Web UI with provider search/setup, pools, key manager, playground, and analytics — 36 providers preconfigured in `data/providers.json`.
- Global `pool-anything` CLI: assistant shell with natural-language commands, one-shot `-e` mode, and `serve` for the web UI + API.
- Zero-runtime-dependency server core (Node built-ins only) behind strict TypeScript.
