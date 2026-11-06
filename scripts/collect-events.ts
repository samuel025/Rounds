// Re-collects the contract events of a finished demo run from its transaction list (results/demo-txs.json).
// Retries every RPC call and fails loudly instead of skipping a transaction. Read-only.
import { readFileSync, writeFileSync } from "node:fs";
const RPC = "https://rpc.testnet.near.org";
const txs: { step: string; tx: string; what: string; signer?: string }[] = JSON.parse(readFileSync("results/demo-txs.json", "utf8"));
const plans = JSON.parse(readFileSync("results/demo-plans.json", "utf8"));
async function status(tx: string, signer: string): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const r: any = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: tx, sender_account_id: signer, wait_until: "FINAL" } }) })).json();
      if (r.error || !r.result) throw new Error(JSON.stringify(r.error ?? r).slice(0, 100));
      return r.result;
    } catch (e) { if (i >= 6) throw new Error(`tx ${tx} (${signer}) unreadable: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
}
const events: any[] = [];
for (const t of txs) {
  if (!t.tx || !t.signer) continue;
  const res = await status(t.tx, t.signer);
  for (const ro of res.receipts_outcome ?? []) for (const l of ro.outcome.logs as string[]) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    const e = JSON.parse(l.slice(11)); if (e.standard !== "rounds") continue;
    events.push({ name: e.event, tx: t.tx, data: e.data, plan: e.event === "round_proposed" ? plans.rounds[String(e.data.round_id)] : undefined });
  }
}
writeFileSync("results/demo-events.json", JSON.stringify(events, null, 1));
writeFileSync("web/public/events.json", JSON.stringify(events, null, 1));
console.log(`${events.length} events collected from ${txs.length} transactions`);
