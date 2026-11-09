// Writes results/summary.json from real outputs. `make check-readme` compares the README's tagged numbers with it.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const rd = (f) => JSON.parse(readFileSync(`results/${f}`, "utf8"));
execSync("npx vitest run --reporter=json --outputFile=results/vitest.json", { stdio: "ignore" });
const v = rd("vitest.json");
const titles = v.testResults.flatMap((f) => f.assertionResults.map((a) => ({ t: a.title, full: a.fullName, ok: a.status === "passed" })));
const sandbox = execSync("cargo test -- --list 2>/dev/null", { cwd: "contract/it", encoding: "utf8" }).split("\n").filter((l) => /: test$/.test(l)).length;
const conf = rd("conformance-summary.json");
const txs = rd("demo-txs.json"), ev = rd("demo-events.json");
const tail = (f) => { if (!existsSync(`results/${f}`)) return null; const m = readFileSync(`results/${f}`, "utf8").trim().split("\n").pop().match(/summary: (\d+) checks?, (\d+) failed/); return m ? { checks: +m[1], failed: +m[2] } : null; };
const ver = tail("verify-onchain.txt"), rep = tail("replay.txt");
const summary = {
  tests: { engine: v.numTotalTests, engine_failed: v.numFailedTests, engine_files: v.numTotalTestSuites ? v.testResults.length : 0, properties: titles.filter((x) => /^P\d /.test(x.t)).length, golden_vector_tests: titles.filter((x) => /GV-\d/.test(x.full)).length, sandbox },
  conformance: { scenarios: conf.scenarios, rejected_inputs: conf.rejected_inputs, mismatches: conf.mismatches },
  canonical: { cases: conf.canonical_cases, mismatches: conf.canonical_mismatches },
  demo: { transactions: txs.length, events: ev.length, rounds_closed: ev.filter((e) => e.name === "round_closed").length, payouts: ev.filter((e) => e.name === "payout_sent").length },
  verify_onchain: ver, replay: rep,
};
writeFileSync("results/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
