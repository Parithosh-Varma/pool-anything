import path from "node:path";

/** Port for the web UI + API (single server). */
export const PORT = Number(process.env.PORT ?? 3000);

/**
 * Interface to bind. Defaults to loopback: the API serves raw keys with no
 * auth, so it must not listen on all interfaces unless the operator opts in
 * behind their own auth layer (reverse proxy, VPN, firewall).
 */
export const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * SQLite file (D1 stand-in). Evaluated at import — callers construct their
 * DatabaseSync at module load, and tests set LOCAL_DB_PATH before importing.
 */
export const DB_PATH =
  process.env.LOCAL_DB_PATH ?? path.join(process.cwd(), "data", "pool-anything.db");

/** Proxy upstream timeout in ms. Read live so tests/CLI can override per run. */
export function proxyTimeoutMs(): number {
  const n = Number(process.env.PROXY_TIMEOUT_MS ?? 30000);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

/** Test/loopback escape hatch only: allows http + private hosts upstream. Never in prod. */
export function allowPrivateUpstream(): boolean {
  return process.env.ALLOW_PRIVATE_UPSTREAM === "1";
}

/** Warn once at startup when running in an insecure configuration. */
export function startupWarnings(): string[] {
  const warnings: string[] = [];
  if (allowPrivateUpstream()) {
    warnings.push("ALLOW_PRIVATE_UPSTREAM=1 is set: SSRF protections are OFF. Test/loopback only — never with real keys or a public bind.");
  }
  if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
    warnings.push(`HOST=${HOST} binds a non-loopback interface with no built-in auth. Put it behind your own auth layer.`);
  }
  return warnings;
}
