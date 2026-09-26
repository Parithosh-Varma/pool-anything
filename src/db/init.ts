import { sdb } from "../pool/index.js";
import { DB_PATH, dbPing } from "./index.js";

const seed = process.argv.includes("--seed");
if (seed) {
  const existing = sdb.prepare("SELECT COUNT(*) AS n FROM items WHERE name = ?").get("hello-local-d1") as { n: number };
  if (existing.n === 0) {
    sdb.prepare("INSERT INTO items (name) VALUES (?)").run("hello-local-d1");
  }
}

dbPing();
console.log(`local db ready at ${DB_PATH}`);
