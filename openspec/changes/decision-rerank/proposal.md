# Proposal

## Why

Large `grep` and `web_search` results hide useful findings behind an inline
cut. Rank admitted candidates against `objective`, show the most useful first,
and preserve the whole result in its artifact.

This change reconciles experimental PRs [#1584](https://github.com/leon0399/llame/pull/1584),
[#1588](https://github.com/leon0399/llame/pull/1588), and
[#1590](https://github.com/leon0399/llame/pull/1590) with the decisions agreed
with Leo on 2026-11-06. Prior art: [#1524](https://github.com/leon0399/llame/pull/1524)
and [#1581](https://github.com/leon0399/llame/pull/1581).

The [measurement record](https://github.com/leon0399/llame/pull/1590#issuecomment-6685284326)
shows `tenant-db.service.ts` first among 162 file runs (0.75), and the permission
evaluator first among 469 runs (0.81, two requests, 634 ms, $0.00369).
These spot checks establish feasibility, not general quality; labeled evaluation
is part of the implementation.

Issues served: [#1521](https://github.com/leon0399/llame/issues/1521),
[#1433](https://github.com/leon0399/llame/issues/1433), and
[#1435](https://github.com/leon0399/llame/issues/1435).
Tracking: [#1518](https://github.com/leon0399/llame/issues/1518) and
[#1430](https://github.com/leon0399/llame/issues/1430).

## What Changes

- Add `system-one` providers (`{ id, type, key, baseUrl, billing?, headers? }`)
  and a server-only `decisionModels[]` catalog (`{ id, provider, model }`).
  Chat and embedding models cannot reference decision providers.
- Judge cards through the System One wire, with the criterion and keyed cards
  in each request. Send groups of at most 256 cards in parallel. Honor the
  enclosing tool cancellation and deadline; ordinary request failures leave
  only their cards unjudged. There is no chat-model fallback.
- Add a shared engine: `{ status, order, scores, model, latencyMs, costUsd }`.
  `order` is a permutation; scored cards sort descending, ties are stable,
  and unjudged cards follow in canonical order. No relevance decision grants authority.
- Configure either tool with `rerank: { model }`; presence applies the order.
  There is no `mode`. Naming the model is consent to send everything the tool
  admits to that endpoint, including host, Knowledge, and Machine findings.
- Add optional `grep.objective`. Rank whole file runs only when the result
  cannot fit inline. Matches, walk bounds, admissions, counts, and stop stay
  unchanged. The inline part, artifact, and findings use one order.
- Rank every web `results` outcome regardless of engine, but never an answer.
  Deduplicate URLs before the guard and cards. A configured aggregate keeps
  every merged candidate for ranking and artifacts; each child's fetch bound
  remains. Without ranking, the old merged fetch-size cut remains.
- Skip judgment when the whole result fits inline. On ordinary backend failure,
  keep canonical order and show one failure line or note. Preserve note caps
  and the runner's timeout/cancellation observations.
- Store `display.rerank` as owner-only provenance: representative served model,
  applied order, judged scores, latency, aggregate reported cost or `null`,
  and grep run lengths. Show badges/scores for visible rows, never rank metadata in model text.
- Add labeled fixtures and `ranking:eval` / `ranking:record`. Report nDCG@5,
  MRR, latency, and cost against canonical order. Keep rubrics fixed in code.
- Keep decision calls outside message usage through an explicit exclusion.
  The side-call ledger is [#1592](https://github.com/leon0399/llame/issues/1592);
  AI SDK 7 transport replacement is [#1593](https://github.com/leon0399/llame/issues/1593).

No database change. Cross-encoder/LLM backends, recall and Knowledge search
consumers, gating thresholds, and broader sub-call provenance remain out of scope.

### Issue reconciliation

[#1520](https://github.com/leon0399/llame/issues/1520) is not planned: no local
ranker is built; labeled evaluation replaces that gate. Issue amendments on
the #1521, #1433, and #1430 records replace shadow criteria, local stage-1 ranking,
literal-anchor pinning, and fixed positions for unjudged findings. Scores leave the engine
only as owner display data. The existing remainder layout stays. Objective-aware
engines are eligible. #1518 stays open for its other consumers and backends.

## Capabilities

### New Capabilities

- `decision-models`: request/answer semantics, criterion state, parallel batches,
  request failure boundaries, enclosing cancellation, logging, and secrecy.

### Modified Capabilities

- `instance-config`: provider type, catalog, rerank blocks, and startup checks.
- `provider-request-headers`: empty defaults and the authored session-token refusal.
- `grep-tool`: objective, whole-run order, guard, failure field, and deadline margins.
- `web-search`: dedupe, aggregate retention, ranking, and bounded failure notes.
- `tool-result-rendering`: rank records, framing, owner badge, and score identity.
- `run-usage-accounting`: explicit exclusion of decision side calls pending #1592.

## Impact

API: `src/decisions/`, `src/ranking/`, instance configuration, tool runners,
grep/web search adapters, prompts, fixtures, and evaluation scripts.
UI: grep and web search parts plus stories. Operator/reference documentation,
configuration example/schema, CHANGELOG, and relevant ROADMAP entries accompany
the shipping layers. See [tasks.md](tasks.md) for ownership and verification.
