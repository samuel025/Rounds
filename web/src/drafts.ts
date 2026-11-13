// Shareable drafts: the modeler's terms in a link (#draft=…), a file fallback, and the investors' split of the raise.
// Nothing here talks to a server or a chain. A link is untrusted input: decodeDraft validates and size-limits it, and every name is escaped when drawn.
import { esc, validAccount } from "./chain";
import { toast } from "./actions";
import { encodeDraft, decodeDraft, validateDraft, type Draft } from "../../src/engine/draft";

export interface DraftHost {
  get(): Draft;
  /** apply a validated draft to the modeler; returns a note about anything that could not be applied */
  set(d: Draft): string | null;
  locked(): boolean;
  redraw(): void;
}

const clip = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function initDrafts(host: DraftHost) {
  const card0 = document.getElementById("draft-card"); if (!card0) return; const card: HTMLElement = card0;
  let banner = "", err = "", link = "";
  const refreshLink = async () => { try { link = `${location.origin}${location.pathname}${location.search}#${await encodeDraft(host.get())}`; err = ""; } catch (e) { link = ""; err = (e as Error).message; } };
  async function draw() {
    await refreshLink();
    const d = host.get(), locked = host.locked();
    const rows = d.allocs.map((a, i) => `<div class="row" style="display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:8px;align-items:end;margin-bottom:6px"><div><label for="al-h${i}">Investor ${i + 1} account</label><input type="text" id="al-h${i}" value="${esc(a.holder)}" autocomplete="off" spellcheck="false"/></div><div><label for="al-b${i}">Share of the raise (%)</label><input type="number" id="al-b${i}" value="${a.bps / 100}" min="0.01" max="100" step="0.01"/></div><button class="btn sm" data-al-rm="${i}" aria-label="Remove investor ${i + 1}">Remove</button></div>`).join("");
    const sum = d.allocs.reduce((a, b) => a + b.bps, 0);
    card.innerHTML = `<div class="card-h"><span class="mono muted">SHARE A DRAFT · NEGOTIATE WITHOUT TOUCHING THE CHAIN</span></div>
      ${banner ? `<div class="flow-banner" style="border:1px solid var(--line2);border-radius:8px;padding:8px 12px;margin-bottom:10px">${banner}</div>` : ""}
      <p class="note">The link carries the numbers above (the round, the company and the SAFEs, and the split between investors) in its <span class="mono">#</span> part, which your browser never sends to a server. Anyone who opens it sees the same plan and can change it and send a new link back. It carries no account, no keys and no confidential table. It is <b>asynchronous</b>: each change makes a new link, there is no live co-editing.</p>
      ${locked ? `<p class="note">This is tied to the open sandbox company, so a draft link carries only the round's terms (valuation, new money, pool); the founders, pool and SAFEs always come from the chain.</p>` : `<div style="margin-top:8px"><span class="fl">Investors in this round</span>${rows || `<p class="note" style="margin:4px 0">One investor: whoever proposes (the connected wallet). Add named investors to split the new money between them, and each can sign off on their own row.</p>`}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px"><button class="btn sm" id="al-add">Add an investor</button>${d.allocs.length ? `<button class="btn sm" id="al-even">Split evenly</button><span class="${sum === 10_000 ? "muted" : "fail"}" style="font-size:12.5px">${(sum / 100).toFixed(2)}% allocated${sum === 10_000 ? "" : " (must be 100%)"}</span>` : ""}</div></div>`}
      <div style="margin-top:12px"><label for="draft-note">Note for the next person (kept in the link, 280 characters)</label><input type="text" id="draft-note" maxlength="280" value="${esc(d.note)}" placeholder="e.g. lead wants 12% pool, SAFE caps unchanged"/></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary sm" id="draft-copy" ${link ? "" : "disabled"}>Copy draft link</button><button class="btn sm" id="draft-dl">Download draft file</button><label class="btn sm" style="margin:0;cursor:pointer">Load a draft file<input type="file" id="draft-file" accept=".json,application/json" style="display:none"/></label></div>
      ${err ? `<p class="note"><span class="fail">${esc(err)}</span></p>` : link ? `<p class="note mono" style="word-break:break-all;margin-top:8px">${esc(clip(link, 120))} <span class="muted">(${link.length.toLocaleString("en-US")} characters)</span></p>` : ""}`;
    const bind = () => {
      const upd = (f: (x: Draft) => void) => { const x = host.get(); f(x); const m = host.set(x); if (m) toast(esc(m), "info"); host.redraw(); void draw(); };
      d.allocs.forEach((_, i) => {
        (document.getElementById(`al-h${i}`) as HTMLInputElement).onchange = (e) => { const v = (e.target as HTMLInputElement).value.trim().toLowerCase(); if (!validAccount(v)) { toast(`<span class="fail">FAIL</span> an investor needs a NEAR account name such as <span class="mono">lead.testnet</span>`, "fail"); void draw(); return; } upd((x) => { x.allocs[i].holder = v; }); };
        (document.getElementById(`al-b${i}`) as HTMLInputElement).onchange = (e) => { const b = Math.round(Number((e.target as HTMLInputElement).value) * 100); if (!Number.isFinite(b) || b < 1 || b > 10_000) { void draw(); return; } upd((x) => { x.allocs[i].bps = b; }); };
      });
      card.querySelectorAll<HTMLButtonElement>("[data-al-rm]").forEach((b) => (b.onclick = () => upd((x) => { x.allocs.splice(+b.dataset.alRm!, 1); if (x.allocs.length === 1) x.allocs[0].bps = 10_000; })));
      const add = document.getElementById("al-add") as HTMLButtonElement | null; if (add) add.onclick = () => upd((x) => { const n = x.allocs.length; const held = x.allocs.reduce((a, b) => a + b.bps, 0); x.allocs.push({ holder: `investor${n + 1}.testnet`, bps: n === 0 ? 10_000 : Math.max(1, 10_000 - held) }); if (n > 0 && held >= 10_000) { const even = Math.floor(10_000 / x.allocs.length); x.allocs.forEach((a, i) => (a.bps = i === x.allocs.length - 1 ? 10_000 - even * (x.allocs.length - 1) : even)); } });
      const even = document.getElementById("al-even") as HTMLButtonElement | null; if (even) even.onclick = () => upd((x) => { const e = Math.floor(10_000 / x.allocs.length); x.allocs.forEach((a, i) => (a.bps = i === x.allocs.length - 1 ? 10_000 - e * (x.allocs.length - 1) : e)); });
      (document.getElementById("draft-note") as HTMLInputElement).onchange = (e) => { const x = host.get(); x.note = (e.target as HTMLInputElement).value.slice(0, 280); host.set(x); void draw(); };
      (document.getElementById("draft-copy") as HTMLButtonElement).onclick = async () => { await refreshLink(); if (!link) return; try { await navigator.clipboard.writeText(link); toast("Draft link copied. Whoever opens it sees these exact numbers; nothing was uploaded.", "ok"); } catch { toast(`Copy this link: <span class="mono">${esc(link)}</span>`, "info"); } };
      (document.getElementById("draft-dl") as HTMLButtonElement).onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(host.get(), null, 2)], { type: "application/json" })); a.download = "rounds-draft.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
      (document.getElementById("draft-file") as HTMLInputElement).onchange = async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; if (f.size > 64_000) { toast(`<span class="fail">FAIL</span> that file is larger than a draft can be`, "fail"); return; }
        try { const d2 = validateDraft(JSON.parse(await f.text())); const m = host.set(d2); banner = `Loaded the draft file <b>${esc(f.name.slice(0, 60))}</b>. Review the numbers before relying on them.${m ? ` ${esc(m)}` : ""}${d2.note ? `<br/>Note: “${esc(d2.note)}”` : ""}`; host.redraw(); void draw(); }
        catch (x) { toast(`<span class="fail">FAIL</span> not a usable draft: ${esc((x as Error).message)}`, "fail"); } };
    };
    bind();
  }
  // a draft in the address: validate, apply, say so. A bad link is reported and ignored; it never half-applies.
  if (location.hash.startsWith("#draft=")) {
    try { const d = await decodeDraft(location.hash); const m = host.set(d); host.redraw(); banner = `<b>Loaded from a draft link.</b> Nothing was sent anywhere; check every number before you rely on it.${m ? ` ${esc(m)}` : ""}${d.note ? `<br/>Note from the sender: “${esc(d.note)}”` : ""}`;
      requestAnimationFrame(() => document.getElementById("model")?.scrollIntoView()); }
    catch (e) { banner = `<span class="fail">This draft link could not be used:</span> ${esc((e as Error).message)}. The example numbers are shown instead.`; }
  }
  window.addEventListener("rounds:model", () => { void draw(); });
  await draw();
}
