// Confidential mode (ZK), opt-in. Three pieces:
//  - the flow card: build a private cap table from the modeled round, prove it in the browser, propose it, run a private payout;
//  - the Board check: re-seal the private table the proposer gave the board and compare it with the chain (or open the encrypted copy);
//  - the Private claim panel: a holder's own key + a claim file + any fresh account, optionally submitted through a relayer so the holder's wallet never signs.
// Honest limits: the paid AMOUNT of a claim is public, deposits are public, and a relayer operator sees the requester's network address. See the README.
import { account, onAccount, send, type Act } from "./wallet";
import { call, esc, loadChain, type ChainView } from "./chain";
import { toast, txLink, boardAct } from "./actions";
import { usdExact as usd } from "./format";
import type { CapEntry, ClaimFile, HolderKey, TableFile, EscrowFile } from "../../src/engine/zk";
import type { FreshAccount } from "../../src/engine/stealth";

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
const readJson = async (f: File) => JSON.parse(await f.text());
/** A file field that is one clear target (click or drop) instead of the browser's default control. `loaded` is the name to show once a file is chosen. */
const dropHtml = (id: string, loaded: string | null, hint: string) => `<div class="drop-field"><label class="drop ${loaded ? "has" : ""}" id="${id}-drop" for="${id}"><span class="drop-b">${loaded ? "Replace" : "Choose file"}</span><span class="drop-n">${esc(loaded ?? hint)}</span><input type="file" id="${id}" accept=".json,application/json"/></label></div>`;
function bindDrop(host: HTMLElement, id: string, onFile: (f: File) => void | Promise<void>) {
  const lab = host.querySelector<HTMLElement>(`#${id}-drop`), inp = host.querySelector<HTMLInputElement>(`#${id}`); if (!lab || !inp) return;
  inp.onchange = () => { const f = inp.files?.[0]; if (f) void onFile(f); };
  lab.ondragover = (e) => { e.preventDefault(); lab.classList.add("over"); };
  lab.ondragleave = () => lab.classList.remove("over");
  lab.ondrop = (e) => { e.preventDefault(); lab.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) void onFile(f); };
}
/** A relayer that submits claims so the holder's wallet never signs: ?relayer=<url>, or web/public/relayer.json {"url": ...}. */
async function relayerUrl(): Promise<string | null> {
  const q = new URLSearchParams(location.search).get("relayer"); if (q) return q;
  try { const r = await fetch("relayer.json"); if (r.ok) { const j = await r.json(); return typeof j.url === "string" ? j.url : null; } } catch { /* none */ }
  return null;
}

interface Built { claimFiles: ClaimFile[]; keys: HolderKey[]; tableFile: TableFile; escrow: EscrowFile | null; total: bigint }

/** The whole confidential workspace in one card with two tabs: 1 · the round (build, check, approve, close) and 2 · the payout (open, fund, approve, claim). */
export function mountZkFlow(host: HTMLElement, d: ZkDeps) {
  host.innerHTML = `<div class="ztabs"><button class="ztab on" data-ztab="round">1 · Create and approve the round</button><button class="ztab" data-ztab="payout">2 · Pay out and claim</button></div>
    <div class="zpanel" id="zk-p-round"><div id="zk-banner"></div><div id="zk-opts" class="zbar"></div><ol class="flow compact" id="zk-rows-round"></ol><div class="flow-result" id="zk-files"></div>
      <details class="zd" id="zk-bdetails"><summary>Board check: re-seal the private table before approving</summary><div id="zk-board-body"></div></details></div>
    <div class="zpanel" id="zk-p-payout" hidden><ol class="flow compact" id="zk-rows-payout"></ol>
      <details class="zd" id="zk-cdetails" open><summary>Claim a payout with a holder key</summary><div id="zk-claim-body"></div></details></div>`;
  const $z = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
  let v: ChainView | null = null, bal = 0n, acct: string | null = null, busy = false, status = "", readError = "", pot = 10_000, pass = "", optsKey = "";
  let built: Built | null = null, pexits: any[] = [], tab: "round" | "payout" = "round", lastWant: "round" | "payout" = "round";
  const key = (w: string) => `zk:${d.contract}:${acct ?? "-"}:${w}`;
  const myRound = () => { const id = store.get(key("round")); return v && id ? v.rounds.find((r) => r.id === id) ?? null : null; };
  const myExit = () => { const id = store.get(key("pexit")); return id ? pexits.find((e) => e.id === id) ?? null : null; };
  // A browser wallet takes you away from the page to approve and then back, which reloads it: keep the files in this tab's session storage so they survive
  // that round trip (demo mode: they include the demo holder keys). They are still only in this tab; download them.
  const persistBuilt = (b: Built) => store.set(key("built"), { ...b, total: b.total.toString() });
  const restoreBuilt = (): Built | null => { const x = store.get(key("built")); return x ? { ...x, total: BigInt(x.total) } : null; };
  const showTab = (t: "round" | "payout") => { tab = t; host.querySelectorAll<HTMLButtonElement>(".ztab").forEach((b) => b.classList.toggle("on", b.dataset.ztab === t)); $z("zk-p-round").hidden = t !== "round"; $z("zk-p-payout").hidden = t !== "payout"; };
  host.querySelectorAll<HTMLButtonElement>(".ztab").forEach((b) => (b.onclick = () => showTab(b.dataset.ztab as "round" | "payout")));

  async function refresh() {
    try { v = await loadChain(d.rpc, d.contract); readError = ""; } catch (e) { readError = (e as Error).message; }
    acct = account();
    if (!built && acct) { built = restoreBuilt(); if (built) (window as any).__zkBuilt = built; }
    if (acct && v) { try { bal = BigInt(await call(d.rpc, d.token, "ft_balance_of", { account_id: acct })); } catch { /* keep */ } }
    const list: any[] = []; for (let i = 1; i <= 30; i++) { try { const e = await call(d.rpc, d.contract, "private_exit", { exit_id: i }); if (!e) break; list.push(e); } catch { break; } } pexits = list;
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
    const s8 = !!ex, s9 = !!ex && BigInt(ex.funded) === BigInt(ex.pot), s10 = !!ex && ex.approved;
    const flags = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10], cur = flags.findIndex((x) => !x) + 1 || 11;
    const st = (n: number): St => (flags[n - 1] ? "done" : n === cur ? "current" : "wait");
    const plan = r ? (() => { try { return JSON.parse(r.plan); } catch { return {}; } })() : {};
    return [
      { n: 1, title: "Connect a testnet wallet", help: s1 ? `Connected as ${acct}.` : "MyNearWallet or Meteor; each step opens your wallet to approve.", st: st(1), label: s1 ? undefined : "Connect wallet", act: "connect" },
      { n: 2, title: "Get test USDC", help: `The round raises ${usd(want)} from you and the payout pot is ${usd(BigInt(pot) * M)}. Your balance: ${usd(bal)}.`, st: st(2), label: "Get test USDC", act: "faucet", off: !s1 },
      { n: 3, title: "Make yourself an officer", help: "Only officers can propose a round or a payout. The open sandbox board grants it to anyone.", st: st(3), label: "Make me an officer", act: "officer", off: !s1 },
      { n: 4, title: "Build the private cap table, prove it, propose it", help: r ? `Round ${r.id} is on chain with root ${String(plan.merkle_root).slice(0, 14)}…${plan.escrow_hash ? ` and a committed encrypted board copy (${String(plan.escrow_hash).slice(0, 10)}…)` : ""}.` : status || "Builds the sealed table in this tab, proves in your browser that it adds up to the public total, and sends only the root and the proof. In this demo the tab also creates every holder's key; real holders make their own.", st: st(4), label: "Prove and propose", act: "propose", off: !s3 || busy },
      { n: 5, title: "Fund the round", help: "You pay the raise into escrow (public: who paid how much). It is refunded if the round is cancelled.", st: st(5), label: "Fund", act: "fund", off: !r || r.status !== "Funding" || funded },
      { n: 6, title: "Board checks, then approves", help: "A real board first opens the Board check below with the table it was given. On the open sandbox you act as the board.", st: st(6), label: "Approve as the board", act: "approve", off: !r || r.status !== "Funding" },
      { n: 7, title: "Close the round", help: "The contract commits the root. No holdings are credited: there are none to see. Next: the Pay out and claim tab.", st: st(7), label: "Close round", act: "close", off: !(r?.status === "Approved" && funded) },
      { n: 8, title: "Open a private payout", help: ex ? `Private payout ${ex.id} on round ${ex.round_id}: pot ${usd(BigInt(ex.pot))} over ${BigInt(ex.total_shares).toLocaleString("en-US")} shares.` : "A payout that is claimed with a holder's key and claim file instead of being paid to named holders.", st: st(8), label: "Open payout", act: "pexit", off: !s7 },
      { n: 9, title: "Fund the pot", help: "The treasury (you) puts the pot into the contract.", st: st(9), label: "Fund the pot", act: "pfund", off: !ex || s9 },
      { n: 10, title: "Board approves the payout", help: ex ? `Approving opens claims (claimed so far: ${usd(BigInt(ex.claimed))} of ${usd(BigInt(ex.pot))}). Then claim below.` : "Approving opens claims; nothing is paid until a holder proves their share.", st: st(10), label: "Approve as the board", act: "papprove", off: !ex || !s9 || s10 },
    ];
  }
  const rowHtml = (x: Row) => `<li class="flow-row ${x.st}"><span class="flow-n">${x.st === "done" ? "✓" : x.n}</span><div class="flow-t"><b>${esc(x.title)}</b><span class="muted">${esc(x.help)}</span></div>${x.label ? `<button class="btn ${x.st === "current" ? "primary" : ""} sm" data-zk="${x.act}" ${x.off || busy ? "disabled" : ""}>${esc(x.label)}</button>` : `<span class="flow-ok">done</span>`}</li>`;

  function draw() {
    const rs = rows(), r = myRound();
    // follow the progress: once the round is closed, the work is on the payout tab (the person can still click either tab)
    const want = rs[6].st === "done" ? "payout" : "round"; if (want !== lastWant) { lastWant = want; showTab(want); }
    $z("zk-banner").innerHTML = readError ? `<div class="flow-banner fail">Could not read the contract: ${esc(readError)}</div>` : `<div class="flow-banner muted">Confidential sandbox <span class="mono">${esc(d.contract)}</span>${v ? ` · ${v.rounds.length} round(s)` : ""}${busy ? " · working…" : ""}</div>`;
    const ok = `${pot}|${!!r}`; // re-draw the options only when they change, so typing a passphrase is never interrupted
    if (ok !== optsKey) {
      optsKey = ok;
      $z("zk-opts").innerHTML = `<label for="zk-pot">Payout pot</label><select id="zk-pot" style="width:auto;min-width:120px">${POTS.map((p) => `<option value="${p}" ${p === pot ? "selected" : ""}>$${p.toLocaleString("en-US")}</option>`).join("")}</select>
        <label for="zk-pass">Board passphrase</label><input type="text" id="zk-pass" value="${esc(pass)}" placeholder="optional, 12+ characters: encrypts a board copy" autocomplete="off" style="width:auto;min-width:280px" ${r ? "disabled" : ""}/>`;
      const sel = $z("zk-pot") as HTMLSelectElement; sel.onchange = () => { pot = +sel.value; optsKey = ""; draw(); };
      const pw = $z("zk-pass") as HTMLInputElement; pw.oninput = () => { pass = pw.value; };
    }
    $z("zk-rows-round").innerHTML = rs.slice(0, 7).map(rowHtml).join(""); $z("zk-rows-payout").innerHTML = rs.slice(7).map(rowHtml).join("");
    const dl = built ? [["claims", "Claim files"], ["keys", "Holder keys (demo)"], ["table", "Table file for the board"], ...(built.escrow ? [["escrow", "Encrypted board copy"]] : [])] : [];
    $z("zk-files").innerHTML = built ? `<b>Your files exist only in this browser tab</b> (they survive a wallet redirect, not closing the tab). <b>Download them now:</b> ${dl.map(([k, t]) => `<button class="btn sm" data-zk="dl-${k}" style="margin:4px 6px 0 0">${t}</button>`).join("")}<br/><span class="muted">Claim files hold no secret and can be re-issued; each holder key is that holder's only secret (real holders make their own); the table file is private and is for the board.</span>`
      : `<span class="muted">After step 4 your files appear here.</span>`;
    host.querySelectorAll<HTMLButtonElement>("button[data-zk]").forEach((b) => (b.onclick = () => void act(b.dataset.zk!)));
  }

  async function run(what: string, receiver: string, acts: Act[], after?: () => void, settle = 2500) {
    busy = true; draw();
    try { toast(`Waiting for your wallet to approve: ${esc(what)} …`); const x = await send(receiver, acts); if (x.hash) { toast(`<span class="pass">DONE</span> ${esc(what)}: ${txLink(d.explorer, x.hash)}`, "ok"); after?.(); await new Promise((res) => setTimeout(res, settle)); } }
    catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); }
    busy = false; await refresh();
  }

  async function act(a: string) {
    const me = account();
    if (a === "connect") { document.getElementById("wallet-btn")?.click(); return; }
    if (a.startsWith("dl-") && built) { const k = a.slice(3); download(k === "claims" ? "rounds-claim-files.json" : k === "keys" ? "rounds-holder-keys-demo.json" : k === "table" ? "rounds-table-file.json" : "rounds-board-copy.escrow.json", k === "claims" ? built.claimFiles : k === "keys" ? built.keys.map((x, i) => ({ holderId: built!.claimFiles[i].holderId, ...x })) : k === "table" ? built.tableFile : built.escrow); return; }
    if (!me || !v) return;
    const r = myRound(), ex = myExit();
    if (a === "faucet") await run("register and get $10,000,000 test USDC", d.token, [{ method: "storage_deposit", args: { account_id: me } }, { method: "faucet", args: { account_id: me, amount: (10_000_000n * M).toString() } }]);
    else if (a === "officer") { busy = true; draw(); await boardAct(d.explorer, d.board, "set_officer", { account: me, enabled: true }, `make ${me} an officer`, () => store.set(key("officer"), true)); await new Promise((res) => setTimeout(res, 2500)); busy = false; await refresh(); }
    else if (a === "propose") {
      const m = d.model(me); if (!m) { toast(`<span class="fail">FAIL</span> the modeled round has no valid solution`, "fail"); return; }
      if (pass && pass.length < 12) { toast(`<span class="fail">FAIL</span> use a board passphrase of at least 12 characters, or leave it empty`, "fail"); return; }
      busy = true; draw();
      try {
        await nodeGlobals(); const zk = await import("../../src/engine/zk");
        status = "Building the sealed table …"; draw();
        const b = await zk.generateShareholderReceipts(m.entries, { classes: m.classes });
        let escrow: EscrowFile | null = null, escrowHash: string | null = null;
        if (pass) { status = "Encrypting the board copy …"; draw(); escrow = await zk.encryptEscrow(b.tableFile, pass); escrowHash = await zk.escrowHash(escrow); }
        built = { claimFiles: b.claimFiles, keys: b.keys, tableFile: b.tableFile, escrow, total: b.totalShares };
        persistBuilt(built); // survive a wallet redirect
        (window as any).__zkBuilt = built; // dev/test hook: lets scripts/e2e-zk.mjs hand the files to the claim panel
        const next: number = await call(d.rpc, d.contract, "next_round_id", {});
        status = "Proving in your browser (this can take a little while the first time) …"; draw();
        const t0 = performance.now();
        const p = await zk.proveCapTableCommit(b.witness, { merkleRoot: b.root, totalShares: b.totalShares, roundId: BigInt(next) }, FILES.commit);
        status = `Proved in ${((performance.now() - t0) / 1000).toFixed(1)} s. Sending the root and the proof …`; draw();
        store.set(key("pending"), { root: b.root.toString(), next });
        const args: Record<string, unknown> = { merkle_root: b.root.toString(), total_shares: b.totalShares.toString(), raise: [[me, m.raiseMicro.toString()]], deadline_ns: (Math.floor(Date.now() / 1000) + 7 * 86_400) * 1e9, proof: p.contractProof, escrow_hash: escrowHash }; // whole seconds in ns: exact as a JSON number (a u64 argument)
        toast("Waiting for your wallet to approve: propose the confidential round …");
        const x = await send(d.contract, [{ method: "propose_confidential_round", args, gasTgas: 300 }]);
        if (x.hash) { toast(`<span class="pass">DONE</span> confidential round proposed: ${txLink(d.explorer, x.hash)}. Download your files now.`, "ok"); store.set(key("officer"), true); await new Promise((res) => setTimeout(res, 2500)); }
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
  mountBoardCheck($z("zk-board-body"), d); mountPrivateClaim($z("zk-claim-body"), d);
}

/** The Board check: the board is given the private table (or its encrypted copy), re-seals it here, and sees whether it matches the round on chain. */
function mountBoardCheck(host: HTMLElement, d: ZkDeps) {
  let rounds: { id: number; root: string; total: string; escrow: string | null; status: string }[] = [], roundId = 0, out = "", busy = false, file: File | null = null, bpass = "";
  async function load() {
    try { const v = await loadChain(d.rpc, d.contract); rounds = v.rounds.filter((r) => String(r.kind) === "Confidential").map((r) => { const p = JSON.parse(r.plan); return { id: r.id, root: p.merkle_root, total: p.total_shares, escrow: p.escrow_hash ?? null, status: r.status }; }); } catch { rounds = []; }
    if (!rounds.some((r) => r.id === roundId)) roundId = rounds[rounds.length - 1]?.id ?? 0;
    draw();
  }
  function draw() {
    const oldPass = host.querySelector<HTMLInputElement>("#zk-bpass"); if (oldPass) bpass = oldPass.value; // a refresh must never erase what is being typed
    const oldRound = host.querySelector<HTMLSelectElement>("#zk-bround"); if (oldRound && oldRound.value) roundId = +oldRound.value;
    const r = rounds.find((x) => x.id === roundId);
    host.innerHTML = `<p class="note">A confidential round puts only a <b>sealed fingerprint</b> of the cap table on chain, so the board cannot read the numbers there. Before approving, the board is given the private table file (or the encrypted board copy and its passphrase) by the proposer, and checks here that it re-seals to exactly the root on chain, adds up to the proposed total, and has no duplicated holder. Nothing is uploaded: the check runs in this tab.</p>
      <span class="fl">Confidential round</span><select id="zk-bround" style="width:auto;min-width:300px;max-width:100%">${rounds.map((x) => `<option value="${x.id}" ${x.id === roundId ? "selected" : ""}>Round ${x.id} (${esc(x.status)}) · root ${esc(x.root.slice(0, 12))}… · ${esc(BigInt(x.total).toLocaleString("en-US"))} shares${x.escrow ? " · board copy committed" : ""}</option>`).join("") || `<option value="">no confidential rounds yet</option>`}</select>
      <span class="fl">The table file, or the encrypted board copy</span>${dropHtml("zk-btable", file?.name ?? null, "Choose the file the proposer gave you, or drop it here")}
      <span class="fl">Passphrase (only for the encrypted board copy)</span><input type="text" id="zk-bpass" value="${esc(bpass)}" placeholder="from the proposer" autocomplete="off"/>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary sm" id="zk-bcheck" ${busy || !r ? "disabled" : ""}>Check it against the chain</button><button class="btn sm" id="zk-breload">Reload rounds</button></div>
      <div id="zk-bout" style="margin-top:12px;font-size:14px">${out}</div>`;
    (host.querySelector("#zk-bround") as HTMLSelectElement).onchange = (e) => { roundId = +(e.target as HTMLSelectElement).value; out = ""; draw(); };
    bindDrop(host, "zk-btable", (f) => { file = f; draw(); });
    (host.querySelector("#zk-bpass") as HTMLInputElement).oninput = (e) => { bpass = (e.target as HTMLInputElement).value; };
    (host.querySelector("#zk-bcheck") as HTMLButtonElement).onclick = () => void check();
    (host.querySelector("#zk-breload") as HTMLButtonElement).onclick = () => void load();
  }
  async function check() {
    const r = rounds.find((x) => x.id === roundId), passEl = host.querySelector("#zk-bpass") as HTMLInputElement; bpass = passEl.value;
    if (!r || !file) { out = `<span class="fail">FAIL</span> choose a round and a file`; draw(); return; }
    busy = true; out = "Checking …"; draw();
    try {
      await nodeGlobals(); const zk = await import("../../src/engine/zk");
      let table: TableFile; const lines: string[] = [];
      const j = await readJson(file);
      if (j && j.ciphertext) {
        const esc2 = j as EscrowFile; const h = await zk.escrowHash(esc2);
        if (r.escrow) lines.push(h === r.escrow ? `<span class="pass">PASS</span> this encrypted copy is exactly the one the proposer committed to in the round` : `<span class="fail">FAIL</span> this encrypted copy is NOT the one committed in the round (${esc(h.slice(0, 12))}… instead of ${esc(r.escrow.slice(0, 12))}…)`);
        else lines.push(`<span class="muted">note</span> this round committed no encrypted copy, so nothing ties this file to the proposal`);
        table = await zk.decryptEscrow(esc2, bpass);
      } else table = j as TableFile;
      const res = await zk.checkTableFile(table, { merkleRoot: r.root, totalShares: r.total });
      lines.push(res.ok ? `<span class="pass">PASS</span> the table re-seals to exactly the root on chain and adds up to ${esc(BigInt(r.total).toLocaleString("en-US"))} shares` : res.problems.map((p) => `<span class="fail">FAIL</span> ${esc(p)}`).join("<br/>"));
      lines.push(`<span class="muted">By class:</span> ${Object.entries(res.byClass).map(([c, s]) => `${esc(c)} ${esc((s as bigint).toLocaleString("en-US"))}`).join(" · ")}`);
      lines.push(`<table><tr><th>Holder (private label)</th><th>Class</th><th class="n">Shares</th><th class="n">Share of total</th></tr>${res.rows.map((x) => `<tr><td>${esc(x.holderId)}</td><td>${esc(x.shareClass)}</td><td class="n">${esc(BigInt(x.shares).toLocaleString("en-US"))}</td><td class="n">${esc((Number((BigInt(x.shares) * 10000n) / BigInt(r.total)) / 100).toFixed(2))}%</td></tr>`).join("")}</table>`);
      lines.push(`<span class="muted">The check proves the file is the table the root came from. It cannot tell you whether every row is a real person: that is the board's own judgement, ideally confirmed by each holder.</span>`);
      out = lines.join("<br/>");
    } catch (e) { out = `<span class="fail">FAIL</span> ${esc((e as Error).message)}`; }
    busy = false; draw();
  }
  draw(); void load();
}

/** The Private Claim panel: a holder's own key, their claim file, any fresh recipient account, a proof made locally, and (if a relayer is configured) a submission that does not involve the holder's wallet. */
function mountPrivateClaim(host: HTMLElement, d: ZkDeps) {
  let claim: (ClaimFile & { holderSecret?: string }) | null = null, holderKey: HolderKey | null = null, claimName: string | null = null, keyName: string | null = null, exits: any[] = [], busy = false, reading = false, status = "", exitId = 0, relayer: string | null = null, useRelayer = true, madeKey: HolderKey | null = null, recipientVal = "";
  // a fresh payout account made in this tab: held in memory only, never in storage, so leaving the page without saving the phrase loses it
  let fresh: FreshAccount | null = null, freshSaved = false, showPhrase = false;
  const roots = new Map<number, string>(); // round id -> the committed root, to match a claim file to the payouts of its own cap table
  async function load() {
    reading = true; // while the chain is re-read, never claim that the file does not match
    relayer = await relayerUrl();
    // build the new list aside and swap it in, so a click while the chain is being read still sees the previous list instead of an empty one
    const list: any[] = []; for (let i = 1; i <= 30; i++) { try { const e = await call(d.rpc, d.contract, "private_exit", { exit_id: i }); if (!e) break; list.push(e); } catch { break; } }
    exits = list;
    for (const e of exits) if (!roots.has(e.round_id)) { try { const c = await call(d.rpc, d.contract, "confidential_root", { round_id: e.round_id }); if (c) roots.set(e.round_id, c[0]); } catch { /* not committed yet */ } }
    const own = claim ? [...exits].reverse().find((x) => roots.get(x.round_id) === claim!.merkleRoot) : undefined;
    exitId = own?.id ?? (exits.some((x) => x.id === exitId) ? exitId : exits[exits.length - 1]?.id ?? 0);
    reading = false; draw(true);
  }
  function draw(keepChoice = false) {
    const oldRecipient = host.querySelector<HTMLInputElement>("#zk-recipient"); if (oldRecipient) recipientVal = oldRecipient.value; // a refresh must never erase what is being typed
    const oldExit = host.querySelector<HTMLSelectElement>("#zk-exit"); if (!keepChoice && oldExit && oldExit.value) exitId = +oldExit.value; // a reload has just picked the payout that matches the claim file: do not overwrite it with the old dropdown value
    if (claim) { // a claim file belongs to one round: select that round's payout straight away instead of flashing a mismatch while the chain is re-read
      const cur = exits.find((x) => x.id === exitId), own = [...exits].reverse().find((x) => roots.get(x.round_id) === claim!.merkleRoot);
      if (own && (!cur || roots.get(cur.round_id) !== claim.merkleRoot)) exitId = own.id;
    }
    const e = exits.find((x) => x.id === exitId), mismatch = !!(claim && e && !reading && roots.get(e.round_id) !== claim.merkleRoot);
    const mine = claim && e && !mismatch ? (BigInt(claim.shareAmount) * BigInt(e.pot)) / BigInt(e.total_shares) : null;
    const keyOk = !!(claim && (holderKey || claim.holderSecret));
    host.innerHTML = `<p class="note">A holder proves, without saying which row is theirs, that they are in the committed cap table and are owed exactly their pro-rata share; the contract pays any account named in the proof and registers it with the token itself. <b>The amount paid is public.</b> If the claim is sent from your own wallet it is linked to you${relayer ? "; a relayer is available, so you can avoid that" : "; use an unrelated account or a relayer"}.</p>
      <div class="zbar"><button class="btn sm" id="zk-mkkey">Create my holder key</button><span class="muted">${madeKey ? `Key created and downloaded. Give the proposer ONLY this code: <span class="mono">${esc(madeKey.holderCode)}</span>` : "Real holders make their own secret; only its public code goes into the table."}</span></div>
      <span class="fl">1 · Your claim file</span>${dropHtml("zk-file", claimName, "Choose your claim file, or drop it here")}
      <span class="fl">2 · Your holder key</span>${dropHtml("zk-keyfile", keyName, "Choose your holder key, or drop it here")}
      <span class="fl">3 · Which payout</span><select id="zk-exit" style="width:auto;min-width:260px;max-width:100%">${exits.map((x) => `<option value="${x.id}" ${x.id === exitId ? "selected" : ""}>Payout ${x.id}: pot ${esc(usd(BigInt(x.pot)))}${x.approved ? "" : " (not approved yet)"}</option>`).join("") || `<option value="">no private payouts yet</option>`}</select>
      <span class="fl">4 · Receiving account (any fresh testnet account; the contract registers it with the token)</span><input type="text" id="zk-recipient" value="${esc(recipientVal)}" placeholder="fresh-account.testnet" autocomplete="off" spellcheck="false"/>
      <div class="zbar" style="margin-top:8px"><button class="btn sm" id="zk-fresh">Generate a fresh payout account</button><span class="muted">A brand-new account made in this browser. Nothing to fund: the contract registers it with the token, and ${relayer ? "the relayer pays the gas" : "a relayer can pay the gas"}.</span></div>
      ${fresh ? `<div class="card" style="margin:10px 0;padding:12px 14px"><div class="mono muted" style="font-size:11px">YOUR NEW PAYOUT ACCOUNT</div><div class="mono" style="word-break:break-all;margin:6px 0">${esc(fresh.accountId)}</div>
        <p class="note" style="margin:6px 0"><b>Save the recovery phrase now.</b> It is shown here only; the page does not store it. Whoever has it controls the money paid to this account, and if you lose it the money is gone. Import it into any NEAR wallet (MyNearWallet, Meteor) to spend. <b>Paying it onward to an account linked to you (an exchange, your main wallet) links the two again.</b></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="zk-fresh-show">${showPhrase ? "Hide" : "Show"} recovery phrase</button><button class="btn sm" id="zk-fresh-dl">Download recovery file</button></div>
        ${showPhrase ? `<pre class="out mono" style="white-space:pre-wrap;margin:8px 0 0">${esc(fresh.phrase)}</pre>` : ""}
        <label style="display:flex;gap:8px;align-items:center;margin:10px 0 6px"><input type="checkbox" id="zk-fresh-ok" style="width:auto" ${freshSaved ? "checked" : ""}/> I saved the recovery phrase</label>
        <button class="btn primary sm" id="zk-fresh-use" ${freshSaved ? "" : "disabled"}>Use this account as the receiving account</button></div>` : ""}
      ${relayer ? `<label style="display:flex;gap:8px;align-items:center;margin:10px 0 0"><input type="checkbox" id="zk-relay" style="width:auto" ${useRelayer ? "checked" : ""}/> Submit through the relayer (my wallet does not sign or appear on chain)</label>` : ""}
      <p class="muted" style="margin:10px 0">${claim ? `Claim file: ${esc(claim.holderId)} · ${esc(claim.shareClass)}${mine !== null ? ` · you would receive ${esc(usd(mine))}` : ""}.` : "No claim file yet."} ${keyOk ? "Holder key loaded." : claim ? "Now add your holder key." : ""} ${mismatch ? `<span class="fail">This claim file belongs to a different cap table than the selected payout.</span>` : ""} ${reading && claim ? `<span class="muted">Reading the chain …</span>` : ""} ${esc(status)}</p>
      <button class="btn primary sm" id="zk-claim-btn" ${busy || reading || !keyOk || !e || !e.approved || mismatch ? "disabled" : ""}>Prove and claim privately</button>`;
    (host.querySelector("#zk-fresh") as HTMLButtonElement).onclick = async () => { const st = await import("../../src/engine/stealth"); fresh = st.generateFreshAccount(); freshSaved = false; showPhrase = false; draw(); };
    const fb = (id: string) => host.querySelector<HTMLElement>(`#${id}`);
    if (fresh) {
      fb("zk-fresh-show")!.onclick = () => { showPhrase = !showPhrase; draw(); };
      fb("zk-fresh-dl")!.onclick = () => { download("rounds-fresh-payout-account.json", { note: "Import the recovery phrase into a NEAR wallet to control this account. Keep this file private.", accountId: fresh!.accountId, publicKey: fresh!.publicKey, recoveryPhrase: fresh!.phrase }); freshSaved = true; draw(); };
      (fb("zk-fresh-ok") as HTMLInputElement).onchange = (ev) => { freshSaved = (ev.target as HTMLInputElement).checked; draw(); };
      fb("zk-fresh-use")!.onclick = () => { recipientVal = fresh!.accountId; draw(); };
    }
    (host.querySelector("#zk-mkkey") as HTMLButtonElement).onclick = async () => { await nodeGlobals(); const zk = await import("../../src/engine/zk"); madeKey = await zk.generateHolderKey(); download("rounds-holder-key.json", madeKey); draw(); };
    bindDrop(host, "zk-file", async (f) => { try { const j = await readJson(f); claim = Array.isArray(j) ? j[0] : j; claimName = f.name; if (claim?.holderSecret) holderKey = null; status = Array.isArray(j) && j.length > 1 ? "That file holds several claim files; the first is used." : ""; } catch { claim = null; claimName = null; status = "That file is not a claim file."; } await load(); });
    bindDrop(host, "zk-keyfile", async (f) => { try { const j = await readJson(f); holderKey = Array.isArray(j) ? j[0] : j; keyName = f.name; status = ""; } catch { holderKey = null; keyName = null; status = "That file is not a holder key."; } draw(); });
    (host.querySelector("#zk-exit") as HTMLSelectElement).onchange = (ev) => { exitId = +(ev.target as HTMLSelectElement).value; draw(); };
    (host.querySelector("#zk-recipient") as HTMLInputElement).oninput = (ev) => { recipientVal = (ev.target as HTMLInputElement).value; };
    const rl = host.querySelector("#zk-relay") as HTMLInputElement | null; if (rl) rl.onchange = () => { useRelayer = rl.checked; };
    (host.querySelector("#zk-claim-btn") as HTMLButtonElement).onclick = () => void doClaim((host.querySelector("#zk-recipient") as HTMLInputElement).value.trim().toLowerCase());
  }
  async function doClaim(recipient: string) {
    const e = exits.find((x) => x.id === exitId);
    console.debug("[zk] claim() " + JSON.stringify({ recipient, exitId, haveClaim: !!claim, haveExit: !!e }));
    if (!claim || !e) { toast(`<span class="fail">FAIL</span> ${!claim ? "load your claim file first" : "no private payout is selected yet"}`, "fail"); return; }
    const secret = holderKey?.holderSecret ?? claim.holderSecret; if (!secret) { toast(`<span class="fail">FAIL</span> load your holder key first`, "fail"); return; }
    if (!/^[a-z0-9._-]{2,64}$/.test(recipient)) { toast(`<span class="fail">FAIL</span> enter the receiving account id`, "fail"); return; }
    busy = true; status = "Proving in your browser …"; draw();
    try {
      await nodeGlobals(); const zk = await import("../../src/engine/zk");
      const t0 = performance.now();
      const p = await zk.provePrivateClaim(claim, secret, { exitId: BigInt(e.id), totalShares: BigInt(e.total_shares), totalPot: BigInt(e.pot) }, recipient, FILES.claim);
      status = `Proved in ${((performance.now() - t0) / 1000).toFixed(1)} s. Sending …`; draw(); console.debug("[zk] claim proved");
      const args = { exit_id: e.id, nullifier: p.nullifier.toString(), payout_amount: p.payoutAmount.toString(), recipient_id: recipient, proof: p.contractProof };
      if (relayer && useRelayer) {
        toast("Sending the proof to the relayer (your wallet is not involved) …");
        const r = await (await fetch(relayer, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) })).json();
        if (!r.ok) throw new Error(r.error ?? "the relayer refused the claim");
        toast(`<span class="pass">DONE</span> ${esc(usd(p.payoutAmount))} claimed to ${esc(recipient)}, submitted by the relayer ${esc(r.relayer)}`, "ok");
      } else {
        toast("Waiting for your wallet to approve: claim the private payout …");
        const x = await send(d.contract, [{ method: "claim_private_payout", args, gasTgas: 300 }]);
        if (x.hash) toast(`<span class="pass">DONE</span> ${esc(usd(p.payoutAmount))} claimed to ${esc(recipient)}: ${txLink(d.explorer, x.hash)}`, "ok");
      }
      status = "Claimed.";
    } catch (err) { console.debug("[zk] claim failed", (err as Error).message); toast(`<span class="fail">FAIL</span> ${esc((err as Error).message)}`, "fail"); status = ""; }
    busy = false; await load();
  }
  draw(); void load(); onAccount(() => void load());
}
