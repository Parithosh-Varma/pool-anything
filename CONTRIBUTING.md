# Contributing to pool-anything

Thanks for helping improve pool-anything! Contributions of all sizes are welcome — new providers, docs, bug fixes, and tests.

## Getting started

```bash
git clone https://github.com/Parithosh-Varma/pool-anything.git
cd pool-anything
npm install
npm run dev        # http://localhost:3000
```

Requires Node.js >= 22.5 (for the built-in `node:sqlite` module).

## Making changes

1. Fork and create a branch from `main`.
2. Make your change. Keep the project's conventions:
   - **Zero runtime dependencies.** The point of this project is that it runs on Node built-ins + TypeScript only. Please don't add npm dependencies.
   - TypeScript strict mode is on; `npm run typecheck` must pass.
   - Provider definitions live in `data/providers.json` — see below.
3. Test your change:
   - `npm run typecheck`
   - `npm run build`
   - Manually verify in the UI (`npm run dev`) — exercise the flow you touched.
4. Open a pull request using the template.

## Adding a provider

Add an entry to `data/providers.json`:

```json
{
  "id": "acme",
  "name": "Acme AI",
  "baseUrl": "https://api.acme.ai/v1",
  "keyHeader": "Authorization",
  "keyPrefix": "Bearer ",
  "extraHeaders": {},
  "quota": "100 req/day free",
  "docsUrl": "https://docs.acme.ai",
  "keyFields": ["api_key"],
  "hint": "console.acme.ai/keys, acm_…",
  "logo": "public/logos/acme.svg"
}
```

Notes:

- `keyHeader` may be a header name (`Authorization`), a query parameter (`query:access_token`), or a custom header (`X-API-Key`).
- `keyPrefix` handles auth schemes (`Bearer `, `Token `, `Basic `).
- Drop a logo into `public/logos/<id>.svg` (or `.png`) and register it in `public/logos/manifest.json`.
- Set `"poolable": false` for providers whose data plane can't be pooled via HTTP headers (e.g. control-plane-only APIs).

## Reporting bugs

Use the [bug report template](https://github.com/Parithosh-Varma/pool-anything/issues/new?template=bug_report.md). Please redact API keys from any logs or responses you paste.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
