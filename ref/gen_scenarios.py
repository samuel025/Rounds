"""Seeded random scenarios shared by both implementations. All amounts are decimal strings."""
import json, random, sys

def gen(n: int, seed: int = 20261106):
    r = random.Random(seed)
    out = []
    M = 10**6
    for i in range(n):
        kind = ["round", "round", "waterfall", "waterfall", "vesting"][i % 5]
        if kind == "round":
            safes = []
            if i % 25 == 1:  # error paths: SAFE ratios summing to >= 1, or a pool target the pre-money cannot hold
                bad = r.choice(["safes", "pool"])
                cap = r.randint(3_000_000, 9_000_000) * M
                safes = [dict(id=f"s{j}", holder=f"h{j}", amount=str(cap * 6 // 10), cap=str(cap), discount_bps=0) for j in range(2)] if bad == "safes" else []
                out.append(dict(kind="round", common=dict(ada="5000000", bayo="2000000"), pool="500000", safes=safes, pre_money=str(10 * 10**6 * M),
                                investors=dict(fund=str(5 * 10**6 * M)), pool_target=[100 if bad == "pool" else 10, 100]))
                continue
            for j in range(r.randint(0, 3)):
                safes.append(dict(id=f"s{j}", holder=f"h{j}", amount=str(r.randint(10_000, 1_000_000) * M), cap=str(r.randint(3_000_000, 30_000_000) * M), discount_bps=r.choice([0, 0, 1000, 2000, 3000])))
            out.append(dict(kind="round", common=dict(ada=str(r.randint(1_000_000, 9_000_000)), bayo=str(r.randint(100_000, 5_000_000))), pool=str(r.randint(0, 2_000_000)), safes=safes,
                            pre_money=str(r.randint(10, 80) * 10**6 * M), investors=dict(fund=str(r.randint(1, 20) * 10**6 * M)), pool_target=[r.choice([0, 5, 10, 15, 20]), 100]))
        elif kind == "waterfall":
            classes = {}
            for j in range(r.randint(0, 4)):
                sh = r.randint(1, 3_000_000)
                classes[f"p{j}"] = dict(shares=str(sh), pref=str(sh * r.randint(100_000, 5_000_000)), rank=r.randint(0, 1))
            opts = {f"o{j}": dict(shares=str(r.randint(1, 500_000)), strike=str(r.randint(100_000, 6_000_000))) for j in range(r.randint(0, 2))}
            out.append(dict(kind="waterfall", classes=classes, common={f"c{j}": str(r.randint(1, 5_000_000)) for j in range(r.randint(1, 3))}, options=opts, proceeds=str((r.randint(0, 150_000_000) if r.random() < 0.7 else r.randint(0, max(1, sum(int(v["pref"]) for v in classes.values()) // M))) * M + r.choice([0, 0, r.randint(0, M - 1)]))))
        else:
            term = r.randint(1, 60)
            out.append(dict(kind="vesting", total=str(r.randint(1, 10_000_000)), term=term, cliff=r.randint(0, term), months=r.randint(0, term + 5)))
    return out

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    json.dump(gen(n), open(sys.argv[2] if len(sys.argv) > 2 else "results/conformance-scenarios.json", "w"))
