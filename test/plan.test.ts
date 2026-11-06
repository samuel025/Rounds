import { it, expect } from "vitest";
import { canonicalJson, planHash } from "../src/engine/index";
it("canonical JSON sorts keys and is stable", () => {
  expect(canonicalJson({ b: "2", a: ["x", { d: "1", c: "0" }] })).toBe('{"a":["x",{"c":"0","d":"1"}],"b":"2"}');
});
it("sha256 of the canonical plan matches a known digest", async () => {
  expect(await planHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
