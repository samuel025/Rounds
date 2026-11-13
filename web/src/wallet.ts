// NEAR wallet connection (wallet-selector v10, testnet). Loaded lazily so the first paint stays small.
// No access key is requested: every transaction is approved in the wallet, nothing is signed in the background.
import type { WalletSelector } from "@near-wallet-selector/core";

export const NETWORK = "testnet";
let selector: WalletSelector | null = null;
let modal: { show(): void; hide(): void } | null = null;
let current: string | null = null;
const listeners = new Set<(a: string | null) => void>();
const emit = () => listeners.forEach((f) => f(current));

export const account = () => current;
export const onAccount = (f: (a: string | null) => void) => { listeners.add(f); f(current); return () => listeners.delete(f); };

// Dev-server only (stripped from production builds): scripts/e2e-wallet.mjs injects a signer backed by throwaway testnet keys.
const testWallet = (): { account: string; send(receiver: string, acts: unknown[]): Promise<unknown>; signMessage?(message: string, recipient: string, nonce: Uint8Array): Promise<SignedMsg> } | null =>
  import.meta.env.DEV ? ((window as any).__testWallet ?? null) : null;

export async function initWallet() {
  const tw = testWallet(); if (tw) { current = tw.account; emit(); return; }
  if (selector) return;
  const g = globalThis as any; if (!g.Buffer) g.Buffer = (await import("buffer")).Buffer; // wallet libraries expect Node's Buffer
  if (!g.global) g.global = globalThis;
  if (!g.process) g.process = { env: {}, browser: true, version: "", versions: {}, nextTick: (f: (...a: unknown[]) => void, ...a: unknown[]) => queueMicrotask(() => f(...a)) };
  const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
    import("@near-wallet-selector/core"), import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/my-near-wallet"), import("@near-wallet-selector/meteor-wallet"),
  ]);
  await import("@near-wallet-selector/modal-ui/styles.css");
  selector = await setupWalletSelector({ network: NETWORK, modules: [setupMyNearWallet(), setupMeteorWallet()] });
  modal = setupModal(selector, { theme: "dark" });
  const read = () => { current = selector!.store.getState().accounts.find((a) => a.active)?.accountId ?? null; emit(); };
  selector.store.observable.subscribe(read); read();
}

export async function connect() { await initWallet(); if (!testWallet()) modal!.show(); }
export async function disconnect() {
  if (!selector) return;
  try { const w = await selector.wallet(); await w.signOut(); } catch { /* already signed out */ }
  current = null; emit();
}

export interface Sent { hash: string | null; value: unknown }
const GAS = (tgas: number) => (BigInt(tgas) * 10n ** 12n).toString();
export const gas = GAS;

export interface Act { method: string; args: object | Uint8Array; gasTgas?: number; depositYocto?: string }

/** Sign and send one transaction (one or more function calls to one receiver). Browser wallets redirect away and come back
 *  with ?transactionHashes=…, handled by readReturn(); popup wallets resolve here with the outcome. */
export async function send(receiverId: string, acts: Act[]): Promise<Sent> {
  if (!current) throw new Error("connect a wallet first");
  const tw = testWallet();
  if (tw) return interpret(await tw.send(receiverId, acts.map((a) => ({ method: a.method, args: a.args instanceof Uint8Array ? new TextDecoder().decode(a.args) : JSON.stringify(a.args), gasTgas: a.gasTgas ?? 100, depositYocto: a.depositYocto ?? "0" }))));
  const w = await selector!.wallet();
  const here = new URL(location.href); ["transactionHashes", "errorCode", "errorMessage"].forEach((k) => here.searchParams.delete(k));
  const out: any = await (w as any).signAndSendTransaction({ receiverId, callbackUrl: here.toString(), actions: await najActions(acts) });
  if (!out) return { hash: null, value: null }; // redirected to the wallet
  return interpret(out);
}

function interpret(out: any): Sent {
  const failure = out.status?.Failure ?? out.receipts_outcome?.map((r: any) => r.outcome?.status?.Failure).find(Boolean);
  if (failure) throw new Error(describeFailure(failure));
  const sv = out.status?.SuccessValue; let value: unknown = null;
  try { value = sv ? JSON.parse(atob(sv)) : null; } catch { value = null; }
  return { hash: out.transaction?.hash ?? out.transaction_outcome?.id ?? null, value };
}

/** wallet-selector v10 takes NAJ actions (near-api-js action objects); plain {type, params} objects fail with "Unsupported NAJ action". */
export async function najActions(acts: Act[]) {
  const { actionCreators } = await import("@near-wallet-selector/core");
  return acts.map((a) => actionCreators.functionCall(a.method, a.args, BigInt(GAS(a.gasTgas ?? 100)), BigInt(a.depositYocto ?? "0")));
}

export function describeFailure(f: any): string {
  const e = f?.ActionError?.kind?.FunctionCallError?.ExecutionError ?? f?.ActionError?.kind ?? f;
  return String(typeof e === "string" ? e : JSON.stringify(e)).replace(/^Smart contract panicked: /, "").slice(0, 240);
}

/** After a browser wallet redirects back: report the result and clean the URL. */
export function readReturn(): { hash?: string; error?: string } | null {
  const u = new URL(location.href); const h = u.searchParams.get("transactionHashes"); const err = u.searchParams.get("errorMessage") ?? u.searchParams.get("errorCode");
  if (!h && !err) return null;
  ["transactionHashes", "errorCode", "errorMessage"].forEach((k) => u.searchParams.delete(k));
  history.replaceState(null, "", u.pathname + u.search + u.hash);
  return h ? { hash: h.split(",").pop()! } : { error: decodeURIComponent(err!) };
}

export interface SignedMsg { accountId: string; publicKey: string; signature: string }
/** Asks the connected wallet to sign a message (NEP-413). Returns the signature as base64, whatever form the wallet used. The wallet shows the message and recipient. */
export async function signMessage(message: string, recipient: string, nonce: Uint8Array): Promise<SignedMsg> {
  if (!current) throw new Error("connect a wallet first");
  const tw = testWallet(); let out: any;
  if (tw) { if (!tw.signMessage) throw new Error("the test signer cannot sign messages"); out = await tw.signMessage(message, recipient, nonce); }
  else {
    const w: any = await selector!.wallet();
    if (typeof w.signMessage !== "function") throw new Error("this wallet cannot sign messages; use a holder key file instead");
    out = await w.signMessage({ message, recipient, nonce: (globalThis as any).Buffer.from(nonce) });
  }
  if (!out || !out.signature || !out.publicKey) throw new Error("the wallet did not return a signature (was the request closed?)");
  let sig: string = String(out.signature);
  if (sig.startsWith("ed25519:")) { const { base58 } = await import("@scure/base"); sig = btoa(String.fromCharCode(...base58.decode(sig.slice(8)))); }
  if (out.accountId && out.accountId !== current) throw new Error(`the wallet signed as ${out.accountId}, not as ${current}`);
  return { accountId: current, publicKey: String(out.publicKey), signature: sig };
}
