// "Run a round on testnet": one guided path on the open sandbox, from wallet to closed round.
// The eight steps are always on screen in the same layout; only each step's state (done / current / waiting) and button change,
// so refreshing chain data never makes the page grow or shrink.
import { account, onAccount, send, type Act } from "./wallet";
import { call, esc, loadChain, type ChainView } from "./chain";
import { toast, txLink, boardAct } from "./actions";
import { usdExact as usd } from "./format";

export interface FlowDeps {
  rpc: string; explorer: string; contract: string; board: string; token: string;
  modelSummary: () => string; raiseMicro: () => bigint;
  propose: (contract: string) => Promise<{ hash: string | null; value: unknown }>;
  showResult: () => void;
  onChain?: (v: ChainView) => void;
}
const M = 1_000_000n;

type St = "done" | "current" | "wait";
interface Row { n: number; title: string; help: string; st: St; label?: string; act?: string; off?: boolean; note?: string }

export function mountFlow(host: HTMLElement, d: FlowDeps) {
  let v: ChainView | null = null, bal = 0n, acct: string | null = null, officerDone = false, busy = false, readError = "";

  const myRound = () => (v && acct ? [...v.rounds].reverse().find((r) => r.raise.some(([w]) => w === acct)) ?? null : null);
  const foreignDone = () => (v ? v.rounds.find((r) => r.kind === "Priced" && r.status === "Closed" && !r.raise.some(([w]) => w === acct)) ?? null : null);

  async function refresh() {
    try { v = await loadChain(d.rpc, d.contract); readError = ""; d.onChain?.(v); } catch (e) { readError = (e as Error).message; }
    acct = account();
    if (acct && v) { try { bal = BigInt(await call(d.rpc, d.token, "ft_balance_of", { account_id: acct })); } catch { /* keep old */ } }
    draw();
  }

  function rows(): Row[] {
    const mr = myRound(), want = d.raiseMicro();
    const funded = !!mr && mr.raise.every(([, a], k) => BigInt(mr.deposits[k]?.[1] ?? "0") === BigInt(a));
    const status = mr?.status ?? "";
    const isOfficer = officerDone || !!mr;
    const s1 = !!acct, s2 = s1 && bal >= want, s3 = s1 && isOfficer, s5 = !!mr;
    const s6 = funded, s7 = !!mr && status !== "Funding", s8 = status === "Closed";
    const cur = [s1, s2, s3, true, s5, s6, s7, s8].findIndex((x) => !x) + 1 || 9;
    const st = (n: number, done: boolean): St => (done ? "done" : n === cur ? "current" : "wait");
    return [
      { n: 1, title: "Connect a testnet wallet", help: s1 ? `Connected as ${acct}.` : "MyNearWallet or Meteor. The app never holds a key; each step below opens your wallet to approve.", st: st(1, s1), label: s1 ? undefined : "Connect wallet", act: "connect" },
      { n: 2, title: "Get test USDC", help: `A no-value token from the contract's public faucet. Your balance: ${usd(bal)}; this round needs ${usd(want)}.`, st: st(2, s2), label: "Get test USDC", act: "faucet", off: !s1 },
      { n: 3, title: "Make yourself an officer", help: "Only officers can propose rounds. The open sandbox board grants it to anyone; the real demo's board is a 2-of-3 DAO.", st: st(3, s3), label: "Make me an officer", act: "officer", off: !s1 },
      { n: 4, title: "Set the round", help: d.modelSummary(), st: s3 || mr ? "done" : "wait", label: "Edit in the modeler", act: "model" },
      { n: 5, title: "Propose it on chain", help: mr ? `Round ${mr.id} is on chain with plan hash ${mr.plan_hash.slice(0, 16)}…` : "Sends your modeled plan and its SHA-256 hash to the contract, with you as the investor.", st: st(5, s5), label: "Propose on chain", act: "propose", off: !s3 || !!foreignDone() },
      { n: 6, title: "Fund it", help: mr ? `Your wallet sends ${usd(BigInt(mr.raise[0]?.[1] ?? "0"))} into escrow; it is refunded if the round is cancelled.` : "Your money sits in escrow until the round closes.", st: st(6, s6), label: "Deposit", act: "deposit", off: !mr || status !== "Funding" || funded },
      { n: 7, title: "Board approves the plan", help: "The board approves this exact plan hash; a changed plan would not match. On the open sandbox you act as the board.", st: st(7, s7), label: "Approve as the board", act: "approve", off: !mr || status !== "Funding" },
      { n: 8, title: "Close the round", help: "Anyone can close an approved, funded round. The contract then issues the shares.", st: st(8, s8), label: "Close round", act: "close", off: !(status === "Approved" && funded) },
    ];
  }

  function draw() {
    const fr = foreignDone();
    const mr = myRound();
    const banner = readError ? `<div class="flow-banner fail">Could not read the sandbox: ${esc(readError)}</div>`
      : fr && !mr ? `<div class="flow-banner">Someone already ran the Series A on this sandbox (round ${fr.id} is closed), so a second one cannot convert the SAFEs again. You can read the result below; <span class="mono">make sandbox</span> deploys a fresh sandbox.</div>`
      : `<div class="flow-banner muted">${v ? `Sandbox <span class="mono">${esc(d.contract)}</span> · ${v.rounds.length} rounds on chain` : "Reading the sandbox…"}${busy ? " · working…" : ""}</div>`;
    const done = mr?.status === "Closed";
    const held = done && v ? v.holdings.filter(([h]) => h === acct).map(([, c, s]) => `${BigInt(s).toLocaleString("en-US")} ${esc(c)}`).join(", ") : "";
    host.innerHTML = banner + `<ol class="flow">` + rows().map((r) => `<li class="flow-row ${r.st}"><span class="flow-n">${r.st === "done" ? "✓" : r.n}</span><div class="flow-t"><b>${esc(r.title)}</b><span class="muted">${r.n === 4 ? esc(r.help) : esc(r.help)}</span></div>${r.label ? `<button class="btn ${r.st === "current" ? "primary" : ""} sm" data-flow="${r.act}" ${r.off || busy ? "disabled" : ""}>${esc(r.label)}</button>` : `<span class="flow-ok">done</span>`}</li>`).join("") + `</ol>`
      + `<div class="flow-result">${done ? `<b>Done.</b> You now hold ${held || "your shares"}. <button class="btn primary sm" data-flow="result">See the cap table and re-check the hashes</button>` : `<span class="muted">When step 8 is done, your shares appear here.</span>`}</div>`;
    host.querySelectorAll<HTMLButtonElement>("button[data-flow]").forEach((b) => (b.onclick = () => void act(b.dataset.flow!)));
  }

  async function run(what: string, receiver: string, acts: Act[], after?: () => void) {
    busy = true; draw();
    try {
      toast(`Waiting for your wallet to approve: ${esc(what)} …`);
      const r = await send(receiver, acts);
      if (r.hash) { toast(`<span class="pass">DONE</span> ${esc(what)}: ${txLink(d.explorer, r.hash)}`, "ok"); after?.(); await new Promise((res) => setTimeout(res, 2500)); }
    } catch (e) { toast(`<span class="fail">FAIL</span> ${esc(what)}: ${esc((e as Error).message)}`, "fail"); }
    busy = false; await refresh();
  }

  async function act(a: string) {
    const me = account();
    if (a === "connect") { document.getElementById("wallet-btn")?.click(); return; }
    if (a === "model") { document.getElementById("model")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (a === "result") { d.showResult(); return; }
    if (!me || !v) return;
    const mr = myRound();
    if (a === "faucet") await run("register and get $10,000,000 test USDC", d.token, [{ method: "storage_deposit", args: { account_id: me } }, { method: "faucet", args: { account_id: me, amount: (10_000_000n * M).toString() } }]);
    else if (a === "officer") {
      busy = true; draw();
      await boardAct(d.explorer, d.board, "set_officer", { account: me, enabled: true }, `make ${me} an officer`, () => { officerDone = true; });
      await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh();
    } else if (a === "propose") {
      busy = true; draw();
      try { toast("Waiting for your wallet to approve: propose the round …"); const r = await d.propose(d.contract); if (r.hash) { toast(`<span class="pass">DONE</span> round proposed: ${txLink(d.explorer, r.hash)}`, "ok"); await new Promise((res) => setTimeout(res, 2500)); } }
      catch (e) { const m = (e as Error).message; toast(`<span class="fail">FAIL</span> ${esc(m)}${/officer/i.test(m) ? ". Do step 3 first." : ""}`, "fail"); }
      busy = false; await refresh();
    } else if (a === "deposit" && mr) {
      const amt = BigInt(mr.raise[0][1]) - BigInt(mr.deposits[0]?.[1] ?? "0");
      await run(`deposit ${usd(amt)} into round ${mr.id}`, d.token, [{ method: "ft_transfer_call", args: { receiver_id: d.contract, amount: amt.toString(), msg: JSON.stringify({ action: "round", id: mr.id }) }, gasTgas: 200, depositYocto: "1" }]);
    } else if (a === "approve" && mr) {
      busy = true; draw();
      await boardAct(d.explorer, d.board, "approve_round", { round_id: mr.id, plan_hash: mr.plan_hash }, `approve round ${mr.id} by its plan hash`, () => {});
      await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh();
    } else if (a === "close" && mr) await run(`close round ${mr.id}`, d.contract, [{ method: "close_round", args: { round_id: mr.id }, gasTgas: 150 }]);
  }

  draw();
  window.addEventListener("rounds:model", () => { if (!busy) draw(); });
  onAccount(() => void refresh());
  void refresh();
}
