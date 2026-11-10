// make replay: NO NETWORK. Rebuilds the demo from committed files only (events, plans, tx list) and cross-checks the engine.
import { readFileSync } from "node:fs";
import { demoPlans, type Accounts } from "./plans";

const rd = (f: string) => JSON.parse(readFileSync(`results/${f}`, "utf8"));
const addr = rd("demo-addresses.json"), txs: { step: string; tx: string; what: string }[] = rd("demo-txs.json"), events: { name: string; tx: string; data: any; plan?: string }[] = rd("demo-events.json"), plans = rd("demo-plans.json");
const EX = "https://testnet.nearblocks.io/txns/";
const short = (a: string) => a.replace(`-${addr.suffix}.testnet`, "").replace(/^rounds-/, "");
const usd = (m: bigint) => "$" + (Number((m + 5_000n) / 10_000n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let total = 0, failed = 0;
const check = (ok: boolean, msg: string) => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

console.log(`Rounds demo replay (offline). Network ${addr.network}; contract ${addr.rounds}; board ${addr.dao}\n`);
console.log("STEPS (each links to its testnet transaction)");
const names: Record<string, string> = { "1": "Setup", "2": "Founders", "3": "SAFEs", "4": "Series A proposed", "5": "Series A funded and closed", "6": "Attacks", "7": "Grant", "8": "Exit", "9": "Exercise" };
for (const t of txs) console.log(`  ${t.step.padEnd(2)} ${names[t.step] ?? ""}`.padEnd(32) + `${t.what.slice(0, 66).padEnd(68)} ${EX}${t.tx}`.replace(/\s+$/, ""));

// rebuild holdings from events + the plans carried in round_proposed events (closed rounds only, in order)
const planOf: Record<string, any> = {};
for (const e of events) if (e.name === "round_proposed" && e.plan) planOf[e.data.round_id] = JSON.parse(e.plan);
const holdings: Record<string, bigint> = {}; const closed: number[] = [];
for (const e of events) if (e.name === "round_closed") { closed.push(e.data.round_id); for (const i of planOf[e.data.round_id].issuances ?? []) holdings[`${i.holder}|${i.class}`] = (holdings[`${i.holder}|${i.class}`] ?? 0n) + BigInt(i.shares); }
const fd = Object.values(holdings).reduce((a, b) => a + b, 0n);
console.log("\nCAP TABLE rebuilt from committed events");
for (const [k, v] of Object.entries(holdings).sort()) { const [h, c] = k.split("|"); console.log(`  ${short(h).padEnd(14)} ${c.padEnd(26)} ${v.toString().padStart(10)}  ${(Number((v * 10000n) / fd) / 100).toFixed(2).padStart(6)}%`); }
console.log(`  ${"total".padEnd(41)} ${fd.toString().padStart(10)}`);

const payouts = events.filter((e) => e.name === "payout_sent" && String(e.data.exit_id) === "1");
const shared = events.filter((e) => e.name === "payout_sent" && String(e.data.exit_id) === "2");
console.log("\nEXIT PAYOUTS from committed events");
for (const p of payouts) console.log(`  ${short(p.data.holder).padEnd(14)} ${usd(BigInt(p.data.amount)).padStart(16)}`);

console.log("\nSHARED PAYOUT (exit 2: the DAO treasury shares $100,000 pro rata) from committed events");
for (const p of shared) console.log(`  ${short(p.data.holder).padEnd(14)} ${usd(BigInt(p.data.amount)).padStart(16)}`);

console.log("\nCHECKS against the engine (recomputed offline)");
const A = addr.accounts as Accounts; const eng = demoPlans(A);
check(closed.length === 4 && JSON.stringify(closed) === "[1,2,3,4]", "four rounds closed in order (founders, two SAFEs, Series A)");
check(Object.keys(eng.holdings).length === Object.keys(holdings).length && Object.entries(eng.holdings).every(([k, v]) => holdings[k] === v), "replayed holdings equal the engine's holdings for every (holder, class)");
check(eng.result.priceMicro === 2_000_000n && fd === 15_000_000n, "GV-1: price $2.0000 and 15,000,000 fully diluted shares");
check(eng.rounds.every((p, i) => planOf[i + 1] && JSON.stringify(planOf[i + 1]) === JSON.stringify(JSON.parse(p))), "every committed plan equals the plan the engine recomputes");
check(plans.exit.plan === eng.exit, "the committed exit plan equals the engine's waterfall plan");
check(payouts.length === 5 && payouts.every((p) => eng.waterfall.payoutsMicro[Object.entries(eng.who).find(([, a]) => a === p.data.holder)![0]].toString() === p.data.amount), "GV-2 at $20M: all 5 payouts equal the engine's waterfall to the micro-dollar");
check(payouts.reduce((s, p) => s + BigInt(p.data.amount), 0n) + eng.waterfall.remainderMicro === 20_000_000_000_000n, "payouts plus the reported rounding remainder equal the $20,000,000 proceeds");
const dist = eng.distribution;
check(shared.length === dist.payouts.length && dist.payouts.every(([h, a]) => shared.some((p) => p.data.holder === h && p.data.amount === a.toString())), `R10: the ${dist.payouts.length} shared payouts equal the engine's pro-rata split of $100,000 over ${dist.eligibleShares} eligible shares, to the micro-dollar`);
check(shared.reduce((s, p) => s + BigInt(p.data.amount), 0n) + dist.remainderMicro === 100_000_000_000n && plans.distribution?.plan === eng.distributionPlan, "shared payouts plus the reported remainder equal the $100,000 pot, and the committed plan equals the engine's plan");
check(events.filter((e) => e.name === "round_approved").length === 4 && events.filter((e) => e.name === "exit_approved").length === 2, "every round and both payouts (the exit and the shared payout) were approved by the board before execution");
check(events.some((e) => e.name === "grant_exercised" && e.data.shares === "1000") && events.some((e) => e.name === "strikes_swept" && e.data.amount === "2000000000"), "options were exercised (1,000 shares, $2,000 strike) and the strike was swept to the treasury");
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
