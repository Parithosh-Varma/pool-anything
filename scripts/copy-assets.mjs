// Copies runtime assets next to the compiled output so a global install
// (`npm i -g`) can serve logos + providers without the source tree.
// Run as part of `npm run build`. ESM + node built-ins only.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const copies = [
  ["data/providers.json", "dist/data/providers.json"],
  ["src/logo.png", "dist/logo.png"],
];

let logoCount = 0;
if (fs.existsSync(path.join(root, "public", "logos"))) {
  for (const f of fs.readdirSync(path.join(root, "public", "logos"))) {
    copies.push([`public/logos/${f}`, `dist/public/logos/${f}`]);
    logoCount++;
  }
}

for (const [src, dest] of copies) {
  const from = path.join(root, src);
  const to = path.join(root, dest);
  if (!fs.existsSync(from)) {
    console.warn(`[copy-assets] missing ${src}, skipping`);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

console.log(`[copy-assets] copied ${copies.length} files (${logoCount} logos)`);
