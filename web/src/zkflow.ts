// Confidential mode (ZK), opt-in: build a private cap table from the modeled round, prove it in the browser (Groth16, Poseidon Merkle root),
// propose it, then open a payout that holders claim privately with a receipt. Runs on a sandbox whose contract has the ZK methods.
// Honest limits: the paid AMOUNT of a claim is public (it follows from pot and total shares), only the link between a holder and the paying-out
// account is hidden, and only if the claim is submitted by an account that is not linked to the holder. See the README.
import { account, onAccount, send, type Act } from "./wallet";
import { call, esc, loadChain, type ChainView } from "./chain";
import { toast, txLink, boardAct } from "./actions";
import { usdExact as usd } from "./format";
import type { CapEntry, Receipt } from "../../src/engine/zk";

export interface ZkDeps {
  rpc: string; explorer: string; contract: string; board: string; token: string;
  /** the modeled round as a flat cap table (pool excluded) and the new money, for the connected account as the investor */
  model: (acct: string) => { entries: CapEntry[]; classes: string[]; raiseMicro: bigint } | null;
}
const M = 1_000_000n, POTS = [1_000, 10_000, 100_000], FILES = { commit: { wasm: "zk/cap_table_commit.wasm", zkey: "zk/cap_table_commit_final.zkey" }, claim: { wasm: "zk/private_claim.wasm", zkey: "zk/private_claim_final.zkey" } };
type St = "done" | "current" | "wait";
interface Row { n: number; title: string; help: string; st: St; label?: string; act?: string; off?: boolean }
const store = { get(k: string): any { try { const s = sessionStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } }, set(k: string, v: unknown) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } } };
/** The proving libraries expect Node's Buffer and process; the wallet code shims the same globals. */
async function nodeGlobals() {
  const g = globalThis as any;
  if (!g.Buffer) g.Buffer = (await import("buffer")).Buffer;
  if (!g.global) g.global = globalThis;
  if (!g.process) g.process = { env: {}, browser: true, version: "", versions: {}, nextTick: (f: (...a: unknown[]) => void, ...x: unknown[]) => queueMicrotask(() => f(...x)) };
}
const download = (name: string, data: unknown) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

export function mountZkFlow(host: HTMLElement, d: ZkDeps) {
  let v: ChainView | null = null, bal = 0n, acct: string | null = null, busy = false, status = "", readError = "", pot = 10_000;
  let receipts: Receipt[] | null = null, built: { rootDec: string; total: bigint } | null = null, pexits: any[] = [];
  const key = (w: string) => `zk:${d.contract}:${acct ?? "-"}:${w}`;
  const myRound = () => { const id = store.get(key("round")); return v && id ? v.rounds.find((r) => r.id === id) ?? null : null; };
  const myExit = () => { const id = store.get(key("pexit")); return id ? pexits.find((e) => e.id === id) ?? null : null; };

  async function refresh() {
    try { v = await loadChain(d.rpc, d.contract); readError = ""; } catch (e) { readError = (e as Error).message; }
    acct = account();
    if (acct && v) { try { bal = BigInt(await call(d.rpc, d.token, "ft_balance_of", { account_id: acct })); } catch { /* keep */ } }
    pexits = []; for (let i = 1; i <= 30; i++) { try { const e = await call(d.rpc, d.contract, "private_exit", { exit_id: i }); if (!e) break; pexits.push(e); } catch { break; } }
    if (v && acct) { // a proposal sent before a wallet redirect: find its round by the root it carries
      const pend = store.get(key("pending"));
      if (pend) { const r = v.rounds.find((x) => String(x.kind) === "Confidential" && x.plan.includes(`"merkle_root":"${pend.root}"`) && x.id >= pend.next); if (r) { store.set(key("round"), r.id); store.set(key("pending"), null); store.set(key("officer"), true); } }
      const pp = store.get(key("pexpend"));
      if (pp) { const e = pexits.find((x) => x.id >= pp.next && x.round_id === pp.round); if (e) { store.set(key("pexit"), e.id); store.set(key("pexpend"), null); } }
    }
    draw();
  }

  function rows(): Row[] {
    const m = acct ? d.model(acct) : null, want = m?.raiseMicro ?? 0n, r = myRound(), ex = myExit();
    const funded = !!r && r.raise.every(([, a], k) => BigInt(r.deposits[k]?.[1] ?? "0") === BigInt(a));
    const s1 = !!acct, s2 = s1 && bal >= want + BigInt(pot) * M, s3 = s1 && (!!store.get(key("officer")) || !!r), s4 = !!r, s5 = funded, s6 = !!r && r.status !== "Funding", s7 = r?.status === "Closed";
    const s8 = !!ex, s9 = !!ex && BigInt(ex.funded) === BigInt(ex.pot), s10 = !!ex && ex.approved, s11 = !!ex && BigInt(ex.claimed) === BigInt(ex.pot);
    const flags = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11], cur = flags.findIndex((x) => !x) + 1 || 12;
    const st = (n: number): St => (flags[n - 1] ? "done" : n === cur ? "current" : "wait");
    return [
      { n: 1, title: "Connect a testnet wallet", help: s1 ? `Connected as ${acct}.` : "MyNearWallet or Meteor; each step opens your wallet to approve.", st: st(1), label: s1 ? undefined : "Connect wallet", act: "connect" },
      { n: 2, title: "Get test USDC", help: `The round raises ${usd(want)} from you and the payout pot is ${usd(BigInt(pot) * M)}. Your balance: ${usd(bal)}.`, st: st(2), label: "Get test USDC", act: "faucet", off: !s1 },
      { n: 3, title: "Make yourself an officer", help: "Only officers can propose a round or a payout. The open sandbox board grants it to anyone.", st: st(3), label: "Make me an officer", act: "officer", off: !s1 },
      { n: 4, title: "Build the private cap table, prove it, propose it", help: r ? `Round ${r.id} is on chain with root ${String(JSON.parse(r.plan).merkle_root).slice(0, 14)}…; only the root, the total and the raise are public.` : status || "Builds a Poseidon Merkle tree of the modeled cap table in this tab, proves in your browser that it adds up to the public total, and sends only the root and the proof.", st: st(4), label: "Prove and propose", act: "propose", off: !s3 || busy },
      { n: 5, title: "Fund the round", help: "You pay the raise into escrow (public: who paid how much). It is refunded if the round is cancelled.", st: st(5), label: "Fund", act: "fund", off: !r || r.status !== "Funding" || funded },
      { n: 6, title: "Board approves the plan hash", help: "The board approves the hash of the plan that carries the root. On the open sandbox you act as the board; a real DAO would first check the root against the table it was given privately.", st: st(6), label: "Approve as the board", act: "approve", off: !r || r.status !== "Funding" },
      { n: 7, title: "Close the round", help: "The contract commits the root. No holdings are credited: there are none to see.", st: st(7), label: "Close round", act: "close", off: !(r?.status === "Approved" && funded) },
      { n: 8, title: "Open a private payout", help: ex ? `Private payout ${ex.id} on round ${ex.round_id}: pot ${usd(BigInt(ex.pot))} over ${BigInt(ex.total_shares).toLocaleString("en-US")} shares.` : "A payout that is claimed with receipts instead of being paid to named holders.", st: st(8), label: "Open payout", act: "pexit", off: !s7 },
      { n: 9, title: "Fund the pot", help: "The treasury (you) puts the pot into the contract.", st: st(9), label: "Fund the pot", act: "pfund", off: !ex || s9 },
      { n: 10, title: "Board approves the payout", help: "Approving opens claims; nothing is paid until a holder proves their share.", st: st(10), label: "Approve as the board", act: "papprove", off: !ex || !s9 || s10 },
      { n: 11, title: "Holders claim privately", help: ex ? `Claimed ${usd(BigInt(ex.claimed))} of ${usd(BigInt(ex.pot))}. Use the claim panel below with a receipt and any fresh account.` : "Each holder uses their receipt below.", st: st(11), label: "Go to the claim panel", act: "toclaim", off: !s10 },
    ];
  }

  function draw() {
    const r = myRound(), banner = readError ? `<div class="flow-banner fail">Could not read the contract: ${esc(readError)}</div>` : `<div class="flow-banner muted">Confidential sandbox <span class="mono">${esc(d.contract)}</span>${v ? ` · ${v.rounds.length} round(s)` : ""}${busy ? " · working…" : ""}</div>`;
    host.innerHTML = banner
      + `<div style="display:flex;gap:10px;align-items:center;margin:4px 0 12px"><label for="zk-pot" style="margin:0;white-space:nowrap">Payout pot</label><select id="zk-pot" style="width:auto;min-width:160px">${POTS.map((p) => `<option value="${p}" ${p === pot ? "selected" : ""}>$${p.toLocaleString("en-US")}</option>`).join("")}</select>${receipts ? `<button class="btn primary sm" data-zk="download">Download shareholder receipts (.json)</button>` : ""}</div>`
      + `<ol class="flow">` + rows().map((x) => `<li class="flow-row ${x.st}"><span class="flow-n">${x.st === "done" ? "✓" : x.n}</span><div class="flow-t"><b>${esc(x.title)}</b><span class="muted">${esc(x.help)}</span></div>${x.label ? `<button class="btn ${x.st === "current" ? "primary" : ""} sm" data-zk="${x.act}" ${x.off || busy ? "disabled" : ""}>${esc(x.label)}</button>` : `<span class="flow-ok">done</span>`}</li>`).join("") + `</ol>`
      + `<div class="flow-result">${receipts ? `<b>Receipts are in this tab only.</b> Download them now: without a receipt a holder cannot claim, and the contract cannot recover it. ${receipts.length} receipt(s), one per holder and class. ` : `<span class="muted">When the round is proved, the receipts appear here.</span>`}${r ? `<br/><span class="muted">Public on chain: the root, ${built ? BigInt(built.total).toLocaleString("en-US") : "the"} total shares, the raise and who paid it. Private: every holding, and who is behind each receipt.</span>` : ""}</div>`;
    host.querySelectorAll<HTMLButtonElement>("button[data-zk]").forEach((b) => (b.onclick = () => void act(b.dataset.zk!)));
    const sel = host.querySelector<HTMLSelectElement>("#zk-pot"); if (sel) sel.onchange = () => { pot = +sel.value; draw(); };
  }

  async function run(what: string, receiver: string, acts: Act[], after?: () => void, settle = 2500) {
    busy = true; draw();
    try { toast(`Waiting for your wallet to approve: ${esc(what)} …`); const x = await send(receiver, acts); if (x.hash) { toast(`<span class="pass">DONE</span> ${esc(what)}: ${txLink(d.explorer, x.hash)}`, "ok"); after?.(); await new Promise((res) => setTimeout(res, settle)); } }
    catch (e) { toast(`<span class="fail">FAIL</span> ${esc(what)}: ${esc((e as Error).message)}`, "fail"); }
    busy = false; await refresh();
  }

  async function act(a: string) {
    const me = account();
    if (a === "connect") { document.getElementById("wallet-btn")?.click(); return; }
    if (a === "download" && receipts) { download("rounds-receipts.json", receipts); return; }
    if (a === "toclaim") { document.getElementById("zk-claim")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (!me || !v) return;
    const r = myRound(), ex = myExit();
    if (a === "faucet") await run("register and get $10,000,000 test USDC", d.token, [{ method: "storage_deposit", args: { account_id: me } }, { method: "faucet", args: { account_id: me, amount: (10_000_000n * M).toString() } }]);
    else if (a === "officer") { busy = true; draw(); await boardAct(d.explorer, d.board, "set_officer", { account: me, enabled: true }, `make ${me} an officer`, () => store.set(key("officer"), true)); await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh(); }
    else if (a === "propose") {
      const m = d.model(me); if (!m) { toast(`<span class="fail">FAIL</span> the modeled round has no valid solution`, "fail"); return; }
      busy = true; draw();
      try {
        await nodeGlobals(); const zk = await import("../../src/engine/zk");
        status = "Building the Poseidon tree …"; draw();
        const b = await zk.generateShareholderReceipts(m.entries, { classes: m.classes }); receipts = b.receipts; built = { rootDec: b.root.toString(), total: b.totalShares };
        const next: number = await call(d.rpc, d.contract, "next_round_id", {});
        status = "Proving in your browser (this can take a little while the first time) …"; draw();
        const t0 = performance.now();
        const p = await zk.proveCapTableCommit(b.witness, { merkleRoot: b.root, totalShares: b.totalShares, roundId: BigInt(next) }, FILES.commit);
        status = `Proved in ${((performance.now() - t0) / 1000).toFixed(1)} s. Sending the root and the proof …`; draw();
        store.set(key("pending"), { root: b.root.toString(), next });
        const args = { merkle_root: b.root.toString(), total_shares: b.totalShares.toString(), raise: [[me, m.raiseMicro.toString()]], deadline_ns: (Math.floor(Date.now() / 1000) + 7 * 86_400) * 1e9, proof: p.contractProof }; // whole seconds in ns: exact as a JSON number (a u64 argument)
        toast("Waiting for your wallet to approve: propose the confidential round …");
        const x = await send(d.contract, [{ method: "propose_confidential_round", args, gasTgas: 300 }]);
        if (x.hash) { toast(`<span class="pass">DONE</span> confidential round proposed: ${txLink(d.explorer, x.hash)}. Download your receipts now.`, "ok"); store.set(key("officer"), true); await new Promise((res) => setTimeout(res, 2500)); }
      } catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); status = ""; }
      busy = false; await refresh();
    } else if (a === "fund" && r) { const amt = BigInt(r.raise[0][1]) - BigInt(r.deposits[0]?.[1] ?? "0"); await run(`deposit ${usd(amt)} into round ${r.id}`, d.token, [{ method: "ft_transfer_call", args: { receiver_id: d.contract, amount: amt.toString(), msg: JSON.stringify({ action: "round", id: r.id }) }, gasTgas: 200, depositYocto: "1" }]); }
    else if (a === "approve" && r) { busy = true; draw(); await boardAct(d.explorer, d.board, "approve_round", { round_id: r.id, plan_hash: r.plan_hash }, `approve round ${r.id} by its plan hash`, () => {}); await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh(); }
    else if (a === "close" && r) await run(`close round ${r.id}`, d.contract, [{ method: "close_round", args: { round_id: r.id }, gasTgas: 150 }]);
    else if (a === "pexit" && r) { store.set(key("pexpend"), { next: Math.max(0, ...pexits.map((e) => e.id)) + 1, round: r.id }); await run("open a private payout", d.contract, [{ method: "propose_private_exit", args: { round_id: r.id, pot: (BigInt(pot) * M).toString() }, gasTgas: 100 }]); }
    else if (a === "pfund" && ex) await run(`pay ${usd(BigInt(ex.pot))} into private payout ${ex.id}`, d.token, [{ method: "ft_transfer_call", args: { receiver_id: d.contract, amount: (BigInt(ex.pot) - BigInt(ex.funded)).toString(), msg: JSON.stringify({ action: "pexit", id: ex.id }) }, gasTgas: 200, depositYocto: "1" }]);
    else if (a === "papprove" && ex) { busy = true; draw(); await boardAct(d.explorer, d.board, "approve_private_exit", { exit_id: ex.id }, `approve private payout ${ex.id}`, () => {}); await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh(); }
  }

  draw(); onAccount(() => void refresh()); void refresh();
  (window as any).__zkReceipts = () => receipts; // dev/test hook: lets scripts/e2e-zk.mjs hand the receipts to the claim panel
}

/** The Private Claim panel: any holder with a receipt, any fresh recipient account, a proof made locally. */
export function mountPrivateClaim(host: HTMLElement, d: ZkDeps) {
  let receipt: Receipt | null = null, exits: any[] = [], busy = false, status = "", exitId = 0;
  const roots = new Map<number, string>(); // round id -> the committed root, to match a receipt to the payouts of its own cap table
  async function load() {
    exits = []; for (let i = 1; i <= 30; i++) { try { const e = await call(d.rpc, d.contract, "private_exit", { exit_id: i }); if (!e) break; exits.push(e); } catch { break; } }
    for (const e of exits) if (!roots.has(e.round_id)) { try { const c = await call(d.rpc, d.contract, "confidential_root", { round_id: e.round_id }); if (c) roots.set(e.round_id, c[0]); } catch { /* not committed yet */ } }
    // a receipt belongs to one cap table: select the newest payout of that table, else the newest payout
    const own = receipt ? [...exits].reverse().find((x) => roots.get(x.round_id) === receipt!.merkleRoot) : undefined;
    exitId = own?.id ?? (exits.some((x) => x.id === exitId) ? exitId : exits[exits.length - 1]?.id ?? 0);
    draw();
  }
  function draw() {
    const e = exits.find((x) => x.id === exitId), mismatch = !!(receipt && e && roots.get(e.round_id) !== receipt.merkleRoot), mine = receipt && e && BigInt(receipt.totalShares) === BigInt(e.total_shares) ? (BigInt(receipt.shareAmount) * BigInt(e.pot)) / BigInt(e.total_shares) : null;
    host.innerHTML = `<p class="note">A holder proves, without saying which leaf is theirs, that they are in the committed cap table and are owed exactly their pro-rata share; the contract pays any account named in the proof. <b>The amount paid is public</b> (it follows from the pot and the total shares), so this hides who is behind a payout, not how much was paid. Submit the claim from an account that is not linked to you (the account that signs it is visible), and register the recipient with the token first.</p>
      <label for="zk-file">Your receipt (.json)</label><input type="file" id="zk-file" accept=".json,application/json"/>
      <label for="zk-exit">Private payout</label><select id="zk-exit" style="width:auto;min-width:240px">${exits.map((x) => `<option value="${x.id}" ${x.id === exitId ? "selected" : ""}>Payout ${x.id}: pot ${esc(usd(BigInt(x.pot)))}${x.approved ? "" : " (not approved yet)"}</option>`).join("") || `<option value="">no private payouts yet</option>`}</select>
      <label for="zk-recipient">Receiving account (any fresh testnet account, registered with the test token)</label><input type="text" id="zk-recipient" placeholder="fresh-account.testnet" autocomplete="off" spellcheck="false"/>
      <p class="muted" style="margin:8px 0">${receipt ? `Receipt loaded: ${esc(receipt.holderId)} · ${esc(receipt.shareClass)}${mine !== null && !mismatch ? ` · you would receive ${esc(usd(mine))}` : ""}.` : "No receipt loaded."} ${mismatch ? `<span class="fail">This receipt belongs to a different cap table than the selected payout.</span>` : ""} ${esc(status)}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary sm" id="zk-claim-btn" ${busy || !receipt || !e || !e.approved || mismatch ? "disabled" : ""}>Prove and claim privately</button><button class="btn sm" id="zk-reg-btn" ${busy ? "disabled" : ""}>Register the recipient with the test token (links my wallet to it)</button></div>`;
    (host.querySelector("#zk-file") as HTMLInputElement).onchange = async (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return; try { receipt = JSON.parse(await f.text()); status = ""; } catch { receipt = null; status = "That file is not a receipt."; } await load(); };
    (host.querySelector("#zk-exit") as HTMLSelectElement).onchange = (ev) => { exitId = +(ev.target as HTMLSelectElement).value; draw(); };
    (host.querySelector("#zk-reg-btn") as HTMLButtonElement).onclick = async () => { const rec = (host.querySelector("#zk-recipient") as HTMLInputElement).value.trim().toLowerCase(); if (!rec) return; try { await send(d.token, [{ method: "storage_deposit", args: { account_id: rec } }]); toast(`<span class="pass">DONE</span> registered ${esc(rec)}`, "ok"); } catch (err) { toast(`<span class="fail">FAIL</span> ${esc((err as Error).message)}`, "fail"); } };
    (host.querySelector("#zk-claim-btn") as HTMLButtonElement).onclick = () => void claim((host.querySelector("#zk-recipient") as HTMLInputElement).value.trim().toLowerCase());
  }
  async function claim(recipient: string) {
    const e = exits.find((x) => x.id === exitId); if (!receipt || !e) return;
    if (!/^[a-z0-9._-]{2,64}$/.test(recipient)) { toast(`<span class="fail">FAIL</span> enter the receiving account id`, "fail"); return; }
    busy = true; status = "Proving in your browser …"; draw();
    try {
      await nodeGlobals(); const zk = await import("../../src/engine/zk");
      const t0 = performance.now();
      const p = await zk.provePrivateClaim(receipt, { exitId: BigInt(e.id), totalShares: BigInt(e.total_shares), totalPot: BigInt(e.pot) }, recipient, FILES.claim);
      status = `Proved in ${((performance.now() - t0) / 1000).toFixed(1)} s. Sending …`; draw();
      toast("Waiting for your wallet to approve: claim the private payout …");
      const x = await send(d.contract, [{ method: "claim_private_payout", args: { exit_id: e.id, nullifier: p.nullifier.toString(), payout_amount: p.payoutAmount.toString(), recipient_id: recipient, proof: p.contractProof }, gasTgas: 300 }]);
      if (x.hash) toast(`<span class="pass">DONE</span> ${esc(usd(p.payoutAmount))} claimed to ${esc(recipient)}: ${txLink(d.explorer, x.hash)}`, "ok");
      status = "Claimed.";
    } catch (err) { toast(`<span class="fail">FAIL</span> ${esc((err as Error).message)}`, "fail"); status = ""; }
    busy = false; await load();
  }
  draw(); void load(); onAccount(() => void load());
}
