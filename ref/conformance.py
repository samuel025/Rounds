"""Compare the Python reference with the TypeScript engine on shared random scenarios."""
import json, subprocess, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import rounds_ref, gen_scenarios

N = int(sys.argv[1]) if len(sys.argv) > 1 else 500
os.makedirs("results", exist_ok=True)
scen = gen_scenarios.gen(N)
json.dump(scen, open("results/conformance-scenarios.json", "w"))
subprocess.run(["npx", "vite-node", "scripts/conformance-ts.ts", "results/conformance-scenarios.json", "results/conformance-ts.json"], check=True, stdout=subprocess.DEVNULL)
ts = json.load(open("results/conformance-ts.json"))

def norm(x):
    if isinstance(x, dict):
        return {k: norm(v) for k, v in x.items()}
    if isinstance(x, list):
        return [norm(v) for v in x]
    if isinstance(x, bool):
        return x
    if isinstance(x, int):
        return str(x)
    return x

def pick(d, kind):
    if "error" in d:
        return d
    keys = dict(round=["price", "x_shares", "pool_top_up", "fd", "holdings", "safe_price", "regime"], waterfall=["converts", "exercised", "payouts", "remainder"], vesting=["vested"])[kind]
    return {k: d[k] for k in keys}

bad, counts = [], {"round": 0, "waterfall": 0, "vesting": 0}
errors = 0
for i, s in enumerate(scen):
    a, b = norm(pick(rounds_ref.run(s), s["kind"])), norm(pick(ts[i], s["kind"]))
    counts[s["kind"]] += 1
    errors += "error" in a
    if a != b:
        bad.append((i, s, a, b))
summary = dict(scenarios=N, by_kind=counts, rejected_inputs=errors, mismatches=len(bad))
json.dump(summary, open("results/conformance-summary.json", "w"), indent=1)
print(json.dumps(summary))
for i, s, a, b in bad[:5]:
    print(f"MISMATCH #{i} {s['kind']}\n  input: {json.dumps(s)[:400]}\n  python: {json.dumps(a)[:400]}\n  ts:     {json.dumps(b)[:400]}")
sys.exit(1 if bad else 0)
