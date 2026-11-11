import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain ES module
import { relayClaim } from "../relayer/claim.mjs";

// The relayer checks a claim off chain before it spends any gas. The chain is stubbed; the proofs are the real ones from the contract's fixtures.
const fx = JSON.parse(readFileSync("contract/it/fixtures/zk.json", "utf8"));
const inv = fx.claims.investor;
const cfg = { rpc: "http://rpc.invalid", contract: "c.test.near", account: "relayer.test.near", privateKey: "ed25519:not-a-real-key", vkeyPath: "web/public/zk/private_claim_verification_key.json", perMinute: 100 };
const body = { exit_id: 1, nullifier: inv.nullifier, payout_amount: inv.payout, recipient_id: inv.recipient, proof: inv.proof };

function chain(opts: { approved?: boolean; used?: boolean; exit?: boolean } = {}) {
  const { approved = true, used = false, exit = true } = opts;
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const m = JSON.parse(init.body).params.method_name as string;
    const val = m === "private_exit" ? (exit ? { id: 1, round_id: 1, total_shares: fx.total_shares, pot: fx.pot, approved } : null) : m === "confidential_root" ? [fx.merkle_root, fx.total_shares] : m === "nullifier_used" ? used : null;
    return { json: async () => ({ result: { result: [...Buffer.from(JSON.stringify(val))] } }) };
  });
}
afterEach(() => vi.unstubAllGlobals());
let n = 0; const who = () => `t${n++}`;

describe("claim relayer", () => {
  it("a valid claim passes every off-chain check and reaches the signing step (which fails here only because the key is fake)", async () => {
    chain(); const r = await relayClaim(body, cfg, who());
    expect(r.status).toBe(502); expect(r.body.ok).toBe(false); expect(r.body.error).not.toMatch(/proof does not verify|malformed/);
  }, 60_000);
  it("refuses a proof for another recipient, a changed amount, or tampered bytes, before spending anything", async () => {
    chain();
    expect((await relayClaim({ ...body, recipient_id: "attacker.test.near" }, cfg, who())).status).toBe(422);
    expect((await relayClaim({ ...body, payout_amount: (BigInt(inv.payout) + 1n).toString() }, cfg, who())).status).toBe(422);
    expect((await relayClaim({ ...body, proof: { ...inv.proof, a: ["1", inv.proof.a[1]] } }, cfg, who())).status).toBe(422);
  }, 60_000);
  it("refuses a spent receipt, an unapproved payout, an unknown payout and a malformed request", async () => {
    chain({ used: true }); const r1 = await relayClaim(body, cfg, who()); expect(r1.status).toBe(409); expect(r1.body.error).toMatch(/ERR_NULLIFIER_USED/);
    chain({ approved: false }); expect((await relayClaim(body, cfg, who())).status).toBe(409);
    chain({ exit: false }); expect((await relayClaim(body, cfg, who())).status).toBe(404);
    chain(); expect((await relayClaim({ ...body, recipient_id: "NOT AN ACCOUNT" }, cfg, who())).status).toBe(400);
    expect((await relayClaim({ ...body, proof: { a: [1, 2], b: [], c: [] } }, cfg, who())).status).toBe(400);
    expect((await relayClaim(null, cfg, who())).status).toBe(400);
  }, 60_000);
  it("rate-limits one requester", async () => {
    chain(); const c = { ...cfg, perMinute: 2 }, id = who();
    await relayClaim({ ...body, recipient_id: "NOT AN ACCOUNT" }, c, id); await relayClaim({ ...body, recipient_id: "NOT AN ACCOUNT" }, c, id);
    expect((await relayClaim(body, c, id)).status).toBe(429);
  });
});
