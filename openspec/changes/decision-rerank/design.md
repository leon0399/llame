# Design

## Context

The experiment is `decisions/grep-rerank` at `cb57e0ee`; shipped specs remain authoritative.
`grep-tool` owns admission/walk order, `web-search` owns fusion/artifacts, and
`tool-result-rendering` permits owner-only display data. Accounting and header deltas
explicitly reconcile their canonical exceptions. See [proposal.md](proposal.md).

llame pins ai 6.0.256/provider 3.0.15; SDK decisions require ai 7/provider 4.
OMP `88a69582c7` (`packages/ai/src/judgment/`) supplies protocol/failure prior art,
not its chat fallback or candidate cap. The [measurement record](https://github.com/leon0399/llame/pull/1590#issuecomment-6685284326)
distinguishes synthetic fixtures, real walks, wire probes, and pre-fix runs.

## Goals / Non-Goals

One ranking contract, unchanged authority, complete retained findings, visible ordinary
failures, measured quality. No ledger, alternate backend, threshold, shadow switch,
model fallback, rubric override, or SDK upgrade in this change.

## Decisions

### D1. Reconcile the experimental PRs

Retain #1584/#1588/#1590: rename their remote branches, rebuild each layer from its
approved parent using only owned files, and force-push with a lease. Split config,
client, and service rather than publish the oversized experimental client.

### D2. Close completed outcomes

Grep closes #1521; web search closes #1433/#1435. Issue #1520 is not planned.
Issue amendments replace shadow/local-stage/literal-anchor/fixed-position criteria.
Issues #1518/#1430 remain open for other consumers/backends.

### D3. Share the ranking kernel

`rankCards({ judge, model, objective?, query, cards, rubric })` returns
`{ status, order, scores, model, latencyMs, costUsd }`; status is ranked/partial/unavailable.
Validate a complete permutation, sort scores stably, and append unjudged keys canonically.
Tools own cards/layout. Extraction at two callers is deliberate: #1521 owns this
kernel, and #1510 is next; separate tool-local implementations would duplicate it.

### D4. Consent by tool configuration

Naming a model authorizes disclosure of everything the tool admits, including
`kb://` and `machine://` findings. Document this egress consequence. No refused
finding becomes a card; relevance never bypasses read admission.
The lane protects its resolved credential before ranking excerpts and dispatch.
Tools apply the same exact-key replacement to returned presentation, not underlying
files or matches. This adds no generic credential detector or consent gate.

### D5. Defer the ledger

The accounting delta excludes decision requests from message usage, measured context,
reasoning, cost, and completeness. Issue #1592 absorbs #1439 and broader sub-call
provenance before subagents. Keep the specified per-call structured log, not a ledger.

### D6. Display provenance

Store representative served model, applied order, judged scores, whole-call latency,
and aggregate accepted-response wire cost. Use the first accepted response's model
in request order; cost is unknown if any accepted response lacks it. No accepted
response means null model/cost and no display record. Receipts remain unchanged.

### D7. Skip fully visible results

The guard checks both count and rendered size, after deduplication. Empty grep results
need no judgment; no other minimum-card floor remains. Judging fully visible results
adds cost without selecting what the model sees.

### D8. Presence enables ranking

`rerank: { model }` only. Delete mode/shadow configuration and behavior; labeled
evaluation replaces the experimental switch.

### D9. Preserve ordinary fallback and enclosing aborts

Ordinary total failure keeps canonical order: grep gets its framing line, web search
its final note. Reserve room; removal stays first within ten notes, with excess engine
notes summarized. Missing answers invalidate their whole request. Partial success
retains complete successful requests; enclosing timeout/cancellation uses the runner.

### D10. Retain every aggregate candidate

Rank every results engine, never answers. Configured aggregates retain the whole
deduplicated RRF set for guard/rank/artifact, bounded by summed child admissions.
Child fetch/vendor bounds stay. No new candidate cap; without ranking keep the old
merged fetch-size cut. Ordinary rank failure preserves the full retained RRF set.

### D11. Evaluate labeled cases

Fixtures contain at most 40 hand-labeled cards: synthetic retry, real tenant-db and
permission walks, and RLS/SECURITY DEFINER web results. `ranking:record` writes live
answers; `ranking:eval` compares nDCG@5, MRR, cost, and latency with canonical order.
Report generated churn separately. Operator keys are required; CI stays deterministic.
Separate 300+ card cases verify complete parallel batching, not model quality.

### D12. Keep the wire adapter until SDK upgrade

Use POST `/systemone`; #1593 tracks ai 7 replacement. Each catalog id binds a client.
Boot rejects decision providers for chat/embeddings; keep a defensive factory guard.
Common billing stays; default headers are empty; authored session tokens fail startup.
Requests carry query/objective, their own cards/criteria/task, and keyed questions.
Send all 256-card groups concurrently. Grep fallback joins patterns with `" | "`.
Ten-second attempts, three bounded transient attempts, and retry-after up to five
seconds share the enclosing abort signal/deadline. Cancel oversized streamed bodies
at 1 MiB; malformed requests contribute no usage. Catalog diagnostics use safe indices.

### D13. Keep fixed, bounded rubrics

Web cards contain title/host/snippet in 400 UTF-16 units; grep cards contain bounded
path/line excerpts in 384 units. Keys use canonical zero-based padded indices.
Question instructions are fixed; source text stays untrusted data. A rubric change
requires evaluation. No history, semantic deduplication, or answerability gate.

### D14. Preserve run identity in text and UI

Show badge/scores only for present rows. Grep stores authoritative `runLengths`
aligned with applied order; artifact blocks, native live/replay rendering, and UI
consume them, including a truncated final inline run. Path/start reconstruction
can merge distinct runs after reordering; test same-path/increasing-start runs.
Source text resembling rank metadata stays intact. Parameters include `objective`.

## Risks / Trade-offs

Hosted endpoints receive admitted private text. Excerpts can miss useful evidence;
URL/page fetching and structural cards remain separate changes. Parallel large calls
cost more; walk/child/artifact bounds and cancellation constrain work. Injection can
corrupt relevance, not authority. Fixtures support only their measured quality claims.

## Migration Plan

No database migration or compatibility path. Absent blocks preserve shipped behavior;
remove blocks to roll back. Delete experiment-only mode/pricing before production.
Upgrade API and workers to a supporting revision before enabling the new configuration.
For rollback, remove the new keys before restoring older binaries. Stored display
records require no migration or rewrite.

## Open Questions

None affecting the contract; operator model choice follows fixture evaluation.

## Revision history

- v1/v2: Initial decisions and canonical/boot/layer reconciliation.
- v3/v4: Request atomicity, key/run identity, full aggregate retention, common billing.
- v5: Accounting/header exceptions, enclosing aborts, criterion/fallback, note bounds.
- v6: Stream bounds, aggregate provenance, indexed diagnostics, explicit run lengths,
  source preservation, visible-row scores, and recomputed omission counts.
- v7: Explicit usage types, unsafe served-id rejection, and exact decision-key
  presentation replacement across inline/artifact/replay without source-file mutation.
