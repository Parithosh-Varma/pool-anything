import { db, DB_PATH, dbPing } from "./index.js";

const seed = process.argv.includes("--seed");
if (seed) {
  db.prepare("INSERT INTO items (name) VALUES (?)").run("hello-local-d1");
}

const { items } = dbPing();
console.log(`local db ready at ${DB_PATH} (items=${items})`);
