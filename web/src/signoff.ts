// Investor sign-off, in the Founder view. A holder with a NEAR account signs (off chain, NEP-413) one message naming the plan hash and THEIR row;
// the proposer collects the signed tokens, sees "7 of 9 confirmed" with the missing names, and can commit the bundle on chain so the board sees it.
// This confirms an allocation row; it is not legal consent. Contract and multisig accounts cannot sign and show as such.
import { account, onAccount, send, signMessage } from "./wallet";
import { esc, loadChain, call } from "./chain";
import { toast, txLink } from "./actions";
import { hint } from "./hints";
import { usdExact } from "./format";
import { rowsOfPlan, signoffMessage, signoffPayload, toSignoff, evaluateSignoffs, serializeBundle, bundleHash, type Signoff, type SignoffBundle, type SignoffRow } from "../../src/engine/signoff";
import { nep413Hash, verifyNep413, fromB64 } from "../../src/engine/walletkey";

export interface SignoffDeps { rpc: string; explorer: string; context(): Promise<{ contract: string; plan: string; hash: string } | { error: string }>; }
const store = { get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => { const p = s.replace(/-/g, "+").replace(/_/g, "/"); return decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4)))); };
const TOKEN = "rounds-signoff:";

/** Is this public key a full-access key of the account? Asked of the chain, since a signature only proves the holder of SOME key. */
export const keyOnAccount = (rpc: string) => async (acct: string, publicKey: string): Promise<boolean> => {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key", finality: "final", account_id: acct, public_key: publicKey } }) });
  const j = await r.json(); return j.result?.permission === "FullAccess";
};

export function mountSignoff(host: HTMLElement, d: SignoffDeps) {
  let ctx: Awaited<ReturnType<SignoffDeps["context"]>> | null = null, list: Signoff[] = [], msg = "", report: Awaited<ReturnType<typeof evaluateSignoffs>> | null = null, busy = false, token = "", mine = "";
  const k = () => (ctx && !("error" in ctx) ? `rounds.signoffs.${ctx.contract}.${ctx.hash}` : "");
  const bundle = (): SignoffBundle => ({ version: 1, contract: (ctx as any).contract, planHash: (ctx as any).hash, signoffs: list });

  async function refresh() {
    ctx = await d.context().catch((e) => ({ error: (e as Error).message }));
    if ("error" in ctx) { report = null; draw(); return; }
    try { list = JSON.parse(store.get(k()) ?? "[]"); if (!Array.isArray(list)) list = []; } catch { list = []; }
    report = await evaluateSignoffs(list.length ? bundle() : null, rowsOfPlan(ctx.plan), ctx.contract, ctx.hash, keyOnAccount(d.rpc));
    draw();
  }
  const rowText = (r: SignoffRow) => `${r.lines.map((l) => `${BigInt(l.shares).toLocaleString("en-US")} ${l.class}`).join(" + ") || "no new shares"}${r.pays ? `, paying ${usdExact(BigInt(r.pays))}` : ""}`;

  function draw() {
    if (!ctx || "error" in ctx) { host.innerHTML = `<div class="card-h"><span class="mono muted">INVESTOR SIGN-OFF</span></div><p class="note">${ctx ? esc(ctx.error) : "…"}</p>`; return; }
    const exp = rowsOfPlan(ctx.plan), me = account(), myRow = me ? exp.rows.find((r) => r.account === me) : undefined;
    const status = (a: string) => report?.rows.find((x) => x.account === a);
    host.innerHTML = `<div class="card-h"><span class="mono muted">INVESTOR SIGN-OFF · EACH HOLDER CONFIRMS THEIR OWN ROW BEFORE THE BOARD VOTES${hint("signoff")}</span></div>
      <p class="note">Plan hash <span class="mono">${esc(ctx.hash.slice(0, 16))}…</span>. Each investor signs a message that names this hash <b>and</b> their row, with their own wallet; nothing is sent to the chain. If any money term changes afterwards the hash changes and the signatures stop matching. This confirms an allocation, it is not legal consent.</p>
      ${exp.rows.length ? `<table><tr><th>Account</th><th>Their row</th><th>Status</th></tr>${exp.rows.map((r) => { const s = status(r.account); return `<tr><td class="mono">${esc(r.account)}</td><td>${esc(rowText(r))}</td><td>${s?.status === "confirmed" ? `<span class="pass">confirmed</span>` : s?.status === "invalid" ? `<span class="fail">invalid</span> <span class="muted">${esc((s as any).reason)}</span>` : `<span class="muted">not yet</span>`}</td></tr>`; }).join("")}</table>
        <p style="margin:10px 0 4px"><b>${report ? `${report.confirmed} of ${report.total} confirmed` : ""}</b> ${report?.all ? `<span class="pass">All investors confirmed</span>` : `<span class="muted">the board sees exactly who is missing</span>`}</p>
        ${exp.unsigned.length ? `<p class="note">No signer (not a NEAR account, so nobody can sign): ${esc(exp.unsigned.join(", "))}.</p>` : ""}` : `<p class="note">This plan names no holder account that could sign. Add named investors above, and set a funding deadline.</p>`}
      ${myRow ? `<div style="margin-top:12px"><b>You are in this plan:</b> ${esc(rowText(myRow))}.<br/><button class="btn primary sm" id="so-sign" ${busy ? "disabled" : ""}>Sign off on my row with my wallet</button> ${status(myRow.account)?.status === "confirmed" ? `<span class="pass">already confirmed</span>` : ""}</div>` : me ? `<p class="note">Your account (<span class="mono">${esc(me)}</span>) has no row in this plan.</p>` : `<p class="note">Connect a wallet to sign off if you are one of the investors.</p>`}
      ${token ? `<div style="margin-top:10px"><span class="fl">Send this to whoever is collecting sign-offs</span><textarea readonly rows="3" id="so-token" style="width:100%" class="mono">${esc(token)}</textarea><button class="btn sm" id="so-copy">Copy</button></div>` : ""}
      <div style="margin-top:14px"><span class="fl">Add a sign-off an investor sent you</span><div style="display:flex;gap:8px"><input type="text" id="so-paste" placeholder="${TOKEN}…" autocomplete="off" spellcheck="false"/><button class="btn sm" id="so-add">Add</button></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn sm" id="so-commit" ${list.length && !busy ? "" : "disabled"}>Commit these sign-offs on chain (officer)</button><button class="btn sm" id="so-dl" ${list.length ? "" : "disabled"}>Download bundle</button></div>
      <p class="muted" style="margin:8px 0 0;font-size:12.5px">${esc(msg)}</p>`;
    const $ = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`);
    $("so-sign")?.addEventListener("click", () => void sign(myRow!));
    $("so-copy")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(token); toast("Copied.", "ok"); } catch { /* the text is selectable */ } });
    $("so-add")!.onclick = () => void add(($("so-paste") as HTMLInputElement).value.trim());
    $("so-commit")!.onclick = () => void commit();
    $("so-dl")!.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([serializeBundle(bundle())], { type: "application/json" })); a.download = "rounds-signoffs.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  }

  async function sign(row: SignoffRow) {
    if (!ctx || "error" in ctx) return; busy = true; msg = ""; draw();
    try {
      const text = signoffMessage(ctx.contract, ctx.hash, row);
      toast("Your wallet will show the message to sign. Check that it names your row.");
      const out = await signMessage(text, signoffPayload(text).recipient, signoffPayload(text).nonce);
      const so = toSignoff(out.accountId, text, out.publicKey, out.signature);
      if (!verifyNep413(signoffPayload(text), so.signature, so.publicKey)) throw new Error("the wallet's signature does not verify");
      list = [...list.filter((x) => x.account !== so.account), so]; store.set(k(), JSON.stringify(list));
      token = TOKEN + b64u(JSON.stringify(so)); mine = so.account; msg = "Signed. Send the text below to the proposer (or, if you are the proposer, it is already counted).";
      toast(`<span class="pass">DONE</span> signed off as ${esc(out.accountId)}`, "ok");
    } catch (e) { msg = ""; toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); }
    busy = false; await refresh();
  }
  async function add(text: string) {
    if (!ctx || "error" in ctx) return;
    try {
      if (!text.startsWith(TOKEN)) throw new Error("that is not a sign-off");
      const so = JSON.parse(unb64u(text.slice(TOKEN.length))) as Signoff;
      for (const f of ["account", "message", "nonce", "recipient", "publicKey", "signature"] as const) if (typeof so[f] !== "string" || so[f].length > 4000) throw new Error("that sign-off is damaged");
      if (!verifyNep413({ message: so.message, nonce: fromB64(so.nonce), recipient: so.recipient }, so.signature, so.publicKey)) throw new Error("the signature does not verify");
      list = [...list.filter((x) => x.account !== so.account), so]; store.set(k(), JSON.stringify(list)); msg = `Added ${so.account}; the table shows whether it matches this plan and the account's key.`;
    } catch (e) { msg = ""; toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); }
    await refresh();
  }
  async function commit() {
    if (!ctx || "error" in ctx || !list.length) return; busy = true; draw();
    try {
      const v = await loadChain(d.rpc, ctx.contract); const r = v.rounds.find((x) => x.plan_hash === (ctx as any).hash);
      if (!r) throw new Error("no round on that contract has this plan hash yet: propose the round first, then commit the sign-offs");
      if (r.status !== "Funding") throw new Error(`round ${r.id} is already ${r.status}; sign-offs can only be committed while it awaits approval`);
      const text = serializeBundle(bundle()); void call; const hash = await bundleHash(bundle());
      toast("Waiting for your wallet to approve: commit the sign-offs …");
      const x = await send(ctx.contract, [{ method: "commit_signoffs", args: { round_id: r.id, bundle: text }, gasTgas: 30, depositYocto: (BigInt(text.length + 300) * 10n ** 19n * 12n / 10n).toString() }]);
      if (x.hash) { msg = `Committed to round ${r.id}; the contract logged its sha256 ${hash.slice(0, 16)}….`; toast(`<span class="pass">DONE</span> sign-offs committed to round ${r.id}: ${txLink(d.explorer, x.hash)}`, "ok"); }
    } catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); }
    busy = false; await refresh();
  }
  void nep413Hash; void mine;
  window.addEventListener("rounds:model", () => { void refresh(); }); onAccount(() => void refresh()); void refresh();
}
