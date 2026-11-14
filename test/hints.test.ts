import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { HINTS, hint } from "../web/src/hints";

const sources = [...readdirSync("web/src").filter((f: string) => f.endsWith(".ts")).map((f: string) => `web/src/${f}`), "web/index.html"].map((f) => [f, readFileSync(f, "utf8")] as const);

describe("hints", () => {
  it("every hint the app draws has text (a typo would draw nothing)", () => {
    const used = new Set<string>();
    for (const [f, src] of sources) { if (f.endsWith("hints.ts")) continue; for (const m of src.matchAll(/hint\("([A-Za-z]+)"/g)) used.add(m[1]); for (const m of src.matchAll(/hintKey: "([A-Za-z]+)"/g)) used.add(m[1]); for (const m of src.matchAll(/data-hint="([A-Za-z]+)"/g)) used.add(m[1]); }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((k) => !HINTS[k])).toEqual([]);
  });
  it("every hint in the dictionary is used somewhere (no dead text)", () => {
    const all = sources.filter(([f]) => !f.endsWith("hints.ts")).map(([, s]) => s).join("\n");
    const unused = Object.keys(HINTS).filter((k) => !new RegExp(`hint\\("${k}"|hintKey: "${k}"|data-hint="${k}"`).test(all));
    expect(unused).toEqual([]);
  });
  it("each hint is short plain text: a sentence or two, no markup", () => {
    for (const [k, t] of Object.entries(HINTS)) { expect(t.length, k).toBeGreaterThan(20); expect(t.length, k).toBeLessThan(260); expect(/[<>]/.test(t), k).toBe(false); }
  });
  it("an unknown key draws nothing, and a label is escaped", () => {
    expect(hint("noSuchKey")).toBe("");
    expect(hint("escrow", '"><img src=x>')).not.toContain("<img");
    expect(hint("escrow")).toContain('data-hint="escrow"');
  });
});
