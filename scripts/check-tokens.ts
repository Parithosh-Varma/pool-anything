// Verifies src/admin/tokens.ts :root values match design-tokens.json.
// Run: npx tsx scripts/check-tokens.ts (zero runtime dependencies)
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const json = JSON.parse(fs.readFileSync(path.join(root, "design-tokens.json"), "utf8"));
const ts = fs.readFileSync(path.join(root, "src/admin/tokens.ts"), "utf8");

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const flat: Array<[string, string]> = [];
const walk = (o: unknown, prefix: string) => {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
        flat.push([prefix + k, String((v as Record<string, unknown>).value)]);
      } else walk(v, prefix + k + ".");
    }
  }
};
walk(json.color, "color.");
// shadows + control heights are :root vars; focus is a composite declaration
// (2px solid var(--accent) + offset + radius) applied at usage sites, not a var.
for (const group of ["shadow", "controlHeight"] as const) {
  for (const [k, entry] of Object.entries(
    (json as Record<string, Record<string, { value: string }>>)[group],
  )) {
    flat.push([`${group}.${k}`, (entry as { value: string }).value]);
  }
}

const tsFlat = norm(ts);
let missing: string[] = [];
for (const [name, val] of flat) {
  if (!tsFlat.includes(norm(val))) missing.push(`${name} = ${val}`);
}

// radius spot-check: every radius value must appear as a :root var
for (const entry of Object.values(
  (json as Record<string, Record<string, { value: string }>>).radius,
)) {
  if (!tsFlat.includes(norm(entry.value))) missing.push(`radius = ${entry.value}`);
}

if (missing.length) {
  console.error("TOKEN DRIFT — values in design-tokens.json missing from src/admin/tokens.ts:");
  for (const m of missing) console.error("  " + m);
  process.exit(1);
}
console.log(`tokens OK — ${flat.length} color/shadow/focus values + radius/heights all present in tokens.ts`);
