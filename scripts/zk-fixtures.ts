// Generates the proofs the contract's sandbox tests (contract/it/tests/zk_sandbox.rs) replay: one cap_table_commit proof for round 1 and one
// private_claim proof per holder of exit 1, each bound to a fixed recipient account id of the near-workspaces sandbox ("<name>.test.near").
// Needs `make circuits` first. Writes contract/it/fixtures/zk.json (public data only: no receipts, no secrets).
import { writeFileSync } from "node:fs";
import { generateShareholderReceipts, proveCapTableCommit, provePrivateClaim, verifyZkProof, type CapEntry } from "../src/engine/zk";
import { readFileSync } from "node:fs";

const Z = "web/public/zk", commit = { wasm: `${Z}/cap_table_commit.wasm`, zkey: `${Z}/cap_table_commit_final.zkey` }, claim = { wasm: `${Z}/private_claim.wasm`, zkey: `${Z}/private_claim_final.zkey` };
const table: CapEntry[] = [{ holderId: "investor", shareClass: "Common", shares: 600n }, { holderId: "founder", shareClass: "Common", shares: 300n }, { holderId: "angel", shareClass: "Preferred", shares: 100n }];
const ROUND = 1n, EXIT = 1n, POT = 10_000_000_000n; // a $10,000 pot in micro-dollars
const recipients: Record<string, string> = { investor: "burner.test.near", founder: "burner2.test.near", angel: "burner3.test.near" };

const built = await generateShareholderReceipts(table, { classes: ["Common", "Preferred"] });
const c = await proveCapTableCommit(built.witness, { merkleRoot: built.root, totalShares: built.totalShares, roundId: ROUND }, commit);
if (!(await verifyZkProof(JSON.parse(readFileSync(`${Z}/cap_table_commit_verification_key.json`, "utf8")), c.publicSignals, c.proof))) throw new Error("commit proof does not verify");
const claims: Record<string, unknown> = {};
for (const r of built.receipts) {
  const p = await provePrivateClaim(r, { exitId: EXIT, totalShares: built.totalShares, totalPot: POT }, recipients[r.holderId], claim);
  if (!(await verifyZkProof(JSON.parse(readFileSync(`${Z}/private_claim_verification_key.json`, "utf8")), p.publicSignals, p.proof))) throw new Error("claim proof does not verify");
  claims[r.holderId] = { recipient: recipients[r.holderId], nullifier: p.nullifier.toString(), payout: p.payoutAmount.toString(), proof: p.contractProof };
}
writeFileSync("contract/it/fixtures/zk.json", JSON.stringify({ round_id: Number(ROUND), exit_id: Number(EXIT), pot: POT.toString(), merkle_root: built.root.toString(), total_shares: built.totalShares.toString(), commit_proof: c.contractProof, claims }, null, 2));
console.log("wrote contract/it/fixtures/zk.json");
process.exit(0);
