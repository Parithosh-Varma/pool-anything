import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH =
  process.env.LOCAL_DB_PATH ?? path.join(process.cwd(), "data", "pool-anything.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function dbPing(): { path: string; items: number } {
  const row = db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
  return { path: DB_PATH, items: row.n };
}
