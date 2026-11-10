import { it, expect } from "vitest";
import { canonicalJson, planHash, sealPlan, NO_DEADLINE } from "../src/engine/index";
it("canonical JSON sorts keys and is stable", () => {
  expect(canonicalJson({ b: "2", a: ["x", { d: "1", c: "0" }] })).toBe('{"a":["x",{"c":"0","d":"1"}],"b":"2"}');
});
it("sorts keys by UTF-16 code units, as RFC 8785 requires", () => {
  expect(canonicalJson({ "\uffff": "bmp", "😀": "emoji" })).toBe('{"😀":"emoji","\uffff":"bmp"}');
});
it("escapes control characters and leaves other unicode as UTF-8", () => {
  expect(canonicalJson({ s: "a\u0000\u001f\u007f\u2028é😀\"\\" })).toBe('{"s":"a\\u0000\\u001f\u007f\u2028é😀\\"\\\\"}');
});
it("sha256 of the canonical plan matches a known digest", async () => {
  expect(await planHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
it("a sealed plan carries its money terms, so changing the raise changes the hash", async () => {
  const body = { issuances: [{ class: "Series A Preferred", holder: "fund.testnet", shares: "4500000" }] };
  const sealed = sealPlan(body, { kind: "Priced", raise: [["fund.testnet", 9_000_000_000_000n]] });
  expect(canonicalJson(sealed)).toBe(`{"deadline_ns":"${NO_DEADLINE}","issuances":[{"class":"Series A Preferred","holder":"fund.testnet","shares":"4500000"}],"kind":"Priced","raise":[["fund.testnet","9000000000000"]]}`);
  const cheap = sealPlan(body, { kind: "Priced", raise: [["fund.testnet", 1n]] });
  const later = sealPlan(body, { kind: "Priced", raise: [["fund.testnet", 9_000_000_000_000n]], deadlineNs: 1_900_000_000_000_000_000n });
  const hashes = await Promise.all([sealed, cheap, later].map((p) => planHash(canonicalJson(p))));
  expect(new Set(hashes).size).toBe(3);
});
