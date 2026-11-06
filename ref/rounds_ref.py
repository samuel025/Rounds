"""Second implementation of the Rounds equity rules, written from RULES.md.
Exact arithmetic with fractions.Fraction. Algorithms differ on purpose from the TypeScript engine
(subset enumeration for SAFE regimes, greedy conversion for the waterfall) so a disagreement points at an ambiguity in RULES.md.
Independence caveat: the same agent wrote both implementations in one session."""
from fractions import Fraction as F
from itertools import product
from math import floor

STEP = 100  # R1: price is a multiple of 100 micro-dollars (4 decimals of a dollar)


def fl(x: F) -> int:
    return floor(x)


def floor_price(p: F) -> int:
    return fl(p / STEP) * STEP


# ---------------------------------------------------------------- R3-R6
def price_round(inp: dict) -> dict:
    common = {k: int(v) for k, v in inp["common"].items()}
    pool = int(inp["pool"])
    safes = [dict(id=s["id"], holder=s["holder"], a=int(s["amount"]), c=int(s["cap"]), d=F(int(s["discount_bps"]), 10000)) for s in inp["safes"]]
    V = int(inp["pre_money"])
    inv = {k: int(v) for k, v in inp["investors"].items()}
    t = F(int(inp["pool_target"][0]), int(inp["pool_target"][1]))
    issued = sum(common.values())
    N = issued + pool
    I = sum(inv.values())
    Vp = V + I
    if sum(F(s["a"], s["c"]) for s in safes) >= 1:
        raise ValueError("sum of SAFE ratios must be below 1")
    if V - t * Vp <= 0:
        raise ValueError("pool target too large")

    def solve_safes(P: int):
        """R4: find the cap/discount regime that is self-consistent at round price P (subset enumeration)."""
        n = len(safes)
        found = []
        for regime in product((True, False), repeat=n):  # True = converts at cap
            sp = sum((F(s["a"], s["c"]) for s, r in zip(safes, regime) if r), F(0))
            if sp >= 1:
                continue
            disc_shares = sum((F(s["a"]) / (P * (1 - s["d"])) for s, r in zip(safes, regime) if not r), F(0))
            cap = (N + disc_shares) / (1 - sp)
            ok = True
            for s, r in zip(safes, regime):
                cap_price = F(s["c"]) / cap
                disc_price = P * (1 - s["d"])
                if r and not cap_price <= disc_price:
                    ok = False
                if (not r) and not cap_price > disc_price:
                    ok = False
            if ok:
                found.append((regime, cap))
        if not found:
            raise ValueError("no consistent SAFE regime")
        # several consistent regimes can only differ by ties; prefer the most cap conversions
        regime, cap = max(found, key=lambda x: sum(x[0]))
        shares = []
        for s, r in zip(safes, regime):
            shares.append(fl(F(s["a"], s["c"]) * cap) if r else fl(F(s["a"]) / (P * (1 - s["d"]))))
        return regime, cap, shares

    def price_from(safe_total: int) -> int:
        X = issued + safe_total
        p = (V - t * Vp) / X
        if t * Vp / p < pool:  # no top-up needed
            p = F(V, X + pool)
        return floor_price(p)

    P = price_from(0)
    regime, cap, shares = solve_safes(P)
    for it in range(1000):
        nP = price_from(sum(shares))
        if nP == P:
            break
        P = nP
        regime, cap, shares = solve_safes(P)
    else:
        raise RuntimeError("did not converge")
    X = issued + sum(shares)
    wanted = fl(t * Vp / P)
    top_up = max(0, wanted - pool)
    holdings = dict(common)
    prices, regs = {}, {}
    for s, r, sh in zip(safes, regime, shares):
        holdings[s["id"]] = sh
        regs[s["id"]] = "cap" if r else "discount"
        prices[s["id"]] = fl(F(s["c"]) / cap) if r else fl(P * (1 - s["d"]))
    for k, amt in inv.items():
        holdings[k] = holdings.get(k, 0) + amt // P
    holdings["unissued_pool"] = pool + top_up
    return dict(price=P, x_shares=X, pool_top_up=top_up, fd=sum(holdings.values()), holdings=holdings, safe_price=prices, regime=regs)


# ---------------------------------------------------------------- R7
def vested(total: int, term: int, cliff: int, months: int) -> int:
    if months < cliff:
        return 0
    if months >= term:
        return total
    return total * months // term


# ---------------------------------------------------------------- R8
def waterfall(inp: dict) -> dict:
    E = int(inp["proceeds"])
    classes = {k: dict(sh=int(v["shares"]), pref=int(v["pref"]), rank=int(v.get("rank", 0))) for k, v in inp["classes"].items()}
    common = {k: int(v) for k, v in inp["common"].items()}
    options = {k: dict(sh=int(v["shares"]), strike=int(v["strike"])) for k, v in inp.get("options", {}).items()}
    common_total = sum(common.values())
    ps = lambda k: F(classes[k]["pref"], classes[k]["sh"])
    order = sorted(classes, key=lambda k: (ps(k), k))
    opt_order = sorted(options, key=lambda k: (options[k]["strike"], k))

    def evaluate(converting: set):
        # preferences to non-converters, by rank then pro rata inside a rank
        pref, avail, short = {}, E, False
        holders = [k for k in order if k not in converting]
        for r in sorted({classes[k]["rank"] for k in holders}):
            grp = [k for k in holders if classes[k]["rank"] == r]
            need = sum(classes[k]["pref"] for k in grp)
            if avail >= need:
                for k in grp:
                    pref[k] = classes[k]["pref"]
                avail -= need
            else:
                for k in grp:
                    pref[k] = classes[k]["pref"] * avail // need
                avail, short = 0, True
                break
        for k in holders:
            pref.setdefault(k, 0)
        rem = 0 if short else E - sum(pref.values())
        base = common_total + sum(classes[k]["sh"] for k in converting)
        pps, ex = F(rem, base), []
        for m in range(1, len(opt_order) + 1):
            grp = opt_order[:m]
            cand = F(rem + sum(options[k]["strike"] * options[k]["sh"] for k in grp), base + sum(options[k]["sh"] for k in grp))
            if cand > options[grp[-1]]["strike"]:
                pps, ex = cand, list(grp)
            else:
                break
        return pref, pps, ex

    converting = set()
    pref, pps, ex = evaluate(converting)
    for k in order:  # greedy: lowest preference per share first; convert while it pays at least the preference
        trial = converting | {k}
        p2, pps2, ex2 = evaluate(trial)
        if pps2 >= ps(k):
            converting, pref, pps, ex = trial, p2, pps2, ex2
        else:
            break
    payouts = {}
    for h, sh in common.items():
        payouts[h] = fl(sh * pps)
    for k in converting:
        payouts[k] = fl(classes[k]["sh"] * pps)
    for k in order:
        if k not in converting:
            payouts[k] = pref[k]
    for k in ex:
        payouts[k] = fl(options[k]["sh"] * pps) - options[k]["strike"] * options[k]["sh"]
    return dict(converts=sorted(converting), exercised=sorted(ex), payouts=payouts, remainder=E - sum(payouts.values()))


def run(s: dict) -> dict:
    try:
        if s["kind"] == "round":
            return price_round(s)
        if s["kind"] == "waterfall":
            return waterfall(s)
        if s["kind"] == "vesting":
            return dict(vested=vested(int(s["total"]), int(s["term"]), int(s["cliff"]), int(s["months"])))
    except (ValueError, RuntimeError, ZeroDivisionError) as e:
        return dict(error=True)
    raise ValueError("unknown scenario kind")
