import { initWalletUi, renderActions, toast, txLink } from "./actions";
import { send, account } from "./wallet";
import { loadChain, checkRound, validAccount, esc } from "./chain";
import { priceRound, waterfall, vested, exerciseCost, canonicalJson, planHash, pricedRoundPlan, type PricedRoundInput, type Safe } from "../../src/engine/index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const M = 1_000_000n;
const usd = (micro: bigint, cents = false) => {
  const neg = micro < 0n; const m = neg ? -micro : micro;
  const whole = m / M; const c = ((m % M) + 5_000n) / 10_000n;
  const w = (c >= 100n ? whole + 1n : whole).toLocaleString("en-US"); const cc = (c >= 100n ? 0n : c).toString().padStart(2, "0");
  return (neg ? "-$" : "$") + w + (cents ? "." + cc : "");
};
const price4 = (micro: bigint) => "$" + (Number(micro) / 1e6).toFixed(4);
const n = (x: bigint) => x.toLocaleString("en-US");
const pct = (a: bigint, b: bigint) => b === 0n ? "0.00%" : (Number((a * 20000n + b) / (2n * b)) / 100).toFixed(2) + "%"; // half-up, per RULES.md
const RULES = (id: string) => `<a class="q" href="rules.html#${id}" title="Definition in RULES.md">?</a>`;

// ---------- state ----------
let defaultContract = "", explorerBase = "https://explorer.testnet.near.org";
const state = { pre: 21_000_000, raise: 9_000_000, pool: 10, ada: 5_000_000, bayo: 2_750_000, poolNow: 1_000_000,
  safes: [{ id: "safe1", holder: "chidi", amt: 500_000, cap: 5_000_000, disc: 0 }, { id: "safe2", holder: "dayo", amt: 250_000, cap: 10_000_000, disc: 0 }],
  proceeds: 20_000_000, month: 18, filter: "All", investor: "fund" };
const COLORS: Record<string, string> = { ada: "#fafafa", bayo: "#a1a1aa", safe1: "#44ffa4", safe2: "#2ca86c", fund: "#3080ff", unissued_pool: "#f99c00", efe: "#d946ef" };
const label = (k: string) => ({ unissued_pool: "Option pool", fund: "Fund (Series A)", safe1: "SAFE 1 · chidi", safe2: "SAFE 2 · dayo", ada: "Ada", bayo: "Bayo", efe: "Efe (options)" } as Record<string, string>)[k] ?? k;
const CLASS_OF: Record<string, string> = { ada: "Common", bayo: "Common", unissued_pool: "Common", fund: "Series A Preferred", safe1: "SAFE 1 shadow preferred", safe2: "SAFE 2 shadow preferred" };

function input(): PricedRoundInput {
  return {
    common: { ada: BigInt(state.ada), bayo: BigInt(state.bayo) }, unissuedPool: BigInt(state.poolNow),
    safes: state.safes.map((s): Safe => ({ id: s.id, holder: s.holder, amount: BigInt(s.amt) * M, postMoneyCap: BigInt(s.cap) * M, discountBps: Math.round(s.disc * 100) })),
    preMoney: BigInt(state.pre) * M, investors: { fund: BigInt(state.raise) * M }, poolTarget: { num: BigInt(state.pool), den: 100n },
  };
}
type Res = ReturnType<typeof priceRound>;
function solve(): { r: Res | null; err: string | null } {
  try { return { r: priceRound(input()), err: null }; } catch (e) { return { r: null, err: (e as Error).message }; }
}

function bars(parts: [string, bigint][], total: bigint) {
  return `<div class="bar" role="img" aria-label="${parts.map(([k, v]) => `${label(k)} ${pct(v, total)}`).join(", ")}">${parts.filter(([, v]) => v > 0n).map(([k, v]) =>
    `<div style="flex:${Number((v * 10000n) / (total || 1n)) || 1};background:${COLORS[k] ?? "#888"}" title="${label(k)} ${pct(v, total)}"></div>`).join("")}</div>`;
}
const legend = (keys: string[]) => keys.map((k) => `<span><i style="background:${COLORS[k] ?? "#888"}"></i>${label(k)}</span>`).join("");

// ---------- render: hero + modeler ----------
function renderModel() {
  const { r, err } = solve();
  const out = $("model-out"), hero = $("hero-bars");
  if (!r) { out.innerHTML = `<p class="warn">Cannot solve: ${err}</p>`; hero.innerHTML = ""; return; }
  const preTotal = BigInt(state.ada + state.bayo + state.poolNow);
  const before: [string, bigint][] = [["ada", BigInt(state.ada)], ["bayo", BigInt(state.bayo)], ["unissued_pool", BigInt(state.poolNow)]];
  const keys = ["ada", "bayo", ...state.safes.map((s) => s.id), "fund", "unissued_pool"];
  const after: [string, bigint][] = keys.map((k) => [k, r.holdings[k] ?? 0n]);
  const chart = `<div class="barlab"><span>Before</span><span>${n(preTotal)} shares</span></div>${bars(before, preTotal)}<div class="barlab"><span>After</span><span>${n(r.fullyDiluted)} shares</span></div>${bars(after, r.fullyDiluted)}`;
  hero.innerHTML = chart; $("hero-legend").innerHTML = legend(keys); $("hero-price").textContent = `PRICE ${price4(r.priceMicro)} / SHARE`;
  const founderBefore = BigInt(state.ada + state.bayo) * 10000n / preTotal, founderAfter = BigInt(state.ada + state.bayo) * 10000n / r.fullyDiluted;
  const post = BigInt(state.pre + state.raise) * M;
  out.innerHTML = `<div class="stat"><div><b>${price4(r.priceMicro)}</b><span>Round price ${RULES("r6")}</span></div><div><b>${n(r.poolTopUp)}</b><span>Pool top-up</span></div><div><b>${(Number(founderBefore - founderAfter) / 100).toFixed(1)} pts</b><span>Founder dilution</span></div></div>
  ${chart}
  <table style="margin-top:16px"><tr><th>SAFE</th><th>Regime</th><th class="n">Conv. price</th><th class="n">Shares</th><th class="n">Value at round</th></tr>${state.safes.map((s) => `<tr><td>${s.holder}</td><td>${r.safeRegime[s.id]}</td><td class="n">${price4(r.safeConversionPriceMicro[s.id])}</td><td class="n">${n(r.holdings[s.id])}</td><td class="n">${usd(r.holdings[s.id] * r.priceMicro)}</td></tr>`).join("")}</table>
  <p class="note" style="margin-top:12px">Fully diluted ${n(r.fullyDiluted)} × ${price4(r.priceMicro)} = ${usd(r.fullyDiluted * r.priceMicro)} vs post-money ${usd(post)}; the difference is price rounding, reported not hidden ${RULES("r1")}. SAFE shares are priced at the lower of the cap and discount prices ${RULES("r3")}.</p>`;
  void renderPlan(r);
  renderCap(r); renderPeople(r); renderExit(r);
}
async function renderPlan(r: Res) {
  const plan = pricedRoundPlan(input(), r, { safeClass: (id) => CLASS_OF[id], seriesClass: "Series A Preferred" });
  const canon = canonicalJson(plan); const h = await planHash(canon);
  $("plan-card").innerHTML = `<div class="card-h"><span class="mono muted">PLAN HASH · SHA-256 OF RFC 8785 JSON ${RULES("r9")}</span></div><div class="hash">${h}</div>
  <p class="note" style="margin-top:12px">This is the exact value the board votes on. Propose it with your wallet, or with the command below; either way the contract accepts it only from an officer account, and the DAO then approves it by this hash.</p>
  <div style="margin:10px 0"><button class="btn primary sm" id="propose-btn">Propose on chain with my wallet</button> <span class="note" id="propose-note">Sends <span class="mono">propose_round</span> to the contract in the box under Events &amp; verify, with your account as the investor. Testnet only.</span></div>
  <pre class="out" id="cli">near contract call-function as-transaction &lt;ROUNDS&gt; propose_round json-args '{"kind":"Priced","plan_hash":"${h}","plan_uri":"…","plan":${JSON.stringify(canon).replace(/&/g, "&amp;").replace(/</g, "&lt;")},"raise":[["fund.testnet","${(BigInt(state.raise) * M).toString()}"]],"deadline_ns":…}' …</pre>`;
  $("propose-btn").onclick = async () => {
    const acct = account();
    if (!acct) { toast("Connect a testnet wallet first (top right), then press the button again.", "info"); document.getElementById("wallet-btn")?.click(); return; }
    const contract = ($("contract") as HTMLInputElement).value.trim().toLowerCase() || defaultContract;
    if (!validAccount(contract)) { toast(`<span class="fail">FAIL</span> put a Rounds contract account in the box under Events &amp; verify first.`, "fail"); return; }
    const mine = pricedRoundPlan(input(), r, { safeClass: (id) => CLASS_OF[id], seriesClass: "Series A Preferred", investorHolder: () => acct });
    const c = canonicalJson(mine); const hh = await planHash(c);
    const deadline = ((BigInt(Date.now()) + 7n * 86_400_000n) * 1_000_000n).toString(); // exact u64, 7 days out
    const raw = `{"kind":"Priced","plan_hash":"${hh}","plan_uri":"app://rounds-modeler","plan":${JSON.stringify(c)},"raise":[[${JSON.stringify(acct)},"${(BigInt(state.raise) * M).toString()}"]],"deadline_ns":${deadline}}`;
    try {
      toast(`Waiting for your wallet to approve propose_round on ${esc(contract)} …`);
      const res = await send(contract, [{ method: "propose_round", args: new TextEncoder().encode(raw), gasTgas: 100 }]);
      if (res.hash) toast(`<span class="pass">DONE</span> round proposed${res.value !== null ? ` (#${esc(String(res.value))})` : ""}: ${txLink(explorerBase, res.hash)}. Next: the board approves hash <span class="mono">${esc(hh.slice(0, 12))}…</span> and the investor funds it.`, "ok");
    } catch (e) {
      const m = (e as Error).message;
      toast(`<span class="fail">FAIL</span> the contract refused: ${esc(m)}.${/officer/i.test(m) ? " Your account is not an officer on that contract; its board must call set_officer for you first." : ""}`, "fail");
    }
  };
}

// ---------- cap table ----------
function renderCap(r: Res) {
  const filters = ["All", "Founders", "SAFEs", "Series A"];
  $("cap-filter").innerHTML = filters.map((f) => `<button class="tab ${state.filter === f ? "on" : ""}" data-f="${f}">${f}</button>`).join("") + `<button class="tab" id="csv-btn" style="margin-left:auto" title="Download this cap table as CSV">Export CSV</button>`;
  const fd = r.fullyDiluted;
  const rows: { k: string; round: string; price: string; shares: bigint }[] = [
    { k: "ada", round: "Founders", price: "$0.0000", shares: r.holdings.ada }, { k: "bayo", round: "Founders", price: "$0.0000", shares: r.holdings.bayo },
    ...state.safes.map((s) => ({ k: s.id, round: "SAFEs", price: price4(r.safeConversionPriceMicro[s.id]), shares: r.holdings[s.id] })),
    { k: "fund", round: "Series A", price: price4(r.priceMicro), shares: r.holdings.fund },
    { k: "unissued_pool", round: "Founders", price: "—", shares: r.holdings.unissued_pool },
  ];
  const show = rows.filter((x) => state.filter === "All" || x.round === state.filter);
  $("cap-table").innerHTML = `<tr><th>Holder</th><th>Class</th><th class="n">Shares</th><th class="n">Fully diluted ${RULES("r2")}</th><th class="n">Price paid</th></tr>` +
    show.map((x) => `<tr><td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:8px;background:${COLORS[x.k]}"></i>${label(x.k)}</td><td>${CLASS_OF[x.k]}</td><td class="n">${n(x.shares)}</td><td class="n">${pct(x.shares, fd)}</td><td class="n">${x.price}</td></tr>`).join("") +
    `<tr><td><b>Total</b></td><td></td><td class="n"><b>${n(fd)}</b></td><td class="n">100.00%</td><td></td></tr>`;
  $("csv-btn").onclick = () => {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ["holder,class,shares,fully_diluted_pct,price_paid", ...rows.map((x) => [q(label(x.k)), q(CLASS_OF[x.k]), x.shares, pct(x.shares, fd).replace("%", ""), q(x.price)].join(",")), `"Total",,${fd},100.00,`].join("\n") + "\n";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "rounds-cap-table.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  document.querySelectorAll<HTMLButtonElement>("#cap-filter .tab:not(#csv-btn)").forEach((b) => b.onclick = () => { state.filter = b.dataset.f!; renderCap(r); });
}

// ---------- investor + employee ----------
const GRANT = { shares: 100_000n, term: 48, cliff: 12 };
function renderPeople(r: Res) {
  const who = ["fund", ...state.safes.map((s) => s.id)];
  const k = who.includes(state.investor) ? state.investor : "fund";
  const isSafe = k !== "fund"; const s = state.safes.find((x) => x.id === k);
  const paid = isSafe ? BigInt(s!.amt) * M : BigInt(state.raise) * M;
  $("investor").innerHTML = `<div class="card-h"><span class="mono muted">INVESTOR VIEW</span><select id="inv" style="width:auto">${who.map((w) => `<option value="${w}" ${w === k ? "selected" : ""}>${label(w)}</option>`).join("")}</select></div>
  <div class="stat" style="grid-template-columns:1fr 1fr"><div><b>${n(r.holdings[k])}</b><span>Shares</span></div><div><b>${pct(r.holdings[k], r.fullyDiluted)}</b><span>Of fully diluted</span></div></div>
  <table><tr><td>Paid in</td><td class="n">${usd(paid)}</td></tr><tr><td>${isSafe ? "Converted at" : "Price per share"}</td><td class="n">${price4(isSafe ? r.safeConversionPriceMicro[k] : r.priceMicro)}</td></tr>${isSafe ? `<tr><td>Regime</td><td class="n">${r.safeRegime[k]}</td></tr>` : ""}<tr><td>Liquidation preference (1×)</td><td class="n">${usd(paid)}</td></tr><tr><td>Value at round price</td><td class="n">${usd(r.holdings[k] * r.priceMicro)}</td></tr></table>
  <p class="note" style="margin-top:12px">${isSafe ? "No shares existed until the Series A closed; the SAFE converted into a shadow preferred class." : "Funds are held in escrow until the board approves, then sent to the treasury."}</p>`;
  $<HTMLSelectElement>("inv").onchange = (e) => { state.investor = (e.target as HTMLSelectElement).value; renderPeople(r); };
  const v = vested({ totalShares: GRANT.shares, termMonths: GRANT.term, cliffMonths: GRANT.cliff }, state.month);
  const cliffPct = (GRANT.cliff / GRANT.term) * 100;
  $("employee").innerHTML = `<div class="card-h"><span class="mono muted">EMPLOYEE VIEW · EFE</span><span class="mono muted">${n(GRANT.shares)} OPTIONS · STRIKE ${price4(r.priceMicro)}</span></div>
  <div style="position:relative;height:44px;border:1px solid var(--line2);border-radius:8px;overflow:hidden;margin-bottom:6px"><div style="width:${(state.month / GRANT.term) * 100}%;height:100%;background:var(--green);opacity:.85;transition:width .3s"></div><div style="position:absolute;left:${cliffPct}%;top:0;bottom:0;border-left:1px dashed var(--fg)"></div></div>
  <div class="barlab" style="margin-top:0"><span>Month 0</span><span>Cliff · month ${GRANT.cliff}</span><span>Month ${GRANT.term}</span></div>
  <label class="mono muted" style="font-size:11px">MONTH ${state.month}</label><input type="range" id="month" min="0" max="48" value="${state.month}" aria-label="Months since grant"/>
  <table style="margin-top:10px"><tr><td>Vested ${RULES("r7")}</td><td class="n">${n(v)} (${pct(v, GRANT.shares)})</td></tr><tr><td>Cost to exercise vested</td><td class="n">${usd(exerciseCost(r.priceMicro, v), true)}</td></tr></table>
  <p class="note" style="margin-top:12px">Demo clock: on testnet one “month” lasts a few seconds (a contract parameter).</p>`;
  $<HTMLInputElement>("month").oninput = (e) => { state.month = +(e.target as HTMLInputElement).value; renderPeople(r); };
}

// ---------- exit ----------
function renderExit(r: Res) {
  const classes = Object.fromEntries(["safe1", "safe2", "fund"].map((k) => {
    const sf = state.safes.find((x) => x.id === k); const pref = k === "fund" ? BigInt(state.raise) * M : BigInt(sf?.amt ?? 0) * M;
    return [k, { shares: r.holdings[k] ?? 0n, preferenceMicro: pref }];
  }).filter(([k]) => (r.holdings[k as string] ?? 0n) > 0n));
  const w = waterfall({ classes, commonShares: { ada: r.holdings.ada, bayo: r.holdings.bayo }, options: { efe: { shares: GRANT.shares, strikeMicro: r.priceMicro } }, proceedsMicro: BigInt(state.proceeds) * M });
  const E = BigInt(state.proceeds) * M || 1n;
  const ids = ["ada", "bayo", "safe1", "safe2", "fund", "efe"].filter((k) => w.payoutsMicro[k] !== undefined);
  $("exit-card").innerHTML = `<div class="stat"><div><b>${usd(BigInt(state.proceeds) * M)}</b><span>Proceeds</span></div><div><b>${w.converts.length ? w.converts.map(label).join(", ") : "none"}</b><span>Convert to common ${RULES("r8")}</span></div><div><b>${usd(w.remainderMicro, true)}</b><span>Rounding remainder</span></div></div>
  <input type="range" id="proceeds" min="0" max="100000000" step="500000" value="${state.proceeds}" aria-label="Exit proceeds in dollars"/>
  <div style="margin-top:16px">${bars(ids.map((k) => [k, w.payoutsMicro[k]] as [string, bigint]), E)}</div>
  <table><tr><th>Holder</th><th>Takes</th><th class="n">Payout</th><th class="n">Share of proceeds</th></tr>${ids.map((k) => `<tr><td>${label(k)}</td><td>${k === "efe" ? (w.exercised.includes("efe") ? "exercises" : "out of the money") : classes[k] ? (w.converts.includes(k) ? "converts" : "preference") : "common"}</td><td class="n">${usd(w.payoutsMicro[k], true)}</td><td class="n">${pct(w.payoutsMicro[k], E)}</td></tr>`).join("")}</table>
  <p class="note" style="margin-top:12px">The unissued pool receives nothing. Efe's options exercise only above the strike. On testnet, “Run exit” is a contract call by an officer after the board approves the plan hash; this page only simulates.</p>`;
  $<HTMLInputElement>("proceeds").oninput = (e) => { state.proceeds = +(e.target as HTMLInputElement).value; renderExit(r); };
}

// ---------- form ----------
function renderForm() {
  const f = (id: string, lab: string, v: number, step = 1) => `<label for="${id}">${lab}</label><input type="number" id="${id}" value="${v}" step="${step}" min="0"/>`;
  $("form").innerHTML = f("pre", "Pre-money valuation ($)", state.pre, 500_000) + f("raise", "New money from Fund ($)", state.raise, 500_000) + f("pool", "Pool target (% of post-round)", state.pool, 1) +
    `<div class="row">${["ada", "bayo", "poolNow"].map((k) => `<div>${f(k, k === "poolNow" ? "Pool now" : k[0].toUpperCase() + k.slice(1) + " shares", (state as any)[k], 100_000)}</div>`).join("")}</div>` +
    state.safes.map((s, i) => `<div class="safe"><label>SAFE ${i + 1} · ${s.holder} · post-money cap</label><div class="row">${[f(`sa${i}`, "Amount $", s.amt, 50_000), f(`sc${i}`, "Cap $", s.cap, 500_000), f(`sd${i}`, "Discount %", s.disc, 5)].map((x) => `<div>${x}</div>`).join("")}</div></div>`).join("");
  const bind = (id: string, set: (v: number) => void) => $<HTMLInputElement>(id).oninput = (e) => { set(+(e.target as HTMLInputElement).value); renderModel(); };
  bind("pre", (v) => (state.pre = v)); bind("raise", (v) => (state.raise = v)); bind("pool", (v) => (state.pool = v));
  for (const k of ["ada", "bayo", "poolNow"] as const) bind(k, (v) => ((state as any)[k] = v));
  state.safes.forEach((s, i) => { bind(`sa${i}`, (v) => (s.amt = v)); bind(`sc${i}`, (v) => (s.cap = v)); bind(`sd${i}`, (v) => (s.disc = v)); });
}

// ---------- events + verify ----------
interface Dep { rpc: string; explorer: string; rounds: string | null; board: string | null; token: string | null; network: string }
interface Ev { name: string; tx: string; data: Record<string, any>; plan?: string }
async function view(dep: Dep, method: string, args: object) {
  const res = await fetch(dep.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: dep.rounds, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) });
  const j = await res.json(); if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}
async function initVerify() {
  const dep: Dep = await fetch("deployment.json").then((r) => r.json()).catch(() => ({ rpc: "https://test.rpc.fastnear.com", explorer: "https://explorer.testnet.near.org", rounds: null, board: null, token: null, network: "testnet" }));
  const evs: Ev[] = await fetch("events.json").then((r) => r.json()).catch(() => []);
  $("verify-sub").innerHTML = dep.rounds ? `Contract <span class="mono">${dep.rounds}</span> on ${dep.network}, board <span class="mono">${dep.board}</span>. Verify recomputes each plan with the engine and compares it with the chain.` : `No contract is configured in <span class="mono">deployment.json</span> yet, so Verify runs the engine self-check against the golden vector only.`;
  $("events").innerHTML = evs.length ? evs.map((e) => `<div class="ev"><b>${e.name}</b><span class="muted mono">${JSON.stringify(e.data)}</span><a class="mono" href="${dep.explorer}/transactions/${e.tx}" target="_blank" rel="noopener">tx ↗</a></div>`).join("") : `<p class="note">No events committed yet. After <span class="mono">make demo</span> they appear here, each with its transaction link.</p>`;
  $<HTMLButtonElement>("verify-btn").onclick = async () => {
    const out = $("verify-out"); const lines: string[] = []; let failed = 0;
    const P = (ok: boolean, msg: string) => { lines.push(`<span class="${ok ? "pass" : "fail"}">${ok ? "PASS" : "FAIL"}</span> ${msg}`); if (!ok) failed++; out.innerHTML = lines.join("\n"); };
    // 1. engine vs golden vector GV-1
    const gv = priceRound({ common: { ada: 5_000_000n, bayo: 2_750_000n }, unissuedPool: 1_000_000n, safes: [{ id: "safe1", holder: "chidi", amount: 500_000n * M, postMoneyCap: 5_000_000n * M, discountBps: 0 }, { id: "safe2", holder: "dayo", amount: 250_000n * M, postMoneyCap: 10_000_000n * M, discountBps: 0 }], preMoney: 21_000_000n * M, investors: { fund: 9_000_000n * M }, poolTarget: { num: 1n, den: 10n } });
    P(gv.priceMicro === 2_000_000n && gv.fullyDiluted === 15_000_000n && gv.holdings.fund === 4_500_000n, "engine reproduces GV-1: price $2.0000, 15,000,000 fully diluted, Fund 4,500,000");
    // 2. on-chain rounds
    for (const e of evs.filter((x) => x.name === "round_proposed")) {
      if (!dep.rounds) break;
      try {
        const rd = await view(dep, "round", { round_id: e.data.round_id });
        const local = e.plan ? await planHash(e.plan) : null;
        P(rd.plan_hash === e.data.plan_hash, `round ${e.data.round_id}: on-chain plan hash matches the proposal event`);
        P(local !== null && local === rd.plan_hash && rd.plan === e.plan, `round ${e.data.round_id}: committed plan recomputes to the on-chain hash`);
      } catch (err) { P(false, `round ${e.data.round_id}: could not read chain (${(err as Error).message.slice(0, 80)})`); }
    }
    lines.push(`\n${failed} failed`); out.innerHTML = lines.join("\n");
  };
}

// ---------- any contract, straight from the chain ----------
async function initChain() {
  const dep: Dep = await fetch("deployment.json").then((r) => r.json()).catch(() => ({ rpc: "https://test.rpc.fastnear.com", explorer: "https://explorer.testnet.near.org", rounds: null, board: null, token: null, network: "testnet" }));
  defaultContract = dep.rounds ?? ""; explorerBase = dep.explorer; initWalletUi(dep.explorer);
  const qs = new URLSearchParams(location.search);
  const input = $<HTMLInputElement>("contract"); input.value = qs.get("contract") ?? dep.rounds ?? "";
  const out = $("chain-out");
  const link = (contract: string, frag: string) => `${location.origin}${location.pathname}?contract=${encodeURIComponent(contract)}#${frag}`;
  const run = async () => {
    const id = input.value.trim().toLowerCase();
    if (!validAccount(id)) { out.innerHTML = `<p class="note"><span class="fail">FAIL</span> enter a NEAR account id such as <span class="mono">rounds-core-052090.testnet</span></p>`; return; }
    $("chain-actions").innerHTML = "";
    out.innerHTML = `<p class="note">Reading ${esc(id)} from ${esc(dep.rpc)} …</p>`;
    try {
      const v = await loadChain(dep.rpc, id);
      const only = /^#verify\/round-(\d+)$/.exec(location.hash)?.[1];
      let failed = 0;
      const rows: string[] = [];
      for (const r of v.rounds) {
        const c = await checkRound(r); if (!c.ok) failed++;
        const hl = only && +only === r.id ? ' style="background:rgba(68,255,164,.08)"' : "";
        rows.push(`<tr id="round-${r.id}"${hl}><td>Round ${r.id}</td><td>${esc(typeof r.kind === "string" ? r.kind : JSON.stringify(r.kind))}</td><td>${esc(r.status)}</td><td><span class="${c.ok ? "pass" : "fail"}">${c.ok ? "PASS" : "FAIL"}</span> <span class="mono muted">${esc(r.plan_hash.slice(0, 16))}…</span></td><td><a class="mono" href="${esc(link(id, "verify/round-" + r.id))}">link</a></td></tr>`);
      }
      const hold = v.holdings.map(([h, cl, sh]) => `<tr><td class="mono">${esc(h)}</td><td>${esc(cl)}</td><td class="n">${esc(BigInt(sh).toLocaleString("en-US"))}</td></tr>`).join("");
      const exits = v.exits.map((e) => `<tr><td>Exit ${e.id}</td><td>${e.approved ? "approved" : "pending"}</td><td class="mono muted">${esc(e.plan_hash.slice(0, 16))}…</td><td class="n">${esc((Number(BigInt(e.total)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 }))} USDC</td></tr>`).join("");
      out.innerHTML = `<div class="chain-h"><span class="mono muted">CONTRACT <b>${esc(v.contract)}</b> · BOARD ${esc(v.board)} · TOKEN ${esc(v.token)}</span></div>
        <table class="chain-tbl"><tr><th>HOLDER</th><th>CLASS</th><th class="n">SHARES (ON CHAIN)</th></tr>${hold || `<tr><td colspan="3" class="muted">no shares issued yet</td></tr>`}</table>
        <table class="chain-tbl"><tr><th>ROUND</th><th>KIND</th><th>STATUS</th><th>PLAN HASH RECOMPUTED HERE</th><th></th></tr>${rows.join("") || `<tr><td colspan="5" class="muted">no rounds</td></tr>`}</table>
        ${exits ? `<table class="chain-tbl"><tr><th>EXIT</th><th>STATE</th><th>PLAN HASH</th><th class="n">FUNDED</th></tr>${exits}</table><p class="note">Exit plan text is not stored on chain, only its hash and URI, so exit hashes are shown, not recomputed here.</p>` : ""}
        <pre class="out"><span class="${failed ? "fail" : "pass"}">${failed ? "FAIL" : "PASS"}</span> ${v.rounds.length} round plan(s) re-hashed in this browser; ${failed} mismatch(es)\nEverything above was read live from the chain; nothing came from this site's files.</pre>`;
      void renderActions($("chain-actions"), v, dep.rpc, dep.explorer, run);
      if (only) document.getElementById(`round-${only}`)?.scrollIntoView({ block: "center" });
    } catch (e) { out.innerHTML = `<p class="note"><span class="fail">FAIL</span> could not read <span class="mono">${esc(id)}</span>: ${esc((e as Error).message)}. It must be a deployed Rounds contract on ${esc(dep.network)}.</p>`; }
  };
  $("chain-btn").onclick = run;
  input.onkeydown = (e) => { if (e.key === "Enter") void run(); };
  if (qs.get("contract") || /^#verify\//.test(location.hash)) { await run(); }
}

renderForm(); renderModel(); void initChain(); void initVerify().then(() => { if (location.hash === "#verify-run") $<HTMLButtonElement>("verify-btn").click(); });
