// "Your actions": what the connected wallet can do on the loaded Rounds contract. Every button is a real wallet-signed
// testnet transaction; buttons that this account cannot use are explained, not hidden.
import { account, onAccount, send, connect, disconnect, initWallet, readReturn, type Act } from "./wallet";
import { call, esc, type ChainView } from "./chain";
import { usdExact as usd } from "./format";
import { DISTRIBUTE_GAS, MAX_DISTRIBUTE } from "./limits";

const M = 1_000_000n;

export function toast(html: string, kind: "ok" | "fail" | "info" = "info") {
  let t = document.getElementById("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.className = `toast ${kind}`; t.innerHTML = `${html} <button class="x" aria-label="Dismiss">×</button>`; t.style.display = "block";
  t.querySelector("button")!.onclick = () => { t!.style.display = "none"; };
}
export const txLink = (explorer: string, hash: string) => `<a class="mono" href="${esc(explorer)}/txns/${esc(hash)}" target="_blank" rel="noopener">${esc(hash.slice(0, 10))}… ↗</a>`;

/** Nav button + the return trip from a browser wallet. */
export function initWalletUi(explorer: string) {
  const btn = document.getElementById("wallet-btn") as HTMLButtonElement;
  onAccount((a) => { btn.textContent = a ? `${a.length > 22 ? a.slice(0, 20) + "…" : a} ✕` : "Connect wallet"; btn.title = a ? "Connected. Click to disconnect." : "Connect a NEAR testnet wallet"; btn.classList.toggle("on", !!a); });
  btn.onclick = async () => { try { if (account()) await disconnect(); else await connect(); } catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); } };
  let remembered = false; try { remembered = !!localStorage.getItem("near-wallet-selector:selectedWalletId"); } catch { /* storage blocked */ }
  if (remembered || (import.meta.env.DEV && (window as any).__testWallet)) void initWallet().catch(() => {});
  const back = readReturn();
  if (back?.hash) toast(`<span class="pass">SENT</span> transaction ${txLink(explorer, back.hash)} was signed in your wallet.`, "ok");
  else if (back?.error) toast(`<span class="fail">FAIL</span> the wallet reported: ${esc(back.error)}`, "fail");
}

async function run(explorer: string, receiver: string, acts: Act[], what: string, after: () => void) {
  try {
    toast(`Waiting for your wallet to approve: ${esc(what)} …`);
    const r = await send(receiver, acts);
    if (r.hash) { toast(`<span class="pass">DONE</span> ${esc(what)}: ${txLink(explorer, r.hash)}`, "ok"); after(); }
  } catch (e) { toast(`<span class="fail">FAIL</span> ${esc(what)}: ${esc((e as Error).message)}`, "fail"); }
}

export async function renderActions(host: HTMLElement, v: ChainView, rpc: string, explorer: string, reload: () => void) {
  const render = async (acct: string | null) => {
    if (!acct) {
      host.innerHTML = `<div class="chain-h"><span class="mono muted">YOUR ACTIONS</span></div><p class="note">Connect a NEAR <b>testnet</b> wallet (MyNearWallet or Meteor) to sign transactions on <span class="mono">${esc(v.contract)}</span>. Nothing is signed in the background; each action opens your wallet for approval.</p><button class="btn primary sm" id="act-connect">Connect wallet</button>`;
      document.getElementById("act-connect")!.onclick = () => document.getElementById("wallet-btn")!.click();
      return;
    }
    const parts: string[] = [];
    let bal = 0n; try { bal = BigInt(await call(rpc, v.token, "ft_balance_of", { account_id: acct })); } catch { /* token view failed */ }
    parts.push(`<div class="act"><div><b>Test USDC</b><span class="muted"> · ${esc(v.token)}</span><br/><span class="muted">Your balance: ${esc(usd(bal))}. This token is a no-value testnet token with a public faucet.</span></div><button class="btn sm" data-a="faucet">Register and get test USDC</button></div>`);
    for (const r of v.rounds) {
      const i = r.raise.findIndex(([who]) => who === acct); if (i < 0) continue;
      const want = BigInt(r.raise[i][1]), got = BigInt(r.deposits[i]?.[1] ?? "0");
      if (r.status === "Funding" && got < want) parts.push(`<div class="act"><div><b>Round ${r.id}</b> expects ${esc(usd(want))} from you<br/><span class="muted">Paid so far ${esc(usd(got))}. The money sits in escrow until the board approves, and is refunded if the round is cancelled.${bal < want - got ? ` <span class="fail">Your balance is too low; get test USDC first.</span>` : ""}</span></div><button class="btn sm" data-a="deposit" data-r="${r.id}">Deposit ${esc(usd(want - got))}</button></div>`);
    }
    for (const r of v.rounds) {
      const funded = r.raise.every(([, a], k) => BigInt(r.deposits[k]?.[1] ?? "0") === BigInt(a));
      if (r.status === "Approved" && funded) parts.push(`<div class="act"><div><b>Round ${r.id}</b> is approved and funded<br/><span class="muted">Anyone may close it; the contract then credits the shares.</span></div><button class="btn sm" data-a="close" data-r="${r.id}">Close round ${r.id}</button></div>`);
    }
    for (const e of v.exits) {
      const idx = e.payouts.findIndex((p: any) => p.state !== "Paid");
      if (e.approved && !e.cancelled && BigInt(e.funded) === BigInt(e.total) && idx >= 0) parts.push(`<div class="act"><div><b>Exit ${e.id}</b> is approved and funded<br/><span class="muted">Anyone may run distribute; ${e.payouts.length - idx} payout(s) remain, up to ${MAX_DISTRIBUTE} per transaction.</span></div><button class="btn sm" data-a="dist" data-e="${e.id}" data-from="${idx}" data-n="${Math.min(MAX_DISTRIBUTE, e.payouts.length - idx)}">Pay out exit ${e.id}</button></div>`);
    }
    // the open sandbox board (a tiny contract: anyone may ask it to act as the board for this one Rounds contract)
    let openBoard = false; try { openBoard = (await call(rpc, v.board, "open_board", {})) === true; } catch { /* a real DAO has no such method */ }
    if (openBoard) {
      parts.push(`<div class="act"><div><b>Open sandbox board</b> <span class="muted">· ${esc(v.board)}</span><br/><span class="muted">Anyone may ask this board to act for the contract, so there is no vote. It only forwards a short list of board methods. Testnet, no value. To propose rounds you must be an officer, which the board can grant you.</span></div><button class="btn sm" data-a="officer">Make me an officer</button></div>`);
      for (const r of v.rounds) if (r.status === "Funding") parts.push(`<div class="act sub"><div><b>Round ${r.id}</b> is waiting for board approval<br/><span class="muted">plan hash ${esc(r.plan_hash.slice(0, 16))}… The board approves this exact hash.</span></div><button class="btn sm" data-a="approve" data-r="${r.id}">Approve round ${r.id} as the board</button></div>`);
    } else
    // board proposals
    try {
      const [policy, last] = await Promise.all([call(rpc, v.board, "get_policy", {}), call(rpc, v.board, "get_last_proposal_id", {})]);
      const council = (policy.roles ?? []).some((r: any) => r.kind === "Everyone" || (r.kind?.Group ?? []).includes(acct));
      const props: any[] = last > 0 ? await call(rpc, v.board, "get_proposals", { from_index: Math.max(0, last - 25), limit: 25 }) : [];
      const inProgress = props.filter((p) => p.status === "InProgress").reverse();
      parts.push(`<div class="act"><div><b>Board</b> <span class="muted">· ${esc(v.board)}</span><br/><span class="muted">${council ? "You can vote on this board." : "Your account is not on this board, so you can read proposals but not vote."} ${inProgress.length ? "" : "No open proposals."}</span></div></div>`);
      for (const p of inProgress) {
        const voted = p.votes && p.votes[acct];
        parts.push(`<div class="act sub"><div>#${esc(p.id)} <span class="muted">${esc(String(p.description).slice(0, 140))}</span><br/><span class="muted">approve ${esc(p.vote_counts ? Object.values(p.vote_counts).map((c: any) => c[0]).reduce((a: number, b: number) => a + b, 0) : 0)} · proposer ${esc(p.proposer)}</span></div><button class="btn sm" data-a="vote" data-p="${esc(p.id)}" ${council && !voted ? "" : "disabled"}>${voted ? "Already voted" : "Approve"}</button></div>`);
      }
    } catch { parts.push(`<div class="act"><div><b>Board</b><br/><span class="muted">Could not read the board's proposals (is ${esc(v.board)} a Sputnik DAO?).</span></div></div>`); }
    host.innerHTML = `<div class="chain-h"><span class="mono muted">YOUR ACTIONS · SIGNED AS <b>${esc(acct)}</b></span></div>${parts.join("")}`;
    host.querySelectorAll<HTMLButtonElement>("button[data-a]").forEach((b) => b.onclick = () => {
      const a = b.dataset.a!;
      if (a === "faucet") void run(explorer, v.token, [{ method: "storage_deposit", args: { account_id: acct } }, { method: "faucet", args: { account_id: acct, amount: (10_000_000n * M).toString() } }], "register and get $10,000,000 test USDC", reload);
      else if (a === "deposit") { const r = v.rounds.find((x) => String(x.id) === b.dataset.r)!; const i = r.raise.findIndex(([w]) => w === acct); const amt = BigInt(r.raise[i][1]) - BigInt(r.deposits[i]?.[1] ?? "0");
        void run(explorer, v.token, [{ method: "ft_transfer_call", args: { receiver_id: v.contract, amount: amt.toString(), msg: JSON.stringify({ action: "round", id: r.id }) }, gasTgas: 200, depositYocto: "1" }], `deposit ${usd(amt)} into round ${r.id}`, reload); }
      else if (a === "close") void run(explorer, v.contract, [{ method: "close_round", args: { round_id: Number(b.dataset.r) }, gasTgas: 150 }], `close round ${b.dataset.r}`, reload);
      else if (a === "dist") void run(explorer, v.contract, [{ method: "distribute", args: { exit_id: Number(b.dataset.e), from: Number(b.dataset.from), limit: Number(b.dataset.n) }, gasTgas: DISTRIBUTE_GAS }], `pay out exit ${b.dataset.e}`, reload);
      else if (a === "officer") void boardAct(explorer, v.board, "set_officer", { account: acct, enabled: true }, `make ${acct} an officer`, reload);
      else if (a === "approve") { const r = v.rounds.find((x) => String(x.id) === b.dataset.r)!; void boardAct(explorer, v.board, "approve_round", { round_id: r.id, plan_hash: r.plan_hash }, `approve round ${r.id} by its plan hash`, reload); }
      else if (a === "vote") void run(explorer, v.board, [{ method: "act_proposal", args: { id: Number(b.dataset.p), action: "VoteApprove" }, gasTgas: 200 }], `approve board proposal #${b.dataset.p}`, reload);
    });
  };
  onAccountOnce(render);
}

let unsub: (() => void) | null = null;
function onAccountOnce(f: (a: string | null) => void | Promise<void>) { unsub?.(); unsub = onAccount((a) => { void f(a); }); }

/** Ask the open board to call the Rounds contract. One call from the visitor's wallet; the Rounds contract sees the board as the caller. */
export async function boardAct(explorer: string, board: string, method: string, args: object, what: string, after: () => void) {
  try {
    toast(`Waiting for your wallet to approve: ${esc(what)} (asks the open board to act) …`);
    const r = await send(board, [{ method: "act", args: { method_name: method, args: JSON.stringify(args), gas_tgas: 60 }, gasTgas: 150 }]);
    if (r.hash) { toast(`<span class="pass">DONE</span> ${esc(what)}: ${txLink(explorer, r.hash)}`, "ok"); after(); }
  } catch (e) { toast(`<span class="fail">FAIL</span> ${esc(what)}: ${esc((e as Error).message)}`, "fail"); }
}
