# Design

## Context

The experiment is at `decisions/grep-rerank` (`cb57e0ee`); the canonical specs
remain authoritative. See [proposal.md](proposal.md) for scope and issues.

- `grep-tool:325-330,984-988` defines canonical walk/passage order. Ranking
  changes presentation after the walk, never admission or traversal effects.
- `web-search:197-205,696-708` owns aggregate fusion and complete-result artifacts.
  Its merged fetch-size cut must move for configured ranking, not hide candidates.
- `tool-result-rendering:43-50` permits stored `display` data outside model text.
- `run-usage-accounting:11,414` needs an explicit side-call exclusion while the
  ledger is deferred; `model-system-prompts:1070-1076` keeps receipts system-prompt-only.
- `provider-request-headers:100-124` needs an explicit exception for authored
  `{session:id}` on `system-one`; other interpolation behavior stays unchanged.
- llame pins `ai` 6.0.256 / provider 3.0.15. SDK decisions require ai 7/provider 4.
  OMP (`88a69582c7`, `packages/ai/src/judgment/`) supplies the prior-art protocol
  and failure patterns, but its chat fallback and candidate cap are not adopted.
- Research F11/F12 and the [measurement record](https://github.com/leon0399/llame/pull/1590#issuecomment-6685284326)
  distinguish synthetic fixtures, real walks, wire-limit probes, and pre-fix runs.

## Goals / Non-Goals

One ranking contract, unchanged authority, complete retained findings, visible
ordinary failures, and measured quality. No ledger, alternate ranking backend,
threshold, model fallback, shadow mode, rubric override, or SDK upgrade here.

## Decisions

### D1. Reconcile the experimental PRs

Retain #1584/#1588/#1590 but rebuild reviewable layers from the approved proposal.
Rename their remote branches, import each layer's owned files, and force-push
with a lease. Split config, client, and service to meet the review budget.
Closing and reimplementing the experiment would duplicate review without benefit.

### D2. Close only the completed outcomes

The grep layer owns `Closes #1521`; web search owns #1433/#1435.
Issue #1520 is not planned. Tracker and issue amendments record the replaced criteria
(shadow, local stage-1, literal anchors, unjudged absolute positions).
Issues #1518/#1430 stay open for remaining consumers/backends.

### D3. Share the ranking kernel

`rankCards({ judge, model, objective?, query, cards, rubric })` returns
`{ status, order, scores, model, latencyMs, costUsd }`.
Statuses are `ranked`, `partial`, `unavailable`; the last means no card answered.
Validate that `order` is a permutation of every input key. Sort judged keys by
score, stable on canonical position; append unjudged keys in canonical order.
Tools own cards and layout. Extracting at two callers is a deliberate exception
to the rule of three: #1521 explicitly owns this kernel, with #1510 next.

### D4. Consent by tool configuration

Naming the model authorizes disclosure of everything the tool admits, including
`kb://` and `machine://` grep findings. Document the endpoint and source-text
consequence. Leo rejected a per-data-class declaration; relevance never bypasses
`read` admission, and no refused finding becomes a card.

### D5. Defer the ledger, specify the exclusion

Decision requests do not contribute to message usage, measured context, reasoning,
cost, or completeness. The `run-usage-accounting` delta makes this explicit;
it does not implement accounting. #1592 absorbs #1439 and includes the broader
sub-call provenance redesign before subagents. One log line per call remains:
`tool`, `model`, `cards`, `requests`, `judged`, `inputTokens`, `outputTokens`,
`costUsd`, `latencyMs`. Folding side calls into context measurements was rejected.

### D6. Use display provenance, not prompt receipts

`display.rerank` stores served `model`, all keys in applied `order`, judged
`scores`, whole-call `latencyMs`, and wire-reported `costUsd` or `null`.
A failed call stores no record. No fallback price: every probed route reports
cost, and an unpriced endpoint remains unknown. Receipts are unchanged.

### D7. Skip judgment when everything fits inline

Grep tests both file count and rendered size. Web search tests deduplicated
count against `limit` and rendered size against 15,000 units. No minimum-card
floor remains. Judging small visible sets would add cost without selecting
what the model can see.

### D8. Presence enables ranking

`rerank: { model }` only. Remove `mode` and shadow behavior from types, schema,
code, fixtures, and docs; the labeled evaluation replaces the trial switch.

### D9. Distinguish ordinary failure from enclosing abort

An ordinary total failure keeps canonical order: grep stores
`ranking: "unavailable"`, rendered after warnings and before ignored lines;
web search appends `rerank: unavailable`. Reserve framing/note room.
Keep a removal note first and the failure note last within ten notes; summarize
excess engine notes in the last available engine slot. Partial requests retain
valid scores. A missing answer invalidates its entire request, not one card.
The enclosing timeout/cancellation instead uses the runner's existing observation.

### D10. Rank every results engine and retain aggregate candidates

Answers remain unranked. With ranking configured, retain the whole deduplicated
aggregate set in canonical RRF order for the guard, rank stage, and artifact.
Each child keeps its fetch/vendor bound; the retained set cannot exceed their
summed admitted counts. No new candidate cap is introduced. Without ranking,
keep the old merged fetch-size cut. Decision failure preserves the full retained
RRF set, not a smaller subset. Objective-aware engines are not exempt.

### D11. Evaluate labeled cases

Hand-label at most 40 cards per fixture: synthetic retry (F12), subsets of the
real tenant-db and permission walks, and RLS/SECURITY DEFINER web results.
Fixtures hold `{ tool, query, objective?, cards: [{ key, text, relevant }] }`.
`ranking:eval` reports nDCG@5, MRR, latency, and cost against canonical order.
`ranking:record` regenerates answer JSON used by deterministic tests; report its
generated churn separately. Live calls need operator keys, not CI secrets.
These small fixtures test quality; separate 300+ card cases test complete batching.

### D12. Keep the wire adapter until the SDK upgrade

Use `POST {baseUrl}/systemone` with `{ model, state, questions }` and parse
`{ model, answers, usage }`. #1593 tracks `experimental_decide` after ai 7.
The provider carries the wire; two gateway wires may share a credential through
separate entries. One client per catalog id binds the configured route.
Startup rejects chat/embedding references to decision providers; a defensive
factory case keeps the expanded provider union exhaustive in the config layer.
Common optional `billing` stays. Default headers are empty; authored session
tokens fail startup, but interpolated output is never rescanned.

The service groups cards with their questions, 256 per request, and sends all
requests together. Each request carries only its own cards. The fixed state
contains query, optional objective, cards, criteria, and the untrusted `task`.
Grep's fallback query joins patterns with `|`. No chat history is needed.
Each request is atomic; merge complete successful requests and leave only
failed requests' keys unjudged. Unknown catalog ids fail closed.

Ten seconds per attempt, three attempts for 408/429/5xx or transport failure,
and retry-after up to five seconds are carried bounds, not measured guarantees.
The measured batch/parallel bounds come from the wire probes. Combine the
trusted enclosing `ToolContext.abortSignal` with per-attempt timeout, abort
retry waits, and start no retry after cancellation. Grep's scan deadline leaves
a margin; ranking consumes only the remaining enclosing budget, never a fresh one.
A body over 1 MiB or a malformed response makes its request unavailable.

### D13. Keep fixed rubrics and bounded cards

Web cards: `[k] title — host — snippet`, at most 400 UTF-16 units.
Grep cards: path plus at most three matching lines, at most 384 units.
Use zero-based canonical keys padded to the width of the last index.
Each question names its key and uses the fixed rubric, never card-authored text.
The state carries the actual objective or query; instruction-like card content
stays data. A rubric change requires a new evaluation.

### D14. Show owner scores with correct identity

Both tool parts show served model, latency, cost, and scores. Grep preserves
consecutive file runs rather than globally grouping by path. Run ordinal maps
to `display.rerank.order`; its key selects the score. Use the native renderer's
boundary rule (different file or non-increasing start line). Stories cover
repeated paths from overlapping scopes after reordering, partial, absent, and
failed ranking. The Parameters panel also shows `objective`.

## Risks / Trade-offs

- Pointwise scores do not remove semantic duplicates or prove answerability.
  No threshold/gate is introduced; fixture results constrain quality claims.
- Card excerpts can miss the useful part of a file/page. Page-fetch judging
  and code-structure cards are separate changes, not hidden fallbacks.
- Hosted providers receive admitted private text. Tool configuration is explicit
  consent; operators can select their own endpoint instead.
- Large results cost more, but requests are parallel and cancellation stops them.
  Child fetch bounds and the grep walk/artifact bounds still constrain inputs.
- Injection can corrupt relevance, not authority: cards are untrusted data,
  rubrics are fixed, and no denied file reaches the judge.

## Migration Plan

No database migration. Absence of catalog/rerank blocks preserves shipped behavior;
remove the blocks to roll back. The experiment-only `mode` and pricing fields
are removed before production. Prompt receipts and message usage remain unchanged.

## Open Questions

None that changes the contract. Operator model choice follows fixture evaluation.

## Revision history

- v1/v2: Initial decisions; canonical-order, reserves, headers, boot checks, and layers reconciled.
- v3: Request atomicity, key boundaries, factory exhaustiveness, and UI run identity.
- v4: Complete aggregate retention; common billing preserved; duplicate rules consolidated.
- v5: Explicit accounting/header carve-outs, enclosing aborts, criterion transmission,
  grep fallback, bounded notes, model-endpoint wording, and aggregate input bounds.
