---
okf_version: "0.2"
---

# Live Jev applications and permission classifiers

Noncanonical development research across ten llame application families, plus
Claude Code, Codex Guardian and eve permission-classifier comparisons for
[#778](https://github.com/leon0399/llame/issues/778). No production behavior or
approved OpenSpec scope changes.

- [Application results and prompt corrections](./applications.md) - 80 cases
  across ten families and 16 controlled permission-prompt comparisons.
- [Application fixtures](./experiments/applications-fixtures.jsonl),
  [raw responses](./experiments/applications-results.jsonl) and
  [summary](./experiments/applications-summary.json) - Frozen labels and reusable
  inputs for exact values, dates, routing, effort, completion, evidence and memory.
- [Permission-classifier report](./report.md) - Models, policy ordering, local
  configuration and the original prompt-design trial, with its later correction.
- [Sources](./sources.jsonl), [evidence](./evidence.jsonl) and
  [claims](./claims.jsonl) - Source identities and traceable findings.
- [Sanitized configuration observation](./local-config-observation.json) -
  Relevant settings and versions; no credentials or private infrastructure names.
- [Manifest](./run_manifest.json), [verification](./verification.json) and
  [review disposition](./review.json) - Scope, executed checks and the explicit
  decision not to request another review round.
- [Frozen fixtures](./experiments/fixtures.mjs) - Policy, expected labels and
  synthetic command/script/evidence cases. Labels are not sent to the model.
- [Native HTTP runner](./experiments/run.mjs) - No SDK upgrade; no candidate
  command execution; bounded calls, explicit resume and no model fallback.
- [Primary requests and responses](./experiments/results.jsonl) - 95 successful
  evaluations with exact request hashes, answers, usage and cost metadata.
- [Failed attempts](./experiments/failed-attempts.jsonl) and
  [transport record](./experiments/transport.json) - 95 ZDR setup rejections,
  five capacity failures and their resolution. Missing billing cost stays unknown.
- [Run plans](./experiments/run-plans.json) and [initial smoke](./experiments/smoke.json) -
  Frozen dataset hash, original thresholds, scheduling changes and protocol proof.
- [Post-hoc diagnostic requests and results](./experiments/diagnostic-results.jsonl) -
  Six unchanged controls versus six explicit-criteria questions. Replay their
  exact request bodies through the shared runner; not a held-out validation set.
- [Offline analysis](./experiments/analyze.py) and
  [derived summary](./experiments/summary.json) - Confusion counts, threshold
  coverage, script inspection, intent pairs, repeats and question batching.

Related studies: [System One/Jev](../2026-09-23-system-one-jev/index.md),
[semantic find/JUDGE](../2026-09-24-semantic-find-judge/index.md),
[question-directed reads](../2026-09-23-question-directed-read/index.md), and the
[harness index](../../harnesses/index.md).

## Reproduce offline

From the repository root, with Node 22.19+ and Python 3.10+. The following commands
need no credentials, model calls or project dependency changes:

```bash
node docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/run.mjs plan
python3 docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/analyze.py docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/results.jsonl /tmp/permission-summary.json docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/diagnostic-results.jsonl
```

The analysis verifies request hashes, model identity, answer keys and probability
ranges before deriving results. Compare parsed JSON with the retained summary;
formatting may differ after the repository formatter.

## Repeat live deliberately

The recorded calls used the September 24, 2026 promotion. Future price and
availability are not guaranteed. The runner stops after a successful response
reports nonzero or missing cost; that first request can already be charged.
Revisit that guard only with an explicit experiment budget.

`AI_GATEWAY_API_KEY` is read from `apps/api/.env.local` through Node's `parseEnv`.
It is never written into results.
Use a new output path; existing evidence is never overwritten:

```bash
node docs/research/tool-harness/2026-09-24-permission-classifier-cascade/experiments/run.mjs live /tmp/new-permission-results.jsonl
```

An optional fourth argument names prior raw results. Only successful matching
request hashes are skipped; this is an explicit resume, not an automatic retry.
Capacity failures are recorded and followed by a 15-second pause before the next
independent case. Other HTTP/transport errors stop scheduling. The final runner
uses one request at a time with two-second pacing, a 95-case default suite and
a hard cap of 100 logical requests per invocation.

The shared runner also has `diagnostic-plan` and `diagnostic-live` modes for the
retained diagnostic request bodies. `--fixtures <file.jsonl>` selects another
frozen application suite. Keep each suite's output separate.

All fixture commands and scripts are data. The runners never execute them.
Production use needs separate provider-disclosure authorization, privacy policy,
calibration and the durable approval contract from #778.
