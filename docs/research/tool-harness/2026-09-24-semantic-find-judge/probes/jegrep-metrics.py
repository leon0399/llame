"""Exercise pinned jegrep scoring functions; no CLI search or model calls.

Requires Python 3.10+ and Git. Reads case metadata, not the target repositories.
The extracted scorer is unchanged; synthetic results test what its metrics mean.
"""

import ast
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
from decimal import Decimal

root = Path(sys.argv[1]).resolve()
revision = "e6d5b842e5e88e576c3fcab9e2aa25081cb643af"
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == revision
source = subprocess.check_output(["git", "show", f"{revision}:benches/run.py"], cwd=root, text=True)
names = {"matches_path", "merge", "length", "intersection", "score"}
nodes = [node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name in names]
assert {node.name for node in nodes} == names
namespace = {"statistics": statistics}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "pinned-jegrep-scoring", "exec"), namespace)
score = namespace["score"]
case = {"expected": ["source.ts"], "irrelevant": [], "spans": [{"file": "source.ts", "start": 1, "end": 100}]}
result = {"hits": [{"path": "source.ts", "ranges": [{"start": 1, "end": 1, "p": 0.9}]}, {"path": "unjudged.ts", "ranges": [{"start": 1, "end": 5, "p": 0.8}]}]}
open_score = score(case, result)
closed_score = score(case, result, closed_world=True)
assert open_score["file_recall"] == open_score["span_recall"] == 1
assert open_score["line_recall"] == 0.01
assert open_score["unjudged"] == 1 and open_score["precision"] is None and open_score["fp"] == 0
assert closed_score["fp"] == 1 and closed_score["precision"] == 0.5
far_case = {"expected": ["source.ts"], "irrelevant": [], "spans": [{"file": "source.ts", "start": 100, "end": 101}]}
far_result = {"hits": [{"path": "source.ts", "ranges": [{"start": line, "end": line, "p": probability} for line, probability in [(1, 0.99), (3, 0.98), (5, 0.97)]] + [{"start": 100, "end": 101, "p": 0.96}]}]}
assert score(far_case, far_result)["span_recall"] == 0
assert score(far_case, far_result, top_ranges=4)["span_recall"] == 1
suites = {}
for name in ["linux", "kubernetes", "cpython", "postgres"]:
    files = sorted((root / "benches" / name).glob("query*.json"))
    cases = [json.loads(file.read_text()) for file in files]
    suites[name] = {"queries": len(cases), "negative_or_exhaustive_cases": sum(bool(case.get("irrelevant") or case.get("exhaustive")) for case in cases), "tag": json.loads((root / "benches" / name / "tag.json").read_text())}
assert sum(suite["queries"] for suite in suites.values()) == 40
assert sum(suite["negative_or_exhaustive_cases"] for suite in suites.values()) == 0
artifacts = ["benches/comparison-evidence.json", "benches/cascade-evidence.json", "benches/recommended.json", "bench/runs", "benches/runs"]
# Maximize sum(ceil(passages_in_file/3)) for 40 passages over <=20 files,
# with at most24 passages/file. This is a logical-call bound, not HTTP attempts.
best = {0: 0}
for _ in range(20):
    updated = {}
    for used, value in best.items():
        for count in range(min(24, 40 - used) + 1):
            updated[used + count] = max(updated.get(used + count, 0), value + math.ceil(count / 3))
    best = updated
verify_max = max(best.values())
assert verify_max == 26
logical_calls = math.ceil(128 / 64) + math.ceil((20 * 24) / (18000 // 384)) + verify_max
assert logical_calls == 39
comparison_saving = (Decimal("0.232162") - Decimal("0.145097")) / Decimal("0.232162") * 100
fields = ["file_recall", "span_recall", "line_recall", "precision", "precision_lower_bound", "fp", "unjudged"]
print(json.dumps({
    "revision": revision,
    "scorer_sha256": hashlib.sha256(source.encode()).hexdigest(),
    "scope": "Unchanged pure scorer on synthetic hits; metadata inventory and arithmetic, no benchmark rerun or inference",
    "one_line_of_one_hundred": {key: open_score[key] for key in fields},
    "same_hits_with_exhaustive_labels": {key: closed_score[key] for key in fields},
    "fourth_range": {"default_top3_span_recall": 0, "top4_span_recall": 1},
    "suites": suites,
    "referenced_artifacts_present": {name: (root / name).exists() for name in artifacts},
    "default_omp_logical_call_upper_bound": {"names": 2, "sketches": 11, "verification": verify_max, "total": logical_calls},
    "reported_jegrep_cost_reduction_percent_recomputed": str(comparison_saving),
    "hypothetical_25000_native_input_tokens_usd_at_quoted_rate": str(Decimal(25000) * Decimal("0.042") / Decimal(1000000)),
}, indent=2))
