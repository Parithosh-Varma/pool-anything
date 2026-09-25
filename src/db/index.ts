import { sdb } from "../pool/index.js";

export { DB_PATH } from "../pool/index.js";

// Secondary demo table (exercises the D1 path behind /api/db/ping).
// Uses the shared pool connection: one file, one handle.
sdb.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function dbPing(): { ok: boolean } {
  sdb.prepare("SELECT COUNT(*) AS n FROM items").get();
  return { ok: true };
}
