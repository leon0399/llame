# Design

## Context

See [proposal.md](proposal.md) for motivation. The experimental stack
(#1584, #1588, #1590, worktree tip `cb57e0ee`) already holds a working
implementation; this design records the decisions that turn it into shipped
behavior and names what the implementation layers must change.

Current state that shapes the approach:

- `openspec/specs/grep-tool/spec.md:325-330` defines the walk order as the
  canonical order of the call, and `:984-988` orders passages by scope
  ordinal, walk order, then start line. The inline part and the artifact
  use that one order. `grep`'s input is strict and has no `objective`.
- `openspec/specs/web-search/spec.md:12-19` already accepts `objective`;
  `:197-205` merges aggregate children by rank fusion and groups by canonical
  URL; `:696` sends results past the inline part to an artifact. No
  requirement deduplicates a single engine's list.
- `openspec/specs/tool-result-rendering/spec.md:43-50`: a `display` object
  is stored as the tool wrote it and never rendered to the model.
- `openspec/specs/instance-config/spec.md:196` closes the provider `type`
  set; `:1093` is the `embeddingModels[]` precedent for a per-kind catalog
  that references `providers[]`.
- `openspec/specs/run-usage-accounting/spec.md:11,414`: the aggregate covers
  only the Run's own model requests. Decision calls are side calls.
- `openspec/specs/model-system-prompts/spec.md:1070-1076`: receipts are
  system-prompt-only.
- The AI SDK line llame pins (`ai` 6.0.256, `@ai-sdk/provider` 3.0.15) has
  no decision API; `experimental_decide` and `provider.decisionModel()` exist
  on `ai` 7.x only (`@ai-sdk/typesafe-ai` 3.0.34 posts to
  `${baseURL}/systemone`).
- Live probes: F11 and F12 of
  `docs/research/tool-harness/2026-11-05-decision-model-landscape.md` show
  that OpenRouter (`/api/v1`), OpenCode (`/zen/v1`), and TypeSafe speak one
  request shape and report `usage.cost`. The wire-limit probe and the
  real-repo runs are recorded in
  [#1590's measurement comment](https://github.com/leon0399/llame/pull/1590#issuecomment-6685284326):
  OpenRouter answers 800 questions in one request, OpenCode rejects about
  80k input tokens with `max_tokens_exceeded`; 12 parallel requests of 48
  draw no 429; 400 cards answer in 0.5 s.
- Prior art: oh-my-pi's judgment lane (`packages/ai/src/judgment/`, HEAD
  `88a69582c7`): one state, keyed questions, chunking under a per-endpoint
  question cap, bounded `retry-after` backoff, a `judge` model role, and a
  prompted chat-model fallback that llame deliberately does not adopt.

## Goals / Non-Goals

**Goals:**

- One ranking engine with one contract for every search tool.
- The order the model reads inline, the artifact text, and the findings
  agree by construction.
- No new authority: cards come only from findings the tool already admitted.
- Failure is visible and harmless: canonical order plus one line.
- Measurable: a fixture set and a script give the number that justifies
  turning a model on.

**Non-Goals:**

- Accounting decision calls in Run usage, a usage badge segment, or a
  RunEvent (new issue, with #1439).
- Data-class declarations, `shadow` mode, operator-replaceable rubrics.
- Cross-encoder or LLM backends, recall and Knowledge consumers.
- A chat-model fallback when no decision model answers.
- The AI SDK 7 transport.

## Decisions

Settled with Leo on 2026-11-06. Each row names the alternative rejected.

### D1. Delivery: proposal first, the experimental PRs become the layers

PRs #1584, #1588, and #1590 stay open and follow their branches, which are
renamed on GitHub to the layer names. Each layer is rebuilt from the
proposal branch by importing the experiment's files (the client branch is
split into `config`, `client`, and `service`), so the imported history is
one commit per layer and the renamed remote branches are force-pushed.
Alternative: close the PRs and re-implement; rejected as duplicated review
for no change in outcome.

### D2. Issue map

`Closes #1521` on the grep layer, `Closes #1433` and `Closes #1435` on the
web search layer. #1520 is closed as not planned with the rationale in the
proposal. #1518 is reworded (constraint 3, step 3; done). The proposal layer
amends #1521, #1433, and #1430 with the acceptance criteria this change
drops (proposal, "Not in this change") so that `Closes` is honest.

### D3. Shared engine in `apps/api/src/ranking/`

`rankCards({ judge, model, objective?, query, cards, rubric }) →
{ status: 'ranked' | 'partial' | 'unavailable', order, scores, model,
latencyMs, costUsd }`. Cards are `{ key, text }` with keys `p<index>`,
zero-padded to the width of the last index. `order` lists every key and is
asserted to be a permutation; judged keys sort by score descending with a
stable tie on canonical position; unjudged keys follow in canonical order.
`scores` holds judged keys only. `partial` means at least one card was not
judged; `unavailable` means none was. `model`, `latencyMs`, and `costUsd`
come from the lane and feed `display.rerank`. Tools own card construction
and layout. The experimental `web-search/rerank.ts:rankCards` and
`grep-rerank.ts:permutationOf` collapse into it. This extracts at the
second caller, one occurrence before CODING_STANDARDS' rule of three: the
exception is deliberate, because #1521's first bullet names the shared
kernel as the deliverable and `glob` (#1510) is the planned third caller.

### D4. Consent by configuration, no data-class declaration

Naming a model in `tools.grep.rerank` or `webSearch.rerank` is the operator's
declaration that everything the tool admits may be sent to that endpoint,
including `kb://` and `machine://` grep scopes. The operator doc states this
in one paragraph. Alternative: `decisionModels[].dataClasses` with a boot
check per consumer and a per-call skip for undeclared classes; rejected by
Leo as configuration without a present need. Consequence: #1518 constraint 3
and #1522/#1523 are reworded to "configuring the model is the declaration".

### D5. No accounting in this change

The lane logs one structured line per call (`decision.completed`: `tool`,
`model`, `cards`, `requests`, `judged`, `inputTokens`, `outputTokens`,
`costUsd`, `latencyMs`). `display.rerank` carries the served model and cost
per tool call and is the owner-visible provenance. A new issue, "side-call usage ledger", absorbs #1439 and notes
that sub-call provenance is due for a redesign with subagents. Alternatives:
fold into attempt usage (breaks the aggregate invariant at
`run-usage-accounting:414`) or a RunEvent now (scope).

### D6. `display.rerank` is the provenance; receipts untouched

Fields: `model` (served id as the provider reports it), `order` (every
card key in applied order), `scores` (judged keys only), `latencyMs`,
`costUsd` (the wire's `usage.cost`, else `null`; no catalog price exists,
because every probed route reports a cost and a self-hosted endpoint that
reports none has no price to apply). A failed call stores no record.
Receipts stay system-prompt-only.

### D7. Guard: rank only when the model cannot see everything

`grep`: no call when the whole result text fits the inline part.
`web_search`: no call when the fetched results are at most `limit` and the
inline text fits the inline bound. A result the model sees whole needs no
ordering and pays nothing. There is no minimum-candidate floor: the
experiment's "at least three" is deleted on both tools. Alternative: rank
from three candidates up (experiment); rejected as cost without benefit.

### D8. `rerank: { model }`, no mode

Presence means applied. The experiment's `shadow` mode recorded a would-be
order for later comparison; the fixture set (D11) replaces that purpose.

### D9. Visible failure

`web_search` appends `rerank: unavailable` to its `notes`; `grep` stores
`ranking: "unavailable"` on its result and the renderer emits
`[ranking unavailable; walk order]` after `[warnings: …]`, with room
reserved in the inline part like the other framing lines. Both keep
canonical order. A partial answer ranks the judged cards and stores no
failure.

### D10. Every `results` outcome is ranked

Whatever engine won, including objective-aware engines (Parallel, Exa,
DeepSeek). Answers are never ranked. Alternative (#1433's original text):
skip objective-aware winners; rejected by Leo; the fixtures can revisit it.

A configured aggregate keeps its whole deduplicated merged list in canonical
rank-fusion order until the rank stage. `fetchLimit` still bounds what each
child fetches, but it does not cut the merged candidate set first. The inline
part is a bounded prefix, and the artifact keeps the full set. Without a
configured rank model, the existing merged fetch-size cut remains. A failed
rank call keeps the full retained set in rank-fusion order plus the note.

### D11. Fixtures and evaluation

`apps/api/fixtures/ranking/<case>.json`: `{ tool, query, objective?, cards:
[{ key, text, relevant }] }`, at most 40 cards per case, hand-labeled.
`pnpm --filter api ranking:eval` sends each case to each catalog model with
live keys and prints nDCG@5, MRR, latency, and cost for canonical order and
each model. `pnpm --filter api ranking:record` regenerates
`fixtures/ranking/answers/<case>.<model>.json`; those answers pin the unit
tests of the engine and the tools, so CI needs no key, and they count as
generated output whose churn is reported separately. The first cases: the
synthetic 30-file retry fixture (F12), a 40-card subset of the 162-run
`tenant-db.service.ts` walk, a 40-card subset of the 469-run permission
evaluator walk (both in #1590's measurement comment), and the RLS /
SECURITY DEFINER web search case (F12).

### D12. Transport: hand-rolled `system-one` client

The wire is specified by shape (`POST {baseUrl}/systemone`, `{ model, state,
questions }` in, `{ model, answers, usage }` out), so a later swap to
`@ai-sdk/typesafe-ai` after the AI SDK 7 upgrade changes no spec. New issue
for the swap. Bounds carried from the experiment, measured: 256 cards per
request with their questions (under OpenCode's ~80k input ceiling with the
largest card), every request of a call in parallel, 10 s per attempt, 3
attempts on 408/429/5xx and transport failures, `retry-after` honoured up
to 5 s, response bodies over 1 MiB rejected as a codec mismatch. The 256 and
the parallel send are measured; the attempt timeout, the retry count, and
the `retry-after` cap are carried from the experiment, not measured: no
probe drew a 429 or a 5xx. They stay because a hosted gateway can answer
either, the cost of a retry is one bounded request, and the alternative is
walk order for the whole call.

### D13. Rubrics fixed in code

Two strings, one per tool, part of the measured behavior. Every question
names its card key in its instructions: on a shared state, an identical
instruction on every key gave every card the same probability.

### D14. Owner UI in scope

`custom/grep.tsx` and `custom/web-search.tsx` parse `display.rerank`, show
one badge (served model, latency, cost) and a score beside each judged row;
an unavailable rerank shows the rendered note. Stories: ranked, unavailable,
absent.

The grep part preserves consecutive file runs, not one global group per
path. It uses the same boundary rule as the native renderer: a different
file or a non-increasing start line opens a new run. Inline run ordinal
selects the corresponding key from `display.rerank.order`, and that key
selects the score. Overlapping scopes can repeat a path, so a story must
verify two distinct scores beside two runs of that path after reordering.

### Other technical choices

- **Provider carries the wire.** `system-one` is a `providers[]` type like
  the chat wires; a key shared with a chat gateway needs two entries. The
  alternative (OMP's `api` on the model, provider as credential only) is a
  refactor of model-client selection and is not needed.
- **Decision client is not a `ModelClient`.** The config loader fails
  startup when a `models[]` or `embeddingModels[]` entry names a
  `system-one` provider, naming `models[<id>].provider`. The factory retains
  a defensive guard for an impossible binding. Its exhaustive switch
  changes with the provider union in the config layer, so that layer
  compiles before the decision client exists. Tools receive the judge
  through `ToolContext.decisions`, optional and fail-closed like
  `modelClients`.
- **One client per catalog id**, built at boot from the catalog, so two
  entries on different routes never share an endpoint.
- **Headers.** `system-one` has an empty default header map; a decision
  call has no Chat lane, so `{session:id}` in its headers fails startup.
  Other templates resolve as for every provider.
- **Cards.** `web_search`: `[k] <title> — <host> — <snippet>`, 400 units.
  `grep`: path plus up to three matching lines, 384 units, one card per file
  run. Keys are `p<index>` in canonical order.
- **State.** `{ criteria: { yes, no }, task: <untrusted-data instruction>,
  objective?, query, cards: { key: text } }`; one `noul` question per card
  with `criteria: { true, false }`.
- **Within-engine dedupe** uses the aggregate's grouping key (canonical URL
  without `www.` and a trailing `/`), first occurrence wins, applied where
  results are canonicalized after the chain or aggregate returns, before the
  guard, the cards, and the output.
- **Model-facing prompts.** `grep.md` documents `objective` and that a
  configured model may order whole files; `web_search.md` already documents
  `objective`.

## Risks / Trade-offs

- [Pointwise judging ranks near-duplicates together and gives a full order
  to a list with no good card] → the score stays in `display.rerank` and the
  UI; a threshold or gate is a later change with its own fixtures.
- [Card text bounds quality: a grep file whose relevant code is not on a
  matching line, or a page with a poor snippet, is judged on little] → the
  fixture metric shows it; a page-fetch judge is a separate experiment.
- [Egress of admitted text to a hosted endpoint] → consent by configuration
  (D4), documented; a self-hosted `system-one` endpoint is a `baseUrl` away.
- [Prompt injection through card text] → the state is framed as untrusted
  data, the rubric is a fixed string, and a decision model generates no
  text; the worst case is a wrong order.
- [Cost and latency on large walks] → linear in cards, parallel requests;
  469 cards cost $0.0037 in 0.6 s. The fits-inline guard (D7) removes the
  small-result cost entirely.
- [Provider limits differ (OpenCode rejects ~80k input tokens)] → 256 cards
  per request with 384/400-unit cards stays under it; a failed request leaves
  only its own cards unjudged (`partial`).
- [The hand-rolled client duplicates a future SDK feature] → bounded to one
  module; the swap issue is filed.

## Migration Plan

No database change. Configuration is additive: no `decisionModels[]` and no
`rerank` block means no behavior change. Rollback is removing the blocks.
The experimental branches carry `mode: shadow | on` and
`pricingUsdPer1M`; the implementation layers delete both before
publication, so no shipped configuration ever contained them.

## Open Questions

None that change the specs or the layers. Which model an operator turns on
is answered by `ranking:eval` on that operator's keys.

## Revision history

- v1: Initial proposal from the agreed D1-D14 decisions.
- v2: Reconciled canonical order and inline reserves, dedupe placement,
  served-model and cost semantics, provider headers, startup checks, and
  layer ownership after two independent reviews.
- v3: Made partial success atomic per request, corrected key-width
  boundaries, kept the config layer type-safe, and bound UI scores to file
  runs rather than globally merged paths. The measurement comment now
  distinguishes pre-fix and post-fix runs.
- v4: Retained every merged aggregate candidate for the configured rank
  stage and artifact, as #1433 requires. Kept the common provider `billing`
  field instead of adding a type-specific rejection.
