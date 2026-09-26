import fs from "node:fs";
import path from "node:path";

/** Cache-buster for /logos/* URLs: derived from the logo manifest mtime so any
 *  logo update changes the query string and browsers drop stale cached bytes. */
export function logoVersion(): string {
  try {
    return Math.floor(fs.statSync(path.join(process.cwd(), "public", "logos", "manifest.json")).mtimeMs).toString(36);
  } catch {
    return "1";
  }
}
export const LOGO_V = logoVersion();

/** Canonical docs live on Cloudflare Pages; the local tool links out to them. */
export const DOCS_URL = "https://pool-anything.pages.dev/docs";

/** Sidebar icons: custom inline stroke SVGs (currentColor, 18px via `.mi .ic svg`). */
export const svgIcon = (paths: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  home: svgIcon('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>'),
  pools: svgIcon('<path d="m12 3 9 4.9-9 4.9-9-4.9L12 3Z"/><path d="m3 12.9 9 4.9 9-4.9"/><path d="m3 17.4 9 4.9 9-4.9"/>'),
  keys: svgIcon('<circle cx="8" cy="16" r="4.5"/><path d="m11.2 12.8 8.3-8.3"/><path d="M17 5.5l2.5 2.5M14.5 8l2.5 2.5"/>'),
  analytics: svgIcon('<path d="M3 21h18"/><path d="M6 21v-7M11 21V5M16 21v-11M21 21v-4"/>'),
  playground: svgIcon('<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5v-7Z"/>'),
  docs: svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
};
