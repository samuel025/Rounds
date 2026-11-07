// The wallet layer must hand wallet-selector NAJ actions. Plain {type, params} objects made the real selector throw
// "Unsupported NAJ action" (found by a user with a real wallet; the test signer used in e2e-wallet.mjs bypasses the selector).
// The stand-in wallet module does what the real Meteor module does with the actions it receives: najActionToInternal(action),
// the very call that threw. MyNearWallet reads actions[i].functionCall directly, so the raw NAJ shape is checked too.
import { describe, expect, it } from "vitest";
import { setupWalletSelector, najActionToInternal } from "@near-wallet-selector/core";
import { najActions } from "../web/src/wallet";

const mem = () => { const m = new Map<string, string>(); return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) }; };

const seen: any[] = []; // shared: the selector library caches wallet instances per process
let shared: Promise<any> | null = null;
async function selectorWithRecorder() {
  seen.length = 0;
  if (shared) return { wallet: await shared, seen };
  const account = { accountId: "judge.testnet" };
  const factory = async () => ({
    id: "recorder", type: "injected",
    metadata: { name: "Recorder", description: "", iconUrl: "", downloadUrl: "", deprecated: false, available: true },
    init: async () => ({
      signIn: async () => [account], signOut: async () => {}, getAccounts: async () => [account],
      verifyOwner: async () => { throw new Error("n/a"); }, signMessage: async () => { throw new Error("n/a"); },
      signAndSendTransaction: async (p: any) => { seen.push({ raw: p.actions, actions: p.actions.map((x: any) => najActionToInternal(x)) }); return { status: { SuccessValue: "" }, transaction: { hash: "H" }, receipts_outcome: [] }; },
      signAndSendTransactions: async (p: any) => { seen.push({ via: "batch", raw: p.transactions[0].actions, actions: p.transactions[0].actions.map((x: any) => najActionToInternal(x)) }); return [{ status: { SuccessValue: "" }, transaction: { hash: "H" }, receipts_outcome: [] }]; },
    }),
  });
  const selector = await setupWalletSelector({ network: "testnet", storage: mem() as any, modules: [factory as any] });
  shared = (async () => { const w = await selector.wallet("recorder"); await w.signIn({ contractId: "" } as any); return w; })();
  return { wallet: await shared, seen };
}

describe("wallet actions reach the selector in a format it accepts", () => {
  it("JSON args and a 1 yocto deposit become a FunctionCall the wallet receives intact", async () => {
    const { wallet, seen } = await selectorWithRecorder();
    const acts = await najActions([{ method: "ft_transfer_call", args: { receiver_id: "r.testnet", amount: "5", msg: "{}" }, gasTgas: 200, depositYocto: "1" }]);
    await wallet.signAndSendTransaction({ receiverId: "t.testnet", actions: acts as any });
    const a = seen[0].actions[0];
    expect(a.type).toBe("FunctionCall");
    expect(a.params.methodName).toBe("ft_transfer_call");
    expect(a.params.gas).toBe("200000000000000");
    expect(a.params.deposit).toBe("1");
    expect(a.params.args).toEqual({ receiver_id: "r.testnet", amount: "5", msg: "{}" }); // the converter hands JSON args back parsed
    expect(seen[0].raw[0].functionCall.deposit).toBe(1n); // MyNearWallet reads the NAJ shape directly
  });

  it("raw byte args (propose_round's exact u64) survive untouched, and two calls keep their order", async () => {
    const { wallet, seen } = await selectorWithRecorder();
    const raw = '{"deadline_ns":1794000000000000000}';
    const acts = await najActions([{ method: "storage_deposit", args: { account_id: "judge.testnet" } }, { method: "propose_round", args: new TextEncoder().encode(raw), gasTgas: 100 }]);
    await wallet.signAndSendTransaction({ receiverId: "c.testnet", actions: acts as any });
    expect(seen.length).toBe(1);
    const [first, second] = seen[0].actions;
    expect([first.params.methodName, second.params.methodName]).toEqual(["storage_deposit", "propose_round"]);
    expect(second.params.args).toEqual({ deadline_ns: 1794000000000000000 }); // Meteor's converter parses JSON bytes, so very large numbers pass through a double: harmless for a deadline
  });

  it("the old plain-object format is rejected the way the user saw (regression guard)", async () => {
    const { wallet } = await selectorWithRecorder();
    const legacy = [{ type: "FunctionCall", params: { methodName: "m", args: {}, gas: "1", deposit: "0" } }];
    await expect(wallet.signAndSendTransaction({ receiverId: "c.testnet", actions: legacy as any })).rejects.toThrow(/Unsupported NAJ action/);
    // and what najActions() builds is never that shape
    const built: any = (await najActions([{ method: "m", args: {} }]))[0];
    expect(built.type).toBeUndefined(); expect(built.functionCall.methodName).toBe("m");
  });
});
