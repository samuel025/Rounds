import type { PricedRoundInput, PricedRoundResult } from "./index";

/** RFC 8785 for the value shapes plans use (objects, arrays, strings, booleans, null; amounts are strings, never numbers). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isInteger(v)) throw new Error("plans carry amounts as strings; only integers allowed"); return String(v); }
  if (typeof v === "bigint") throw new Error("convert bigint to string before hashing");
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
  }
  throw new Error("unsupported value");
}

export async function planHash(canonical: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The plan the Rounds contract executes for a priced round (see contract RoundPlan). */
export function pricedRoundPlan(inp: PricedRoundInput, r: PricedRoundResult, classes: { safeClass: (safeId: string) => string; seriesClass: string; investorHolder?: (k: string) => string }) {
  const issuances: { class: string; holder: string; shares: string }[] = [];
  for (const s of inp.safes) issuances.push({ class: classes.safeClass(s.id), holder: s.holder, shares: r.holdings[s.id].toString() });
  for (const k of Object.keys(inp.investors)) issuances.push({ class: classes.seriesClass, holder: classes.investorHolder?.(k) ?? k, shares: (r.holdings[k] ?? 0n).toString() });
  if (r.poolTopUp > 0n) issuances.push({ class: "Common", holder: "unissued_pool", shares: r.poolTopUp.toString() });
  return { converted_safes: inp.safes.map((s) => s.id), issuances };
}
