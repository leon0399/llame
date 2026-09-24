#!/usr/bin/env python3
"""Compare frozen synthetic labels with live typed answers; no network calls."""
import hashlib
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

fixtures = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text().splitlines()]
assert len({row['id'] for row in fixtures}) == len(fixtures)
assert len({row['id'] for row in rows}) == len(rows)
by_id = {row['id']: row for row in rows}
assert set(by_id) <= {row['id'] for row in fixtures}
families = defaultdict(list)
details = []
for fixture in fixtures:
    row = by_id.get(fixture['id'])
    if row is None or row.get('httpStatus') != 200:
        families[fixture['family']].append(False)
        details.append({'id': fixture['id'], 'family': fixture['family'], 'status': 'no successful answer'})
        continue
    assert row['model'] == 'typesafe-ai/jev'
    assert row['request']['state'] == fixture['state']
    assert row['request']['questions'] == fixture['questions']
    assert row['expected'] == fixture['expected']
    encoded = json.dumps(row['request'], ensure_ascii=False, separators=(',', ':')).encode()
    assert hashlib.sha256(encoded).hexdigest() == row['requestHash']
    assessments = {}
    for name, expected in fixture['expected'].items():
        answer = row['answers'][name]
        if answer['type'] == 'choice':
            actual = answer['choice']
            matched = actual == expected
            probability = answer['probabilities'][expected]
        elif answer['type'] == 'boolean':
            actual = answer['probability'] >= 0.5
            matched = actual == expected
            probability = answer['probability'] if expected else 1 - answer['probability']
        elif answer['type'] == 'score':
            actual = answer['score']
            matched = abs(actual - expected) <= 0.5
            probability = answer['probabilities'].get(str(expected))
        else:
            raise AssertionError('Unexpected answer type')
        assert probability is None or (math.isfinite(probability) and 0 <= probability <= 1)
        assessments[name] = {'expected': expected, 'actual': actual, 'matched': matched, 'probabilityForExpected': probability}
    matched = all(item['matched'] for item in assessments.values())
    families[fixture['family']].append(matched)
    details.append({'id': fixture['id'], 'family': fixture['family'], 'variant': fixture.get('variant'), 'matched': matched, 'assessments': assessments})

successful = [row for row in rows if row.get('httpStatus') == 200]
latencies = sorted(row['elapsedMs'] for row in successful)
summary = {
    'plannedCases': len(fixtures),
    'successfulCases': len(successful),
    'matchedCases': sum(sum(values) for values in families.values()),
    'byFamily': {family: {'matched': sum(values), 'cases': len(values)} for family, values in sorted(families.items())},
    'inputTokens': sum(row['usage']['inputTokens'] for row in successful),
    'reportedCostUsd': sum(float(row['gateway']['cost']) for row in successful),
    'reportedMarketCostUsd': sum(float(row['gateway']['marketCost']) for row in successful),
    'latencyMs': {'median': statistics.median(latencies), 'p95NearestRank': latencies[math.ceil(len(latencies) * 0.95) - 1]} if latencies else None,
    'grading': {'choice': 'exact selected label', 'boolean': 'probability >= 0.5', 'score': 'within 0.5 of the expected rubric rung', 'case': 'every expected question matches'},
    'details': details,
    'limitations': ['Small synthetic, policy-defined fixture sets; not production calibration or a held-out workload benchmark.', 'Labels and rubrics were frozen before inference; errors are retained rather than relabeled.', 'Score agreement is a declared half-rung tolerance, not categorical exact accuracy.', 'No routed tool, memory write, compaction, project move or permission action was executed.'],
}
Path(sys.argv[3]).write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key not in ['details', 'limitations']}, indent=2))
