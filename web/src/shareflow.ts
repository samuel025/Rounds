// "Share a pot on testnet": a guided run of the shared payout (RULES.md R10) on the open sandbox. You act as the treasury: pay a pot into
// escrow, approve its plan hash on the open board, and the contract pays every shareholder once. It uses the contract's exit machinery,
// so it needs no contract change and does not use up the sandbox (any number of visitors can run it; each run is its own exit).
// The plan is worked out from the chain's cap table, so the exit that comes back is found by its plan hash, not by a return value.
import { hint } from "./hints";
import { account, onAccount, send, type Act } from "./wallet";
import { call, esc, loadChain, type ChainView } from "./chain";
import { toast, txLink, boardAct } from "./actions";
import { usdExact as usd } from "./format";
import { DISTRIBUTE_GAS, MAX_DISTRIBUTE } from "./limits";
import { proRataDistribution, holderTotals, distributionPlan, canonicalJson, planHash, type Distribution } from "../../src/engine/index";

export interface ShareDeps { rpc: string; explorer: string; contract: string; board: string; token: string }
const M = 1_000_000n, POTS = [1_000, 10_000, 100_000, 1_000_000];
type St = "done" | "current" | "wait";
interface Row { n: number; title: string; help: string; st: St; label?: string; act?: string; off?: boolean; hintKey?: string }
interface Plan { d: Distribution; shares: Record<string, bigint>; canon: string; hash: string }

const store = {
  get(k: string): any { try { const s = sessionStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: the flow still works within one page load */ } },
};

export function mountShareFlow(host: HTMLElement, d: ShareDeps) {
  let v: ChainView | null = null, bal = 0n, acct: string | null = null, busy = false, readError = "", pot = 100_000, cur: Plan | null = null, planError = "";
  const key = (what: string) => `share:${d.contract}:${acct ?? "-"}:${what}`;
  const officerDone = () => !!store.get(key("officer"));
  const exitOf = () => { const id = store.get(key("exit")); return v && id ? (v.exits.find((e) => e.id === id) as any) ?? null : null; };

  async function computePlan() {
    cur = null; planError = "";
    if (!v) return;
    try {
      const shares = holderTotals(Object.fromEntries(v.holdings.map(([h, c, s]) => [`${h}|${c}`, BigInt(s)])));
      const dist = proRataDistribution(shares, BigInt(pot) * M); const canon = canonicalJson(distributionPlan(dist));
      cur = { d: dist, shares, canon, hash: await planHash(canon) };
    } catch (e) { planError = (e as Error).message; }
  }
  async function refresh() {
    try { v = await loadChain(d.rpc, d.contract); readError = ""; } catch (e) { readError = (e as Error).message; }
    acct = account();
    if (acct && v) { try { bal = BigInt(await call(d.rpc, d.token, "ft_balance_of", { account_id: acct })); } catch { /* keep the old balance */ } }
    if (v && acct) { // a proposal sent before a wallet redirect: find its exit by the plan hash it carries
      const pend = store.get(key("pending"));
      if (pend) { const e = v.exits.find((x) => x.id > pend.n0 && x.plan_hash === pend.hash); if (e) { store.set(key("exit"), e.id); store.set(key("pending"), null); store.set(key("officer"), true); } }
    }
    await computePlan(); draw();
  }

  function rows(): Row[] {
    const ex = exitOf(), want = BigInt(pot) * M;
    const total = ex ? BigInt(ex.total) : cur?.d.paidMicro ?? 0n;
    const s1 = !!acct, s5 = !!ex && BigInt(ex.funded) === BigInt(ex.total), s2 = s1 && (bal >= total || s5), s3 = s1 && (officerDone() || !!ex), s4 = !!ex;
    const s6 = !!ex && ex.approved, s7 = !!ex && (ex.payouts as any[]).every((p) => p.state === "Paid");
    const curStep = [s1, s2, s3, s4, s5, s6, s7].findIndex((x) => !x) + 1 || 8;
    const st = (n: number, done: boolean): St => (done ? "done" : n === curStep ? "current" : "wait");
    void want;
    return [
      { n: 1, title: "Connect a testnet wallet", hintKey: "wallet", help: s1 ? `Connected as ${acct}.` : "MyNearWallet or Meteor. The app never holds a key; each step opens your wallet to approve.", st: st(1, s1), label: s1 ? undefined : "Connect wallet", act: "connect" },
      { n: 2, title: "Get test USDC to be the treasury", help: `A no-value token from the contract's public faucet. Your balance: ${usd(bal)}; the pot you pay in is ${usd(total)}.`, st: st(2, s2), label: "Get test USDC", act: "faucet", off: !s1 },
      { n: 3, title: "Make yourself an officer", hintKey: "officer", help: "Only officers can propose a payout. The open sandbox board grants it to anyone; a real DAO's board decides.", st: st(3, s3), label: "Make me an officer", act: "officer", off: !s1 },
      { n: 4, title: "Propose the payout", hintKey: "planHash", help: ex ? `Exit ${ex.id} is on chain with plan hash ${String(ex.plan_hash).slice(0, 16)}…` : cur ? `Sends the plan below (${cur.d.payouts.length} payouts worked out from this contract's cap table) and its SHA-256 hash.` : "Waiting for the cap table.", st: st(4, s4), label: "Propose payout", act: "propose", off: !s3 || !cur || cur.d.payouts.length === 0 },
      { n: 5, title: "Fund it from your treasury", hintKey: "escrow", help: ex ? `You pay ${usd(BigInt(ex.total))} into the contract's escrow. Nobody is paid until the board approves.` : "The pot sits in escrow until the board approves its hash.", st: st(5, s5), label: "Fund", act: "fund", off: !ex || s5 },
      { n: 6, title: "Board approves the plan", hintKey: "board", help: "The board approves this exact plan hash; a changed plan would not match. On the open sandbox you act as the board.", st: st(6, s6), label: "Approve as the board", act: "approve", off: !ex || !s5 || s6 },
      { n: 7, title: "Pay every holder", help: `Anyone may run it. The contract pays each holder once; up to ${MAX_DISTRIBUTE} payouts per transaction.`, st: st(7, s7), label: "Pay out", act: "pay", off: !ex || !s6 || s7 },
    ];
  }

  function draw() {
    const ex = exitOf(), rs = rows(), done = !!ex && (ex.payouts as any[]).every((p) => p.state === "Paid");
    const banner = readError ? `<div class="flow-banner fail">Could not read the sandbox: ${esc(readError)}</div>` : planError ? `<div class="flow-banner fail">Nothing to share yet: ${esc(planError)}.</div>`
      : `<div class="flow-banner muted">Sandbox <span class="mono">${esc(d.contract)}</span> · ${v ? `${v.exits.length} payout(s) on chain` : "Reading the sandbox…"}${busy ? " · working…" : ""}</div>`;
    const lines: { holder: string; shares: bigint; amount: bigint; state: string }[] = ex
      ? (ex.payouts as any[]).map((p) => ({ holder: p.holder, shares: cur?.shares[p.holder] ?? 0n, amount: BigInt(p.amount), state: String(p.state) }))
      : (cur?.d.payouts ?? []).map(([h, a]) => ({ holder: h, shares: cur!.shares[h], amount: a, state: "not proposed" }));
    host.innerHTML = banner
      + `<div style="display:flex;gap:10px;align-items:center;margin:4px 0 12px"><label for="share-pot" style="margin:0;white-space:nowrap">Pot to share</label><select id="share-pot" style="width:auto;min-width:180px" ${ex && !done ? "disabled" : ""}>${POTS.map((p) => `<option value="${p}" ${p === pot ? "selected" : ""}>$${p.toLocaleString("en-US")}</option>`).join("")}</select>${done ? `<button class="btn sm" data-share="again">Start another payout</button>` : ""}</div>`
      + `<ol class="flow">` + rs.map((r) => `<li class="flow-row ${r.st}"><span class="flow-n">${r.st === "done" ? "✓" : r.n}</span><div class="flow-t"><b>${esc(r.title)}</b>${r.hintKey ? hint(r.hintKey, r.title) : ""}<span class="muted">${esc(r.help)}</span></div>${r.label ? `<button class="btn ${r.st === "current" ? "primary" : ""} sm" data-share="${r.act}" ${r.off || busy ? "disabled" : ""}>${esc(r.label)}</button>` : `<span class="flow-ok">done</span>`}</li>`).join("") + `</ol>`
      + `<div class="flow-result"><table><tr><th>Holder</th><th class="n">Shares</th><th class="n">Payout</th><th>State</th></tr>${lines.map((l) => `<tr><td class="mono">${esc(l.holder)}</td><td class="n">${l.shares.toLocaleString("en-US")}</td><td class="n">${esc(usd(l.amount))}</td><td>${esc(l.state)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">no shareholders yet</td></tr>`}</table>${cur ? `<p class="muted" style="margin:8px 0 0">Plan hash <span class="mono">${esc((ex ? String(ex.plan_hash) : cur.hash).slice(0, 24))}…</span> · the unissued option pool receives nothing · remainder ${esc(usd(cur.d.remainderMicro))} stays with you.${done ? " <b>Done: every holder was paid once.</b>" : ""}</p>` : ""}</div>`;
    host.querySelectorAll<HTMLButtonElement>("button[data-share]").forEach((b) => (b.onclick = () => void act(b.dataset.share!)));
    const sel = host.querySelector<HTMLSelectElement>("#share-pot"); if (sel) sel.onchange = () => { pot = +sel.value; void computePlan().then(draw); };
  }

  async function run(what: string, receiver: string, acts: Act[], after?: () => void, settle = 2500) {
    busy = true; draw();
    try {
      toast(`Waiting for your wallet to approve: ${esc(what)} …`);
      const r = await send(receiver, acts);
      if (r.hash) { toast(`<span class="pass">DONE</span> ${esc(what)}: ${txLink(d.explorer, r.hash)}`, "ok"); after?.(); await new Promise((res) => setTimeout(res, settle)); }
    } catch (e) { toast(`<span class="fail">FAIL</span> ${esc(what)}: ${esc((e as Error).message)}`, "fail"); }
    busy = false; await refresh();
  }

  async function act(a: string) {
    const me = account(); if (a === "connect") { document.getElementById("wallet-btn")?.click(); return; }
    if (a === "again") { store.set(key("exit"), null); await refresh(); return; }
    if (!me || !v) return; const ex = exitOf();
    if (a === "faucet") await run("register and get $10,000,000 test USDC", d.token, [{ method: "storage_deposit", args: { account_id: me } }, { method: "faucet", args: { account_id: me, amount: (10_000_000n * M).toString() } }]);
    else if (a === "officer") { busy = true; draw(); await boardAct(d.explorer, d.board, "set_officer", { account: me, enabled: true }, `make ${me} an officer`, () => store.set(key("officer"), true)); await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh(); }
    else if (a === "propose") {
      await refresh(); // the cap table may have changed since the card was drawn (for example a Series A just closed): propose what is on chain now
      if (!cur) return;
      store.set(key("pending"), { n0: Math.max(0, ...v.exits.map((e) => e.id)), hash: cur.hash });
      await run("propose the shared payout", d.contract, [{ method: "propose_exit", args: { plan_hash: cur.hash, plan_uri: "app://shared-payout", plan: cur.canon }, gasTgas: 100 }], () => store.set(key("officer"), true));
    } else if (a === "fund" && ex) {
      const amt = BigInt(ex.total) - BigInt(ex.funded);
      await run(`pay ${usd(amt)} into exit ${ex.id}`, d.token, [{ method: "ft_transfer_call", args: { receiver_id: d.contract, amount: amt.toString(), msg: JSON.stringify({ action: "exit", id: ex.id }) }, gasTgas: 200, depositYocto: "1" }]);
    } else if (a === "approve" && ex) {
      busy = true; draw(); await boardAct(d.explorer, d.board, "approve_exit", { exit_id: ex.id, plan_hash: ex.plan_hash }, `approve exit ${ex.id} by its plan hash`, () => {}); await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh();
    } else if (a === "pay" && ex) {
      const ps = ex.payouts as any[], from = Math.max(0, ps.findIndex((p) => p.state !== "Paid")), limit = Math.min(MAX_DISTRIBUTE, ps.length - from);
      await run(`pay out exit ${ex.id}`, d.contract, [{ method: "distribute", args: { exit_id: ex.id, from, limit }, gasTgas: DISTRIBUTE_GAS }], undefined, 7000);
    }
  }

  draw(); onAccount(() => void refresh()); void refresh();
}
