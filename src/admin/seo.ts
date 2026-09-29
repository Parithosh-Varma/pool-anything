/** Shared SEO constants for the public landing (tools-site) + local app.
 *  Canonical host is the hosted tools UI; local / just reuses the same tags
 *  so exported static HTML is already optimized with no per-env branching. */

export const SITE_URL = "https://pool-anything-tools.pages.dev";
export const SITE_NAME = "pool-anything";
export const SEO_TITLE = "pool-anything — Pool Free-Tier API Keys, Rotate & Track Usage";
export const SEO_DESCRIPTION =
  "Gather free-tier API keys into one pool and rotate them. Round-robin proxy, per-key usage & quota tracking, 36 providers, self-hosted TypeScript + SQLite.";
export const SEO_OG_IMAGE = `${SITE_URL}/logo.png`;

export const HOME_HEAD_EXTRA = `<meta name="description" content="${SEO_DESCRIPTION}" />
<link rel="canonical" href="${SITE_URL}/" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta name="author" content="Parithosh Varma" />
<meta name="theme-color" content="#ffffff" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${SEO_TITLE}" />
<meta property="og:description" content="${SEO_DESCRIPTION}" />
<meta property="og:url" content="${SITE_URL}/" />
<meta property="og:image" content="${SEO_OG_IMAGE}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${SEO_TITLE}" />
<meta name="twitter:description" content="${SEO_DESCRIPTION}" />
<meta name="twitter:image" content="${SEO_OG_IMAGE}" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"pool-anything","applicationCategory":"DeveloperApplication","operatingSystem":"Any","url":"${SITE_URL}/","description":"${SEO_DESCRIPTION}","license":"https://www.apache.org/licenses/LICENSE-2.0","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"author":{"@type":"Person","name":"Parithosh Varma"}}</script>`;

/** Minimal per-page head (description + canonical) for app sub-pages. */
export function subPageHead(path: string, description: string): string {
  const url = `${SITE_URL}${path}`;
  return `<meta name="description" content="${description}" />
<link rel="canonical" href="${url}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${SEO_OG_IMAGE}" />
<meta name="twitter:card" content="summary" />`;
}

export function robotsTxt(): string {
  return `User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
`;
}

const STATIC_ROUTES = ["/", "/pools", "/keys", "/playground", "/analytics", "/history"];

export function sitemapXml(providerIds: string[]): string {
  const urls = new Set<string>(STATIC_ROUTES);
  for (const id of providerIds) {
    if (/^[a-z0-9-]+$/.test(id)) urls.add(`/provider/${id}/`);
  }
  const withSlash = [...urls].map((p) => (p === "/" ? "/" : p.endsWith("/") ? p : `${p}/`));
  const today = new Date().toISOString().slice(0, 10);
  const entries = withSlash
    .map(
      (p) =>
        `  <url><loc>${SITE_URL}${p}</loc><lastmod>${today}</lastmod><changefreq>${p === "/" ? "weekly" : "monthly"}</changefreq><priority>${p === "/" ? "1.0" : p.startsWith("/provider/") ? "0.6" : "0.8"}</priority></url>`
    )
    .join("\n");
  // Note: provider routes are exported as /provider/:id/index.html so the
  // trailing-slash form is canonical on Pages.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
