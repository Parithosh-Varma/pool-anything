import fs from "node:fs";
import { logoManifestPath } from "../config/paths.js";

/** Cache-buster for /logos/* URLs: derived from the logo manifest mtime so any
 *  logo update changes the query string and browsers drop stale cached bytes. */
export function logoVersion(): string {
  try {
    return Math.floor(fs.statSync(logoManifestPath()).mtimeMs).toString(36);
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
  history: svgIcon('<path d="M3.5 12a8.5 8.5 0 1 1 2.4 6"/><path d="M3.5 12H7"/><path d="M3.5 12V8.5"/><path d="M12 7.5V12l3 2"/>'),
  docs: svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  /** Attach-row media icons: same 24px stroke family as sidebar (currentColor, 1.8, round).
   *  Sized down to 14px via `.filebtn svg` in playground CSS. */
  image: svgIcon('<rect x="3" y="4.5" width="18" height="15.5" rx="2.5"/><circle cx="9" cy="10.5" r="1.8"/><path d="m4.5 18.5 5-5 3.5 3.5 2.5-2.5 4 4"/>'),
  audio: svgIcon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/><path d="M9.5 21h5"/>'),
  video: svgIcon('<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="m15.5 10.8 6-3.6v9.6l-6-3.6"/>'),
  rec: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3" fill="#B3261E" stroke="#B3261E"/></svg>`,
  stop: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1.2" fill="#B3261E" stroke="#B3261E"/></svg>`,
  /** Small external-link marker (12px via `.mi .ext svg`) for sidebar items that leave the app. */
  external: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`,
};
