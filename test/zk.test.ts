import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { initPoseidon, H, FIELD, SLOTS, buildTree, generateShareholderReceipts, recipientHashOf, payoutOf, nullifierOf, proveCapTableCommit, provePrivateClaim, verifyZkProof, type CapEntry } from "../src/engine/zk";

// These tests run the real circuits (web/public/zk, built by `make circuits`): a commit proof takes tens of seconds.
const Z = "web/public/zk", have = existsSync(`${Z}/cap_table_commit_final.zkey`);
const commitFiles = { wasm: `${Z}/cap_table_commit.wasm`, zkey: `${Z}/cap_table_commit_final.zkey` };
const claimFiles = { wasm: `${Z}/private_claim.wasm`, zkey: `${Z}/private_claim_final.zkey` };
const vkey = (n: string) => JSON.parse(readFileSync(`${Z}/${n}_verification_key.json`, "utf8"));
const table: CapEntry[] = [{ holderId: "investor", shareClass: "Common", shares: 600n }, { holderId: "founder", shareClass: "Common", shares: 300n }, { holderId: "angel", shareClass: "Preferred", shares: 100n }];
const classes = ["Common", "Preferred"];
const T = 300_000;

describe.skipIf(!have)("zero-knowledge confidential mode", () => {
  let built: Awaited<ReturnType<typeof generateShareholderReceipts>>;
  beforeAll(async () => { await initPoseidon(); built = await generateShareholderReceipts(table, { classes }); });

  it("the Merkle tree: depth 6, 64 slots, every receipt's path leads to the root, padding is the all-zero leaf", async () => {
    expect(SLOTS).toBe(64); expect(built.receipts.length).toBe(3); expect(built.totalShares).toBe(1000n);
    for (const r of built.receipts) {
      let cur = BigInt(r.leaf);
      r.merklePath.elements.forEach((e, i) => { cur = r.merklePath.indices[i] ? H([BigInt(e), cur]) : H([cur, BigInt(e)]); });
      expect(cur).toBe(built.root);
    }
    expect(buildTree([]).layers[0][0]).toBe(H([0n, 0n, 0n, 0n]));
  });

  it("cap_table_commit: a valid private cap table proves, and the proof verifies only for its public inputs", async () => {
    const { proof, publicSignals } = await proveCapTableCommit(built.witness, { merkleRoot: built.root, totalShares: built.totalShares, roundId: 7n }, commitFiles);
    expect(publicSignals).toEqual([built.root.toString(), "1000", "7"]); // the order the contract passes them in
    expect(await verifyZkProof(vkey("cap_table_commit"), publicSignals, proof)).toBe(true);
    expect(await verifyZkProof(vkey("cap_table_commit"), [built.root.toString(), "1001", "7"], proof)).toBe(false); // tampered total_shares
    expect(await verifyZkProof(vkey("cap_table_commit"), [built.root.toString(), "1000", "8"], proof)).toBe(false); // another round
    expect(await verifyZkProof(vkey("cap_table_commit"), [(built.root + 1n).toString(), "1000", "7"], proof)).toBe(false); // another root
  }, T);

  it("cap_table_commit: the prover refuses a total that does not match, an amount over 64 bits, and a tree that is not the root", async () => {
    await expect(proveCapTableCommit(built.witness, { merkleRoot: built.root, totalShares: 999n, roundId: 7n }, commitFiles)).rejects.toThrow();
    const over = { ...built.witness, share_amounts: [(1n << 64n).toString(), ...built.witness.share_amounts.slice(1)] };
    await expect(proveCapTableCommit(over, { merkleRoot: built.root, totalShares: 1n << 64n, roundId: 7n }, commitFiles)).rejects.toThrow();
    await expect(proveCapTableCommit(built.witness, { merkleRoot: built.root + 1n, totalShares: built.totalShares, roundId: 7n }, commitFiles)).rejects.toThrow();
    // a field-wrapping amount: the amounts add up modulo the field, but each must fit in 64 bits, so it is refused
    const wrap = { ...built.witness, share_amounts: [(FIELD - 5n).toString(), "5", ...built.witness.share_amounts.slice(2)] };
    await expect(proveCapTableCommit(wrap, { merkleRoot: built.root, totalShares: 0n, roundId: 7n }, commitFiles)).rejects.toThrow();
  }, T);

  const exit = { exitId: 3n, totalShares: 1000n, totalPot: 10_000_000_000n };
  it("private_claim: each holder proves their exact pro-rata payout to one recipient; the nullifier is per leaf and per exit", async () => {
    for (const [i, want] of [[0, 6_000_000_000n], [1, 3_000_000_000n], [2, 1_000_000_000n]] as const) {
      const c = await provePrivateClaim(built.receipts[i], exit, "burner.test.near", claimFiles);
      expect(c.payoutAmount).toBe(want);
      expect(c.publicSignals).toEqual([built.root.toString(), c.nullifier.toString(), "3", "1000", "10000000000", want.toString(), c.recipientHash.toString()]);
      expect(await verifyZkProof(vkey("private_claim"), c.publicSignals, c.proof)).toBe(true);
      expect(c.nullifier).toBe(nullifierOf(BigInt(built.receipts[i].holderSecret), 3n));
    }
    const n3 = nullifierOf(BigInt(built.receipts[0].holderSecret), 3n), n4 = nullifierOf(BigInt(built.receipts[0].holderSecret), 4n), other = nullifierOf(BigInt(built.receipts[1].holderSecret), 3n);
    expect(new Set([n3, n4, other]).size).toBe(3);
  }, T);

  it("private_claim: a proof for one recipient does not verify for another, nor with a changed payout, nullifier or exit", async () => {
    const c = await provePrivateClaim(built.receipts[0], exit, "burner.test.near", claimFiles);
    const bad = (idx: number, v: bigint) => c.publicSignals.map((s, i) => (i === idx ? v.toString() : s));
    const vk = vkey("private_claim");
    expect(await verifyZkProof(vk, bad(6, await recipientHashOf("attacker.test.near")), c.proof)).toBe(false); // front-run with another receiver
    expect(await verifyZkProof(vk, bad(5, c.payoutAmount + 1n), c.proof)).toBe(false);
    expect(await verifyZkProof(vk, bad(1, c.nullifier + 1n), c.proof)).toBe(false);
    expect(await verifyZkProof(vk, bad(2, 4n), c.proof)).toBe(false);
    expect(await verifyZkProof(vk, bad(0, built.root + 1n), c.proof)).toBe(false);
    expect(payoutOf(600n, 10_000_000_000n, 1000n)).toBe(6_000_000_000n);
  }, T);

  it("private_claim: the prover refuses a wrong Merkle path, a wrong payout, a forged share amount and a wrong secret", async () => {
    const r = built.receipts[0];
    const wrongPath = { ...r, merklePath: { ...r.merklePath, elements: [(BigInt(r.merklePath.elements[0]) + 1n).toString(), ...r.merklePath.elements.slice(1)] } };
    await expect(provePrivateClaim(wrongPath, exit, "burner.test.near", claimFiles)).rejects.toThrow();
    await expect(provePrivateClaim({ ...r, merklePath: { ...r.merklePath, indices: r.merklePath.indices.map((x) => 1 - x) } }, exit, "burner.test.near", claimFiles)).rejects.toThrow();
    await expect(provePrivateClaim({ ...r, shareAmount: "900" }, exit, "burner.test.near", claimFiles)).rejects.toThrow(); // not the committed amount
    await expect(provePrivateClaim({ ...r, holderSecret: (BigInt(r.holderSecret) + 1n).toString() }, exit, "burner.test.near", claimFiles)).rejects.toThrow();
    await expect(provePrivateClaim(r, { ...exit, totalPot: 10_000_000_001n }, "burner.test.near", claimFiles)).resolves.toBeTruthy(); // a different pot is a different, valid claim
  }, T);
});
