// Confidential mode (optional): a Poseidon Merkle commitment to a private cap table, private-claim receipts, and Groth16 provers
// for the two circuits in circuits/ (cap_table_commit, private_claim). See RULES.md R12 and the README's Zero-Knowledge section.
// Not re-exported from index.ts: circomlibjs and snarkjs are loaded lazily so the public-mode app does not pay for them.

export const DEPTH = 6;
export const SLOTS = 1 << DEPTH; // 64 cap-table slots
/** The BN254 scalar field: every circuit value and public input is below this. */
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let poseidonImpl: any = null;
export async function initPoseidon() {
  if (!poseidonImpl) { const { buildPoseidon } = await import("circomlibjs"); poseidonImpl = await buildPoseidon(); }
  return poseidonImpl;
}
/** Poseidon (circomlib parameters). Call initPoseidon() first. */
export function H(inputs: bigint[]): bigint {
  if (!poseidonImpl) throw new Error("call initPoseidon() first");
  return poseidonImpl.F.toObject(poseidonImpl(inputs));
}

export interface CapEntry { holderId: string; shareClass: string; shares: bigint }
export interface Receipt {
  version: 1; holderId: string;
  /** a fresh secret for THIS leaf: a holder with two classes gets two receipts, so their nullifiers differ */
  holderSecret: string; shareClass: string; classId: string; shareAmount: string; salt: string;
  leaf: string; leafIndex: number; merkleRoot: string; totalShares: string;
  merklePath: { elements: string[]; indices: number[] };
}
/** Everything the cap_table_commit circuit takes as private input, 64 slots, as decimal strings. */
export interface CommitWitness { holder_secret_hashes: string[]; share_classes: string[]; share_amounts: string[]; salts: string[] }

const randomField = (): bigint => {
  const b = new Uint8Array(31); globalThis.crypto.getRandomValues(b); // 248 bits: always below the field
  return b.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
};
const dec = (n: bigint) => n.toString();

/** Root and sibling paths of the depth-6 tree over `leaves` (padded with the all-zero slot leaf). */
export function buildTree(leaves: bigint[]) {
  if (leaves.length > SLOTS) throw new Error(`a confidential cap table holds at most ${SLOTS} slots`);
  const pad = H([0n, 0n, 0n, 0n]);
  const layer0 = [...leaves, ...Array(SLOTS - leaves.length).fill(pad)];
  const layers: bigint[][] = [layer0];
  for (let d = 0; d < DEPTH; d++) { const prev = layers[d], next: bigint[] = []; for (let i = 0; i < prev.length; i += 2) next.push(H([prev[i], prev[i + 1]])); layers.push(next); }
  const path = (index: number) => { const elements: bigint[] = [], indices: number[] = []; let i = index; for (let d = 0; d < DEPTH; d++) { elements.push(layers[d][i ^ 1]); indices.push(i & 1); i >>= 1; } return { elements, indices }; };
  return { root: layers[DEPTH][0], layers, path };
}

export const classIdOf = (shareClass: string, classes: string[]) => { const i = classes.indexOf(shareClass); if (i < 0) throw new Error(`unknown share class ${shareClass}`); return BigInt(i + 1); }; // 0 is the padding slot

/** One leaf (and one receipt) per entry; shares must fit in 64 bits. Returns the root, the receipts and the circuit witness. */
export async function generateShareholderReceipts(capTable: CapEntry[], opts: { classes: string[]; random?: () => bigint }) {
  await initPoseidon();
  if (capTable.length === 0) throw new Error("the cap table is empty");
  const rnd = opts.random ?? randomField;
  const secrets = capTable.map(() => rnd()), salts = capTable.map(() => rnd());
  let total = 0n;
  const hashes = secrets.map((s) => H([s]));
  const leaves = capTable.map((e, i) => {
    if (e.shares < 0n || e.shares >= 1n << 64n) throw new Error(`shares of ${e.holderId} do not fit in 64 bits`);
    total += e.shares;
    return H([hashes[i], classIdOf(e.shareClass, opts.classes), e.shares, salts[i]]);
  });
  const tree = buildTree(leaves);
  const receipts: Receipt[] = capTable.map((e, i) => { const p = tree.path(i); return {
    version: 1, holderId: e.holderId, holderSecret: dec(secrets[i]), shareClass: e.shareClass, classId: dec(classIdOf(e.shareClass, opts.classes)), shareAmount: dec(e.shares), salt: dec(salts[i]),
    leaf: dec(leaves[i]), leafIndex: i, merkleRoot: dec(tree.root), totalShares: dec(total), merklePath: { elements: p.elements.map(dec), indices: p.indices } }; });
  const pad = (v: string[], zero = "0") => [...v, ...Array(SLOTS - v.length).fill(zero)];
  const witness: CommitWitness = {
    holder_secret_hashes: pad(hashes.map(dec)), share_classes: pad(capTable.map((e) => dec(classIdOf(e.shareClass, opts.classes)))),
    share_amounts: pad(capTable.map((e) => dec(e.shares))), salts: pad(salts.map(dec)) };
  return { root: tree.root, totalShares: total, receipts, witness };
}

/** sha256(account id) read as a big-endian number, reduced into the field. The contract computes the same value with env::sha256. */
export async function recipientHashOf(accountId: string): Promise<bigint> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId)));
  return d.reduce((a, x) => (a << 8n) | BigInt(x), 0n) % FIELD;
}
/** The exact pro-rata payout the private_claim circuit checks: floor(share * pot / total). */
export const payoutOf = (shareAmount: bigint, totalPot: bigint, totalShares: bigint) => (shareAmount * totalPot) / totalShares;
export const nullifierOf = (holderSecret: bigint, exitId: bigint) => H([holderSecret, exitId]);

export interface ProverFiles { wasm: string; zkey: string }
export interface Groth16Proof { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol?: string; curve?: string }
/** The shape the contract takes: a: [x, y], b: [[x0, x1], [y0, y1]], c: [x, y], decimal strings. */
export const toContractProof = (p: Groth16Proof) => ({ a: [p.pi_a[0], p.pi_a[1]], b: [[p.pi_b[0][0], p.pi_b[0][1]], [p.pi_b[1][0], p.pi_b[1][1]]], c: [p.pi_c[0], p.pi_c[1]] });

export async function proveCapTableCommit(witness: CommitWitness, pub: { merkleRoot: bigint; totalShares: bigint; roundId: bigint }, files: ProverFiles) {
  const snarkjs = await import("snarkjs");
  const input = { ...witness, merkle_root: dec(pub.merkleRoot), total_shares: dec(pub.totalShares), round_id: dec(pub.roundId) };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
  return { proof: proof as Groth16Proof, publicSignals, contractProof: toContractProof(proof) };
}

export async function provePrivateClaim(receipt: Receipt, exit: { exitId: bigint; totalShares: bigint; totalPot: bigint }, recipientId: string, files: ProverFiles) {
  await initPoseidon();
  const secret = BigInt(receipt.holderSecret), share = BigInt(receipt.shareAmount);
  const payout = payoutOf(share, exit.totalPot, exit.totalShares), nullifier = nullifierOf(secret, exit.exitId), recipient = await recipientHashOf(recipientId);
  const input = {
    holder_secret: receipt.holderSecret, share_class: receipt.classId, share_amount: receipt.shareAmount, salt: receipt.salt,
    path_elements: receipt.merklePath.elements, path_indices: receipt.merklePath.indices.map(String),
    merkle_root: receipt.merkleRoot, nullifier: dec(nullifier), exit_id: dec(exit.exitId), total_shares: dec(exit.totalShares), total_pot: dec(exit.totalPot), payout_amount: dec(payout), recipient_hash: dec(recipient) };
  const snarkjs = await import("snarkjs");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
  return { proof: proof as Groth16Proof, publicSignals, contractProof: toContractProof(proof), payoutAmount: payout, nullifier, recipientHash: recipient };
}

export async function verifyZkProof(vkey: unknown, publicSignals: string[], proof: Groth16Proof) {
  const snarkjs = await import("snarkjs");
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
