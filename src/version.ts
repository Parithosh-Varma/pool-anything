import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PACKAGE_ROOT } from "./config/paths.js";

export const PACKAGE_NAME = "pool-anything";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const LATEST_TTL_MS = 5 * 60 * 1000;

export function readCurrentVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function npmCmd(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** Numeric semver compare: >0 when a is newer, 0 when equal, <0 when older. */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]!
      .split(".")
      .map((p) => {
        const n = Number(p);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function fetchLatestVersion(timeoutMs = 6000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(REGISTRY_URL, { signal: ctrl.signal });
      if (!r.ok) return null;
      const j = (await r.json()) as { version?: unknown };
      return typeof j.version === "string" ? j.version : null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

let cachedLatest: { version: string | null; at: number } | null = null;

export type VersionInfo = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
};

export async function getVersionInfo(): Promise<VersionInfo> {
  const current = readCurrentVersion();
  const now = Date.now();
  if (cachedLatest && now - cachedLatest.at < LATEST_TTL_MS) {
    const latest = cachedLatest.version;
    return {
      current,
      latest,
      updateAvailable: latest !== null && compareVersions(latest, current) > 0,
    };
  }
  const latest = await fetchLatestVersion();
  cachedLatest = { version: latest, at: now };
  return {
    current,
    latest,
    updateAvailable: latest !== null && compareVersions(latest, current) > 0,
  };
}

function runNpm(args: string[]): { ok: boolean; output: string } {
  try {
    const r = spawnSync(npmCmd(), args, { encoding: "utf8", timeout: 120_000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    const err = (r as unknown as { error?: Error }).error;
    if (err) return { ok: false, output: `npm ${args.join(" ")} failed: ${err.message}` };
    return {
      ok: r.status === 0,
      output: out.slice(-2000) || (r.status === 0 ? "ok" : `npm exited with code ${r.status}`),
    };
  } catch (e) {
    return { ok: false, output: `npm ${args.join(" ")} failed: ${(e as Error).message}` };
  }
}

export type UpdateResult = {
  ok: boolean;
  previous: string;
  current: string;
  latest: string | null;
  updated: boolean;
  text: string;
  output?: string;
};

export async function performUpdate(): Promise<UpdateResult> {
  const previous = readCurrentVersion();
  const latest = await fetchLatestVersion();
  if (latest !== null && compareVersions(latest, previous) <= 0) {
    return {
      ok: true,
      previous,
      current: previous,
      latest,
      updated: false,
      text: `Already on latest v${previous}.`,
    };
  }
  const r = runNpm(["install", "-g", `${PACKAGE_NAME}@latest`]);
  if (!r.ok) {
    return {
      ok: false,
      previous,
      current: previous,
      latest,
      updated: false,
      text: `Update failed: ${r.output}`,
      output: r.output,
    };
  }
  // Bust the cached latest — the registry state is now what we run (or will
  // run after restart).
  cachedLatest = { version: latest, at: Date.now() };
  const current = readCurrentVersion();
  const target = latest ?? (current !== previous ? current : null);
  if (target !== null && current === target && current !== previous) {
    return {
      ok: true,
      previous,
      current,
      latest,
      updated: true,
      text: `Updated v${previous} → v${current}. Restart the shell/server to use it.`,
      output: r.output,
    };
  }
  // Source checkout (npm -g updates the global copy, not this tree) or a
  // registry check that failed: the install succeeded, report what we know.
  const suffix = target !== null ? ` (latest v${target}). Restart to use it.` : `. Restart to use it.`;
  return {
    ok: true,
    previous,
    current,
    latest,
    updated: true,
    text: `Update installed${latest !== null ? ` v${previous} → v${latest}` : ""}${suffix} ${r.output}`.trim(),
    output: r.output,
  };
}

export type UninstallResult = { ok: boolean; text: string; output?: string };

export function performUninstall(): UninstallResult {
  const r = runNpm(["uninstall", "-g", PACKAGE_NAME]);
  if (!r.ok) {
    return { ok: false, text: `Uninstall failed: ${r.output}`, output: r.output };
  }
  return {
    ok: true,
    text: `Uninstalled ${PACKAGE_NAME}. Your pools/keys in SQLite are untouched (remove ~/.pool-anything to wipe data).`,
    output: r.output,
  };
}
