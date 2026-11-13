import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { encryptTo, decryptFrom, sealForMany, openEnvelope, envelopeHash, encryptJsonTo, decryptJsonFrom } from "../src/engine/envelope";

const kp = () => { const secretKey = x25519.utils.randomSecretKey(); return { secretKey, publicKey: x25519.getPublicKey(secretKey) }; };
const te = new TextEncoder(), td = new TextDecoder();

describe("sealed data", () => {
  it("round-trips for the right key and refuses another", async () => {
    const a = kp(), b = kp(); const s = await encryptTo(a.publicKey, te.encode("claim data"));
    expect(td.decode(await decryptFrom(a.secretKey, s))).toBe("claim data");
    await expect(decryptFrom(b.secretKey, s)).rejects.toThrow(/not sealed for your key/);
  });
  it("a changed ciphertext is refused", async () => {
    const a = kp(); const s = await encryptTo(a.publicKey, te.encode("x"));
    const bad = { ...s, ct: s.ct.slice(0, -4) + (s.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(decryptFrom(a.secretKey, bad)).rejects.toThrow();
  });
  it("two encryptions of one message differ (fresh ephemeral key and iv)", async () => {
    const a = kp(); const x = await encryptTo(a.publicKey, te.encode("m")), y = await encryptTo(a.publicKey, te.encode("m"));
    expect(x.ct).not.toBe(y.ct); expect(x.epk).not.toBe(y.epk);
  });
  it("json helper", async () => { const a = kp(); expect(await decryptJsonFrom(a.secretKey, await encryptJsonTo(a.publicKey, { n: 1 }))).toEqual({ n: 1 }); });
});

describe("one body, a wrapped key per council member", () => {
  it("every named member opens it; an outsider and a wrong id cannot", async () => {
    const m = [kp(), kp(), kp()], out = kp();
    const env = await sealForMany(te.encode("the private table"), m.map((k, i) => ({ id: `m${i}.testnet`, publicKey: k.publicKey })));
    for (let i = 0; i < 3; i++) expect(td.decode(await openEnvelope(env, `m${i}.testnet`, m[i].secretKey))).toBe("the private table");
    await expect(openEnvelope(env, "m0.testnet", out.secretKey)).rejects.toThrow();
    await expect(openEnvelope(env, "nobody.testnet", m[0].secretKey)).rejects.toThrow(/not sealed for/);
    await expect(openEnvelope(env, "m0.testnet", m[1].secretKey)).rejects.toThrow();
  });
  it("the body is stored once, so the envelope grows by one small wrap per member", async () => {
    const big = new Uint8Array(20_000).fill(7);
    const one = await sealForMany(big, [{ id: "a.testnet", publicKey: kp().publicKey }]);
    const five = await sealForMany(big, Array.from({ length: 5 }, (_, i) => ({ id: `m${i}.testnet`, publicKey: kp().publicKey })));
    expect(JSON.stringify(five).length - JSON.stringify(one).length).toBeLessThan(1500);
  });
  it("tampering with the body breaks it, and the hash changes", async () => {
    const m = kp(); const env = await sealForMany(te.encode("t"), [{ id: "a.testnet", publicKey: m.publicKey }]);
    const h = await envelopeHash(env);
    const tampered = { ...env, ciphertext: env.ciphertext.slice(0, -4) + (env.ciphertext.endsWith("AAAA") ? "BBBB" : "AAAA") };
    expect(await envelopeHash(tampered)).not.toBe(h);
    await expect(openEnvelope(tampered, "a.testnet", m.secretKey)).rejects.toThrow();
    expect(await envelopeHash({ ...env, wraps: [...env.wraps] })).toBe(h); // stable
  });
  it("rejects no recipients and duplicate recipients", async () => {
    await expect(sealForMany(te.encode("x"), [])).rejects.toThrow();
    const k = kp(); await expect(sealForMany(te.encode("x"), [{ id: "a", publicKey: k.publicKey }, { id: "a", publicKey: k.publicKey }])).rejects.toThrow(/twice/);
  });
});
