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
/** What a holder creates for themselves, on their own device. Only the `holderCode` ever leaves it: the proposer puts the code into the table, never the secret. */
export interface HolderKey { version: 1; holderSecret: string; holderCode: string }
/** A cap-table row for the proposer: who (a private label), which class, how many shares, and the holder's public code. */
export interface TableEntry extends CapEntry { holderCode: string; salt?: string }
/** What a holder needs, besides their own key, to claim: their place in the committed table. It holds NO secret, so it can be re-issued from the table file. */
export interface ClaimFile {
  version: 2; holderId: string; shareClass: string; classId: string; shareAmount: string; salt: string; holderCode: string;
  leaf: string; leafIndex: number; merkleRoot: string; totalShares: string; merklePath: { elements: string[]; indices: number[] };
}
/** The whole private table, for the proposer and the board (never put on chain). Anyone holding it can re-seal it and compare the root. */
export interface TableFile {
  version: 1; classes: string[]; merkleRoot: string; totalShares: string;
  entries: { holderId: string; shareClass: string; shares: string; holderCode: string; salt: string; leafIndex: number }[];
}
/** The legacy combined shape (demo mode: this tab created every holder's key). */
export type Receipt = ClaimFile & { holderSecret: string };
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

/** A holder creates their own secret on their own device; the code is what they hand to whoever builds the table. */
export async function generateHolderKey(random?: () => bigint): Promise<HolderKey> {
  await initPoseidon();
  const secret = (random ?? randomField)();
  return { version: 1, holderSecret: dec(secret), holderCode: dec(H([secret])) };
}

/** Builds the private table from the holders' public codes: the root, one claim file per row (no secrets in them) and the table file for the board. */
export async function buildConfidentialTable(entries: TableEntry[], classes: string[], random?: () => bigint) {
  await initPoseidon();
  if (entries.length === 0) throw new Error("the cap table is empty");
  const rnd = random ?? randomField;
  let total = 0n;
  const rows = entries.map((e, i) => {
    if (e.shares < 0n || e.shares >= 1n << 64n) throw new Error(`shares of ${e.holderId} do not fit in 64 bits`);
    total += e.shares;
    const code = BigInt(e.holderCode); if (code <= 0n || code >= FIELD) throw new Error(`the holder code of ${e.holderId} is not a field element`);
    const salt = e.salt !== undefined ? BigInt(e.salt) : rnd();
    return { ...e, code, salt, classId: classIdOf(e.shareClass, classes), leaf: H([code, classIdOf(e.shareClass, classes), e.shares, salt]), leafIndex: i };
  });
  const tree = buildTree(rows.map((r) => r.leaf));
  const claimFiles: ClaimFile[] = rows.map((r) => { const p = tree.path(r.leafIndex); return {
    version: 2, holderId: r.holderId, shareClass: r.shareClass, classId: dec(r.classId), shareAmount: dec(r.shares), salt: dec(r.salt), holderCode: dec(r.code),
    leaf: dec(r.leaf), leafIndex: r.leafIndex, merkleRoot: dec(tree.root), totalShares: dec(total), merklePath: { elements: p.elements.map(dec), indices: p.indices } }; });
  const tableFile: TableFile = { version: 1, classes, merkleRoot: dec(tree.root), totalShares: dec(total), entries: rows.map((r) => ({ holderId: r.holderId, shareClass: r.shareClass, shares: dec(r.shares), holderCode: dec(r.code), salt: dec(r.salt), leafIndex: r.leafIndex })) };
  const pad = (v: string[], zero = "0") => [...v, ...Array(SLOTS - v.length).fill(zero)];
  const witness: CommitWitness = { holder_secret_hashes: pad(rows.map((r) => dec(r.code))), share_classes: pad(rows.map((r) => dec(r.classId))), share_amounts: pad(rows.map((r) => dec(r.shares))), salts: pad(rows.map((r) => dec(r.salt))) };
  return { root: tree.root, totalShares: total, claimFiles, tableFile, witness };
}

/** Re-issues every claim file from a table file: a lost claim file is not a lost claim (the holder's own key is the only secret). */
export async function claimFilesFromTable(table: TableFile): Promise<ClaimFile[]> {
  const b = await buildConfidentialTable(table.entries.map((e) => ({ holderId: e.holderId, shareClass: e.shareClass, shares: BigInt(e.shares), holderCode: e.holderCode, salt: e.salt })), table.classes);
  if (dec(b.root) !== table.merkleRoot) throw new Error("the table file does not hash to its own root");
  return b.claimFiles;
}

/** The board's check: re-seal the table file and compare it with what the chain holds. Every problem is listed; `ok` is true only if there are none. */
export async function checkTableFile(table: TableFile, onChain: { merkleRoot: string; totalShares: string }) {
  await initPoseidon();
  const problems: string[] = [];
  let b: Awaited<ReturnType<typeof buildConfidentialTable>> | null = null;
  try { b = await buildConfidentialTable(table.entries.map((e) => ({ holderId: e.holderId, shareClass: e.shareClass, shares: BigInt(e.shares), holderCode: e.holderCode, salt: e.salt })), table.classes); }
  catch (e) { problems.push(`the table cannot be sealed: ${(e as Error).message}`); }
  if (b) {
    if (dec(b.root) !== onChain.merkleRoot) problems.push("the table hashes to a DIFFERENT root than the one on chain");
    if (dec(b.totalShares) !== onChain.totalShares) problems.push(`the table adds up to ${dec(b.totalShares)} shares, the chain says ${onChain.totalShares}`);
    if (dec(b.root) !== table.merkleRoot) problems.push("the table file's own root is not the root of its rows");
  }
  const codes = table.entries.map((e) => e.holderCode); if (new Set(codes).size !== codes.length) problems.push("two rows share one holder code (one holder, or one key reused)");
  const byClass: Record<string, bigint> = {}; for (const e of table.entries) byClass[e.shareClass] = (byClass[e.shareClass] ?? 0n) + BigInt(e.shares);
  return { ok: problems.length === 0, problems, computedRoot: b ? dec(b.root) : null, computedTotal: b ? dec(b.totalShares) : null, rows: table.entries.map((e) => ({ holderId: e.holderId, shareClass: e.shareClass, shares: e.shares })), byClass };
}

/** Demo mode: this tab creates every holder's key itself (so the page can run the whole flow alone). Real holders create their own with generateHolderKey. */
export async function generateShareholderReceipts(capTable: CapEntry[], opts: { classes: string[]; random?: () => bigint }) {
  const keys = await Promise.all(capTable.map(() => generateHolderKey(opts.random)));
  const b = await buildConfidentialTable(capTable.map((e, i) => ({ ...e, holderCode: keys[i].holderCode })), opts.classes, opts.random);
  const receipts: Receipt[] = b.claimFiles.map((c, i) => ({ ...c, holderSecret: keys[i].holderSecret }));
  return { root: b.root, totalShares: b.totalShares, receipts, keys, claimFiles: b.claimFiles, tableFile: b.tableFile, witness: b.witness };
}

export interface EscrowFile { version: 1; kdf: "PBKDF2-SHA256"; iterations: number; salt: string; iv: string; ciphertext: string }
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)), unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function escrowKey(pass: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return globalThis.crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/** An encrypted copy of the table file for the board, protected by a passphrase the proposer gives the board. Its hash can be committed in the round, so the copy cannot be swapped or withheld later. */
export async function encryptEscrow(table: TableFile, passphrase: string, iterations = 250_000): Promise<EscrowFile> {
  if (passphrase.length < 12) throw new Error("use a passphrase of at least 12 characters");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))), iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await escrowKey(passphrase, salt, iterations);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(table))));
  return { version: 1, kdf: "PBKDF2-SHA256", iterations, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) };
}
export async function decryptEscrow(file: EscrowFile, passphrase: string): Promise<TableFile> {
  const key = await escrowKey(passphrase, unb64(file.salt), file.iterations);
  try { return JSON.parse(new TextDecoder().decode(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, key, unb64(file.ciphertext)))); }
  catch { throw new Error("wrong passphrase, or the escrow file was changed"); }
}
/** The commitment that goes into the round: sha256 of the escrow file's canonical JSON. */
export async function escrowHash(file: EscrowFile): Promise<string> {
  const canon = JSON.stringify({ ciphertext: file.ciphertext, iterations: file.iterations, iv: file.iv, kdf: file.kdf, salt: file.salt, version: file.version });
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon)))].map((x) => x.toString(16).padStart(2, "0")).join("");
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

export async function provePrivateClaim(claim: ClaimFile, holderSecret: string, exit: { exitId: bigint; totalShares: bigint; totalPot: bigint }, recipientId: string, files: ProverFiles) {
  await initPoseidon();
  const secret = BigInt(holderSecret), share = BigInt(claim.shareAmount);
  if (dec(H([secret])) !== claim.holderCode) throw new Error("this holder key does not belong to this claim file");
  const payout = payoutOf(share, exit.totalPot, exit.totalShares), nullifier = nullifierOf(secret, exit.exitId), recipient = await recipientHashOf(recipientId);
  const input = {
    holder_secret: holderSecret, share_class: claim.classId, share_amount: claim.shareAmount, salt: claim.salt,
    path_elements: claim.merklePath.elements, path_indices: claim.merklePath.indices.map(String),
    merkle_root: claim.merkleRoot, nullifier: dec(nullifier), exit_id: dec(exit.exitId), total_shares: dec(exit.totalShares), total_pot: dec(exit.totalPot), payout_amount: dec(payout), recipient_hash: dec(recipient) };
  const snarkjs = await import("snarkjs");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
  return { proof: proof as Groth16Proof, publicSignals, contractProof: toContractProof(proof), payoutAmount: payout, nullifier, recipientHash: recipient };
}

export async function verifyZkProof(vkey: unknown, publicSignals: string[], proof: Groth16Proof) {
  const snarkjs = await import("snarkjs");
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
