// Canonicalizes the shared fixtures with the TypeScript engine for the Python conformance check.
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, planHash } from "../src/engine/index";

(async () => {
  const [inFile, outFile] = process.argv.slice(2);
  const cases = JSON.parse(readFileSync(inFile, "utf8")).cases as { name: string; value: unknown }[];
  const out = [];
  for (const c of cases) {
    const canonical = canonicalJson(c.value);
    out.push({ name: c.name, canonical, hash: await planHash(canonical) });
  }
  writeFileSync(outFile, JSON.stringify(out, null, 1));
})();
