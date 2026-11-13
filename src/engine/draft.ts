// Shareable round drafts: the modeler's terms packed into a URL fragment (#draft=...). A fragment is never sent to a server, needs no account
// and touches no chain, so founders and investors can pass a link back and forth while they negotiate.
// A link is UNTRUSTED input: everything is checked against a strict schema and size limits before it is used, and names are escaped when drawn.
// What a draft holds: the round's terms, the company's starting numbers, the SAFEs and the investors' split. It never holds holder codes, claim files or a
// confidential table. The same draft always encodes to the same text (sorted keys), so two people who open one link see one plan.
import { canonicalJson } from "./plan";

export interface DraftSafe { id: string; holder: string; amt: number; cap: number; disc: number }
export interface DraftAlloc { holder: string; bps: number }
export interface Draft {
  v: 1; pre: number; raise: number; pool: number; ada: number; bayo: number; poolNow: number;
  safes: DraftSafe[]; /** how the new money is split between investors, in basis points of the raise; empty = one investor (whoever proposes) */ allocs: DraftAlloc[];
  confidential: boolean; note: string;
}
export const DRAFT_PREFIX = "draft=";
export const MAX_DRAFT_CHARS = 8_000; // chat apps cut long links; the file download is the fallback
const MAX_DOLLARS = 1_000_000_000_000; // $1 trillion: far past anything real, small enough that dollars x 1e6 stays exact
const NAME = /^[a-z0-9._-]{2,64}$/;
const SAFE_ID = /^[a-z0-9_]{1,16}$/;

const int = (x: unknown, lo: number, hi: number, what: string): number => { if (typeof x !== "number" || !Number.isInteger(x) || x < lo || x > hi) throw new Error(`${what} must be a whole number from ${lo} to ${hi}`); return x; };
const own = (o: unknown): Record<string, unknown> => { if (typeof o !== "object" || o === null || Array.isArray(o)) throw new Error("the draft is not an object"); return o as Record<string, unknown>; };

/** Throws with a plain message if anything is off; returns a clean copy (unknown fields are dropped, not carried). */
export function validateDraft(x: unknown): Draft {
  const o = own(x);
  if (o.v !== 1) throw new Error("this draft was made by a different version of the app");
  const safesIn = Array.isArray(o.safes) ? o.safes : (() => { throw new Error("safes must be a list"); })();
  if (safesIn.length > 8) throw new Error("at most 8 SAFEs");
  const safes = safesIn.map((s, i): DraftSafe => { const q = own(s); const id = String(q.id), holder = String(q.holder);
    if (!SAFE_ID.test(id)) throw new Error(`SAFE ${i + 1} has a bad id`); if (!NAME.test(holder)) throw new Error(`SAFE ${i + 1} has a bad holder name`);
    return { id, holder, amt: int(q.amt, 0, MAX_DOLLARS, "a SAFE amount"), cap: int(q.cap, 0, MAX_DOLLARS, "a SAFE cap"), disc: int(q.disc, 0, 99, "a SAFE discount") }; });
  if (new Set(safes.map((s) => s.id)).size !== safes.length) throw new Error("two SAFEs share an id");
  const allocsIn = o.allocs === undefined ? [] : Array.isArray(o.allocs) ? o.allocs : (() => { throw new Error("allocations must be a list"); })();
  if (allocsIn.length > 16) throw new Error("at most 16 investors");
  const allocs = allocsIn.map((a): DraftAlloc => { const q = own(a); const holder = String(q.holder); if (!NAME.test(holder)) throw new Error("an investor has a bad account name"); return { holder, bps: int(q.bps, 1, 10_000, "an investor's share") }; });
  if (allocs.length && allocs.reduce((a, b) => a + b.bps, 0) !== 10_000) throw new Error("the investors' shares must add up to 100%");
  if (new Set(allocs.map((a) => a.holder)).size !== allocs.length) throw new Error("an investor is listed twice");
  const note = o.note === undefined ? "" : String(o.note); if (note.length > 280) throw new Error("the note is longer than 280 characters");
  return { v: 1, pre: int(o.pre, 0, MAX_DOLLARS, "the valuation"), raise: int(o.raise, 0, MAX_DOLLARS, "the raise"), pool: int(o.pool, 0, 99, "the pool target"),
    ada: int(o.ada, 0, 2 ** 53 - 1, "Ada's shares"), bayo: int(o.bayo, 0, 2 ** 53 - 1, "Bayo's shares"), poolNow: int(o.poolNow, 0, 2 ** 53 - 1, "the pool"),
    safes, allocs, confidential: o.confidential === true, note };
}

const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => { if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("the link is damaged"); const p = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p + "=".repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const w = stream.writable.getWriter(); void w.write(data as BufferSource).catch(() => {}); void w.close().catch(() => {});
  const r = stream.readable.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; n += value.length; if (n > limit) { await r.cancel(); throw new Error("the draft is larger than allowed"); } chunks.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}

/** Draft -> link text (without the leading '#'). */
export async function encodeDraft(d: Draft): Promise<string> {
  const clean = validateDraft(d);
  const json = canonicalJson({ ...clean, allocs: clean.allocs.map((a) => ({ ...a })), safes: clean.safes.map((s) => ({ ...s })), confidential: clean.confidential });
  const z = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  const out = DRAFT_PREFIX + b64u(z);
  if (out.length > MAX_DRAFT_CHARS) throw new Error("this draft is too long for a link; use the download instead");
  return out;
}
/** Link text ('#draft=...' or 'draft=...') -> a validated Draft. Never trusts the input: size-capped before and after inflating. */
export async function decodeDraft(frag: string): Promise<Draft> {
  const s = frag.replace(/^#/, ""); if (!s.startsWith(DRAFT_PREFIX)) throw new Error("not a draft link");
  const body = s.slice(DRAFT_PREFIX.length); if (body.length > MAX_DRAFT_CHARS) throw new Error("the link is longer than allowed");
  const json = new TextDecoder("utf-8", { fatal: true }).decode(await pipe(unb64u(body), new DecompressionStream("deflate-raw"), 64_000));
  let parsed: unknown; try { parsed = JSON.parse(json); } catch { throw new Error("the link does not contain a draft"); }
  return validateDraft(parsed);
}
/** Split the raise into whole micro-dollars by basis points; the last investor takes the rounding remainder so the parts add up exactly. */
export function splitRaise(raiseMicro: bigint, allocs: DraftAlloc[]): [string, bigint][] {
  let used = 0n; return allocs.map((a, i) => { const part = i === allocs.length - 1 ? raiseMicro - used : (raiseMicro * BigInt(a.bps)) / 10_000n; used += part; return [a.holder, part]; });
}
