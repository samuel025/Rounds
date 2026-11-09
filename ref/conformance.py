"""Compare the Python reference with the TypeScript engine on shared random scenarios."""
import hashlib, json, subprocess, sys, os
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
# RFC 8785 canonical JSON across the two implementations (open Q4). Keys sort by UTF-16 code units,
# which differs from Python's default code-point order once a supplementary character is involved.
def utf16_key(s):
    return s.encode("utf-16-be")

def canonical_json(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, int):
        return str(v)
    if isinstance(v, list):
        return "[" + ",".join(canonical_json(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical_json(v[k]) for k in sorted(v, key=utf16_key)) + "}"
    raise ValueError(f"unsupported canonical value: {type(v).__name__}")

subprocess.run(["npx", "vite-node", "scripts/canonical-ts.ts", "vectors/canonical.json", "results/canonical-ts.json"], check=True, stdout=subprocess.DEVNULL)
ts_canon = json.load(open("results/canonical-ts.json"))
cases = json.load(open("vectors/canonical.json"))["cases"]
bad_canon = []
for case, ts in zip(cases, ts_canon):
    py = canonical_json(case["value"])
    digest = hashlib.sha256(py.encode("utf-8")).hexdigest()
    if py != ts["canonical"] or digest != ts["hash"]:
        bad_canon.append((case["name"], py, ts["canonical"]))

summary = dict(scenarios=N, by_kind=counts, rejected_inputs=errors, mismatches=len(bad),
               canonical_cases=len(cases), canonical_mismatches=len(bad_canon))
json.dump(summary, open("results/conformance-summary.json", "w"), indent=1)
print(json.dumps(summary))
for i, s, a, b in bad[:5]:
    print(f"MISMATCH #{i} {s['kind']}\n  input: {json.dumps(s)[:400]}\n  python: {json.dumps(a)[:400]}\n  ts:     {json.dumps(b)[:400]}")
for name, py, ts in bad_canon:
    print(f"CANONICAL MISMATCH {name}\n  python: {py[:400]}\n  ts:     {ts[:400]}")
sys.exit(1 if bad or bad_canon else 0)
