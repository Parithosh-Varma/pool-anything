import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Package-root-aware path resolution.
 *
 * Problem: several modules used `process.cwd()` to locate bundled assets
 * (`data/providers.json`, `public/logos/*`, `src/logo.png`) and the default
 * SQLite file. That works for `git clone + npm run dev` but breaks the
 * moment the package is installed globally (`npm i -g`), because cwd is
 * wherever the user runs `pool-anything` from — not the install directory.
 *
 * This module resolves everything relative to the installed package root
 * (derived from `import.meta.url`), with a `process.cwd()` fallback so a
 * source checkout keeps working unchanged.
 */

function findPackageRoot(): string {
  // Walk up from this file (src/config/ or dist/config/) until package.json.
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through to cwd
  }
  return process.cwd();
}

export const PACKAGE_ROOT = findPackageRoot();

function firstExisting(...candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

/** Installed `data/` dir (providers.json). Prefers the package, falls back to cwd checkout. */
export function dataDir(): string {
  const fromPkg = path.join(PACKAGE_ROOT, "data");
  if (fs.existsSync(path.join(fromPkg, "providers.json"))) return fromPkg;
  return path.join(process.cwd(), "data");
}

export function providersJsonPath(): string {
  const hit = firstExisting(
    path.join(PACKAGE_ROOT, "data", "providers.json"),
    path.join(PACKAGE_ROOT, "dist", "data", "providers.json"),
    path.join(process.cwd(), "data", "providers.json"),
    path.join(process.cwd(), "dist", "data", "providers.json")
  );
  return hit ?? path.join(PACKAGE_ROOT, "data", "providers.json");
}

/** Installed `public/` dir (provider logos + manifest). */
export function publicDir(): string {
  const candidates = [
    path.join(PACKAGE_ROOT, "public"),
    path.join(PACKAGE_ROOT, "dist", "public"),
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "dist", "public"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return path.join(PACKAGE_ROOT, "public");
}

export function logoPngPath(): string {
  const hit = firstExisting(
    path.join(PACKAGE_ROOT, "dist", "logo.png"),
    path.join(PACKAGE_ROOT, "src", "logo.png"),
    path.join(process.cwd(), "dist", "logo.png"),
    path.join(process.cwd(), "src", "logo.png")
  );
  return hit ?? path.join(PACKAGE_ROOT, "src", "logo.png");
}

export function logoManifestPath(): string {
  const hit = firstExisting(
    path.join(PACKAGE_ROOT, "public", "logos", "manifest.json"),
    path.join(PACKAGE_ROOT, "dist", "public", "logos", "manifest.json"),
    path.join(process.cwd(), "public", "logos", "manifest.json"),
    path.join(process.cwd(), "dist", "public", "logos", "manifest.json")
  );
  return hit ?? path.join(PACKAGE_ROOT, "public", "logos", "manifest.json");
}

function userDataDir(): string {
  return path.join(os.homedir(), ".pool-anything");
}

function isSourceCheckout(): boolean {
  return fs.existsSync(path.join(process.cwd(), "data", "providers.json"));
}

/**
 * Default SQLite location (lowest precedence — LOCAL_DB_PATH / --db wins).
 * - Source checkout (`cwd/data/providers.json` exists): `./data/pool-anything.db` (unchanged).
 * - Global install: `~/.pool-anything/pool-anything.db` so the db is
 *   writable no matter where the user runs the command from, and survives upgrades.
 */
export function defaultDbPath(): string {
  const override = process.env.POOL_DATA_DIR?.trim();
  if (override) return path.join(override, "pool-anything.db");
  if (isSourceCheckout()) return path.join(process.cwd(), "data", "pool-anything.db");
  return path.join(userDataDir(), "pool-anything.db");
}

export function resolveDbPath(): string {
  const explicit = process.env.LOCAL_DB_PATH?.trim();
  if (explicit) return explicit;
  return defaultDbPath();
}
