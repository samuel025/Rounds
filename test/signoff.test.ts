import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { rowsOfPlan, signoffMessage, signoffPayload, toSignoff, evaluateSignoffs, bundleHash, serializeBundle, parseBundle, type SignoffBundle } from "../src/engine/signoff";
import { nep413Hash, toB64, formatPublicKey } from "../src/engine/walletkey";

const plan = JSON.stringify({ issuances: [
  { class: "Series A Preferred", holder: "fund.testnet", shares: "4500000" }, { class: "Series A Preferred", holder: "lead.testnet", shares: "1000" },
  { class: "SAFE 1 shadow preferred", holder: "chidi.testnet", shares: "250000" }, { class: "Common", holder: "unissued_pool", shares: "300000" }, { class: "Common", holder: "Some Employee", shares: "5" }],
  raise: [["fund.testnet", "9000000000000"], ["lead.testnet", "2000000"]], kind: "Priced", deadline_ns: "1" });
const HASH = "ab".repeat(32), C = "rounds-core.testnet";
const wallets: Record<string, Uint8Array> = {}; const wallet = (a: string) => (wallets[a] ??= ed25519.utils.randomSecretKey());
const signFor = (account: string, message: string, key = wallet(account)) => toSignoff(account, message, formatPublicKey(ed25519.getPublicKey(key)), toB64(ed25519.sign(nep413Hash(signoffPayload(message)), key)));
const chain = async (a: string, k: string) => formatPublicKey(ed25519.getPublicKey(wallet(a))) === k; // pretends the chain holds each wallet's real key

describe("rows of a plan", () => {
  it("one row per holder account; the pool and free-text names have no signer", () => {
    const { rows, unsigned } = rowsOfPlan(plan);
    expect(rows.map((r) => r.account)).toEqual(["chidi.testnet", "fund.testnet", "lead.testnet"]);
    expect(rows.find((r) => r.account === "fund.testnet")).toEqual({ account: "fund.testnet", lines: [{ class: "Series A Preferred", shares: "4500000" }], pays: "9000000000000" });
    expect(unsigned).toEqual(["Some Employee"]);
  });
});

describe("evaluating sign-offs", () => {
  const exp = rowsOfPlan(plan);
  const bundleOf = (accts: string[]): SignoffBundle => ({ version: 1, contract: C, planHash: HASH, signoffs: accts.map((a) => signFor(a, signoffMessage(C, HASH, exp.rows.find((r) => r.account === a)!))) });
  it("all confirmed", async () => { const r = await evaluateSignoffs(bundleOf(["chidi.testnet", "fund.testnet", "lead.testnet"]), exp, C, HASH, chain); expect(r.all).toBe(true); expect(r.confirmed).toBe(3); });
  it("reports who is missing instead of a bare yes", async () => { const r = await evaluateSignoffs(bundleOf(["fund.testnet"]), exp, C, HASH, chain); expect(r.all).toBe(false); expect(r.confirmed).toBe(1); expect(r.rows.filter((x) => x.status === "missing").map((x) => x.account)).toEqual(["chidi.testnet", "lead.testnet"]); });
  it("no bundle at all: everyone missing, never green", async () => { const r = await evaluateSignoffs(null, exp, C, HASH, chain); expect(r.all).toBe(false); expect(r.confirmed).toBe(0); });
  it("a changed number invalidates the signature that was given for the old one", async () => {
    const b = bundleOf(["chidi.testnet", "fund.testnet", "lead.testnet"]);
    const changed = rowsOfPlan(plan.replace('"4500000"', '"4500001"'));
    const r = await evaluateSignoffs(b, changed, C, HASH, chain);
    expect(r.rows.find((x) => x.account === "fund.testnet")).toMatchObject({ status: "invalid", reason: expect.stringMatching(/different row/) });
  });
  it("a bundle for another plan hash or contract counts as missing", async () => {
    const b = bundleOf(["fund.testnet"]);
    expect((await evaluateSignoffs(b, exp, C, "cd".repeat(32), chain)).confirmed).toBe(0);
    expect((await evaluateSignoffs(b, exp, "other.testnet", HASH, chain)).confirmed).toBe(0);
  });
  it("a forged signature, or a key that is not the account's, is invalid", async () => {
    const b = bundleOf(["fund.testnet"]); const msg = b.signoffs[0].message;
    const forged = { ...b, signoffs: [signFor("fund.testnet", msg, ed25519.utils.randomSecretKey())] };
    expect((await evaluateSignoffs(forged, exp, C, HASH, chain)).rows.find((x) => x.account === "fund.testnet")).toMatchObject({ status: "invalid", reason: expect.stringMatching(/full-access/) });
    const bad = { ...b, signoffs: [{ ...b.signoffs[0], signature: toB64(new Uint8Array(64)) }] };
    expect((await evaluateSignoffs(bad, exp, C, HASH, chain)).rows.find((x) => x.account === "fund.testnet")).toMatchObject({ status: "invalid", reason: expect.stringMatching(/does not verify/) });
  });
  it("one person cannot sign for another", async () => {
    const msg = signoffMessage(C, HASH, exp.rows.find((r) => r.account === "lead.testnet")!);
    const b: SignoffBundle = { version: 1, contract: C, planHash: HASH, signoffs: [{ ...signFor("fund.testnet", msg), account: "lead.testnet" }] };
    expect((await evaluateSignoffs(b, exp, C, HASH, chain)).confirmed).toBe(0);
  });
  it("the bundle hash is stable under reordering and changes with any signature", async () => {
    const b = bundleOf(["chidi.testnet", "fund.testnet"]); const h = await bundleHash(b);
    expect(await bundleHash({ ...b, signoffs: [...b.signoffs].reverse() })).toBe(h);
    expect(await bundleHash({ ...b, signoffs: [b.signoffs[0]] })).not.toBe(h);
  });
  it("what the contract stores is the serialized text, and reading it back gives the same bundle; junk reads as no bundle", async () => {
    const b = bundleOf(["chidi.testnet", "fund.testnet"]); const text = serializeBundle(b);
    expect(parseBundle(text)).toEqual(JSON.parse(text)); expect(await bundleHash(parseBundle(text)!)).toBe(await bundleHash(b));
    expect(parseBundle("not json")).toBeNull(); expect(parseBundle(null)).toBeNull(); expect(parseBundle('{"version":2}')).toBeNull();
    expect(parseBundle(JSON.stringify({ version: 1, contract: C, planHash: HASH, signoffs: [{ account: "x" }, 5] }))!.signoffs).toEqual([]); // malformed entries are dropped
  });
});
