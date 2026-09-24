# Reusable live Jev experiments

All commands and scripts inside fixture state are data. The runner never executes
them. Live calls use only `typesafe-ai/jev` at Gateway's native evaluation endpoint.
The recorded September 24, 2026 calls reported zero promotional cost; future
pricing is not guaranteed. The first nonzero-cost response can already be charged
before the runner stops.

## Suites and evidence

- `fixtures.mjs`, `results.jsonl`, `summary.json`: original 95-call matrix,
  including 76 permission rows. Treat it as a prompt-design pilot.
- `diagnostic-results.jsonl`: twelve post-hoc Boolean-rubric calls; replay with
  `diagnostic-plan` or `diagnostic-live` on the shared runner.
- `permission-prompt-fixtures.jsonl`, `permission-prompt-results.jsonl`,
  `permission-prompt-summary.json`: sixteen controlled context/rubric comparisons.
- `applications-fixtures.jsonl`, `applications-results.jsonl`,
  `applications-summary.json`: eighty cases across ten application families.
  `routing-fixtures.jsonl` and `evidence-fixtures.jsonl` retain the two authoring
  slices that were merged before inference.
- `failed-attempts.jsonl`, `applications-failures.jsonl`, `transport.json`,
  `run-plans.json`, `application-plans.json`, `smoke.json`: setup failures,
  capacity errors, frozen plans and transport provenance. Missing cost is unknown.

Labels and expected reasons are excluded from model requests. Raw responses
preserve request hashes, typed answers, usage and cost metadata. No stronger
classifier or production action was executed.

## Reproduce from the repository root

```bash
node docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/run.mjs plan --fixtures docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/applications-fixtures.jsonl
python3 docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/analyze-applications.py docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/applications-fixtures.jsonl docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/applications-results.jsonl /tmp/jev-applications-summary.json
```

Use Node 22.19+ and Python 3.10+. Offline commands need no credentials. For a
budget-authorized live run, change `plan` to `live /tmp/new-results.jsonl`;
`AI_GATEWAY_API_KEY` comes from `apps/api/.env.local`. Existing output files are
not overwritten. An optional prior-results path after the output path skips only
successful identical request hashes. Capacity errors pause before the next
independent case; there are no automatic retries or model/provider fallbacks.

`analyze.py` handles the original matrix and optional rubric diagnostic.
`analyze-applications.py` handles any frozen application or permission-prompt
suite, checking state, questions, labels and request hashes before grading.
