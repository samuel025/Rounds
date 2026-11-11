// Fails if any number the README (and the docs/ pages it links) tags as <!--n:path-->value<!--/n--> differs from results/summary.json,
// or if the README states an untagged count of tests, scenarios, events, transactions, checks or payouts.
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
const FILES = ["README.md", ...["CONFIDENTIAL", "EVIDENCE", "TESTNET-RUN", "TOKENS", "BOARD-REVIEW", "APP-GUIDE", "LIMITS"].map((n) => `docs/${n}.md`)].filter(existsSync);
const readme = FILES.map((f) => readFileSync(f, "utf8")).join("\n"), summary = JSON.parse(readFileSync("results/summary.json", "utf8"));
const get = (p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), summary);
let bad = 0, n = 0;
for (const m of readme.matchAll(/<!--n:([\w.]+)-->([^<]*)<!--\/n-->/g)) {
  n++; const want = get(m[1]);
  if (want === undefined || want === null || String(want) !== m[2].trim().replace(/,/g, "")) { bad++; console.log(`FAIL ${m[1]}: README says ${m[2]}, summary.json says ${want}`); }
  else console.log(`PASS ${m[1]} = ${m[2]}`);
}
const stripped = readme.replace(/<!--n:[\w.]+-->[^<]*<!--\/n-->/g, "");
for (const m of stripped.matchAll(/\b\d[\d,]*\s+(tests?|scenarios?|events?|transactions?|checks?|payouts?)\b/gi)) { bad++; console.log(`FAIL untagged number in README: "${m[0]}" (wrap it in <!--n:key-->…<!--/n-->)`); }
console.log(`${bad ? "FAIL" : "PASS"} summary: ${n} tagged numbers checked, ${bad} failed`);
process.exit(bad ? 1 : 0);
