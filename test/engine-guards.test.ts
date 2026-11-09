import { describe, it, expect } from "vitest";
import { priceRound, waterfall, vested } from "../src/engine/index";

const M = 1_000_000n;
const D = (n: bigint) => n * M;
const base = () => ({
  common: { ada: 5_000_000n },
  unissuedPool: 0n,
  safes: [],
  preMoney: 20_000_000n * M,
  investors: { fund: 1_000_000n * M },
  poolTarget: { num: 0n, den: 1n },
});

describe("priceRound input guards", () => {
  it("rejects a zero round price instead of dividing by zero", () => {
    expect(() => priceRound({ ...base(), common: { ada: 1_000_000n }, preMoney: 1n, investors: {} })).toThrow(/price is zero/i);
  });
  it("rejects when there are no shares to price", () => {
    expect(() => priceRound({ ...base(), common: {}, investors: { fund: 1_000n } })).toThrow(/no shares to price/i);
  });
  it("rejects a non-positive pre-money", () => {
    expect(() => priceRound({ ...base(), preMoney: 0n })).toThrow(/pre-money/i);
  });
  it("rejects a non-positive SAFE cap", () => {
    expect(() => priceRound({ ...base(), safes: [{ id: "s", holder: "c", amount: D(1n), postMoneyCap: 0n, discountBps: 0 }] })).toThrow(/cap/i);
  });
  it("rejects an out-of-range discount", () => {
    expect(() => priceRound({ ...base(), safes: [{ id: "s", holder: "c", amount: D(1n), postMoneyCap: D(10n), discountBps: 10_001 }] })).toThrow(/discount/i);
  });
  it("rejects duplicate SAFE ids", () => {
    const s = { id: "s", holder: "c", amount: D(1n), postMoneyCap: D(10n), discountBps: 0 };
    expect(() => priceRound({ ...base(), safes: [s, { ...s }] })).toThrow(/duplicate/i);
  });
  it("rejects a pool target of 100% or more", () => {
    expect(() => priceRound({ ...base(), poolTarget: { num: 1n, den: 1n } })).toThrow(/pool target/i);
  });
});

describe("waterfall input guards", () => {
  it("handles a zero base share count without dividing by zero", () => {
    const r = waterfall({ classes: { p: { shares: 1n, preferenceMicro: 100n } }, commonShares: {}, proceedsMicro: 50n });
    expect(r.payoutsMicro).toEqual({ p: 50n });
  });
  it("rejects a class with zero shares", () => {
    expect(() => waterfall({ classes: { p: { shares: 0n, preferenceMicro: 1n } }, commonShares: {}, proceedsMicro: 1n })).toThrow(/shares/i);
  });
  it("rejects negative proceeds", () => {
    expect(() => waterfall({ classes: {}, commonShares: { a: 1n }, proceedsMicro: -1n })).toThrow(/proceeds/i);
  });
});

describe("vesting guards", () => {
  it("rejects a non-positive term", () => {
    expect(() => vested({ totalShares: 1n, termMonths: 0, cliffMonths: 0 }, 0)).toThrow(/term/i);
  });
  it("rejects a cliff beyond the term", () => {
    expect(() => vested({ totalShares: 1n, termMonths: 12, cliffMonths: 13 }, 12)).toThrow(/cliff/i);
  });
});
