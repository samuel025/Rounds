import { describe, it, expect } from "vitest";
import { usd, usdExact, price4 } from "../web/src/format";
import { DISTRIBUTE_GAS, MAX_DISTRIBUTE } from "../web/src/limits";

describe("web money formatting", () => {
  it("rounds headline dollars and cents", () => {
    expect(usd(2_000_000n)).toBe("$2");
    expect(usd(2_995_000n)).toBe("$3");
    expect(usd(2_500_000n, true)).toBe("$2.50");
    expect(usd(2_995_000n, true)).toBe("$3.00");
    expect(usd(-2_500_000n, true)).toBe("-$2.50");
  });
  it("shows every micro-dollar exactly, without Number", () => {
    expect(usdExact(2_000_000n)).toBe("$2");
    expect(usdExact(2_500_000n)).toBe("$2.5");
    expect(usdExact(2_000_001n)).toBe("$2.000001");
    expect(usdExact(9_007_199_254_740_993n)).toBe("$9,007,199,254.740993");
  });
  it("formats price per share to four decimals", () => {
    expect(price4(2_000_000n)).toBe("$2.0000");
    expect(price4(2_000_100n)).toBe("$2.0001");
    expect(price4(0n)).toBe("$0.0000");
  });
  it("attaches enough gas for a full distribute call", () => {
    expect(DISTRIBUTE_GAS).toBeGreaterThanOrEqual(20 + 30 * MAX_DISTRIBUTE);
  });
});
