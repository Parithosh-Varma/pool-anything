import { sdb } from "../pool/index.js";
import { DB_PATH, dbPing } from "./index.js";

const seed = process.argv.includes("--seed");
if (seed) {
  sdb.prepare("INSERT INTO items (name) VALUES (?)").run("hello-local-d1");
}

dbPing();
console.log(`local db ready at ${DB_PATH}`);
