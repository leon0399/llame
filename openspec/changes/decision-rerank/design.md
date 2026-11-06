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
  set; `:1093` is the `embeddingModels[]` precedent for a per-kind catalogue
  that references `providers[]`.
- `openspec/specs/run-usage-accounting/spec.md:11,414`: the aggregate covers
  only the Run's own model requests. Decision calls are side calls.
- `openspec/specs/model-system-prompts/spec.md:1070-1076`: receipts are
  system-prompt-only.
- The AI SDK line llame pins (`ai` 6.0.256, `@ai-sdk/provider` 3.0.15) has
  no decision API; `experimental_decide` and `provider.decisionModel()` exist
  on `ai` 7.x only (`@ai-sdk/typesafe-ai` 3.0.34 posts to
  `${baseURL}/systemone`).
- Live probes (2026-11-05/06, recorded in
  `docs/research/tool-harness/2026-11-05-decision-model-landscape.md` F11
  and F12): OpenRouter (`/api/v1`), OpenCode (`/zen/v1`), and TypeSafe speak
  one request shape; OpenRouter answers 800 questions in one request,
  OpenCode rejects about 80k input tokens; 12 parallel requests draw no 429;
  latency grows sublinearly with cards (400 cards in 0.5 s).
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

### D1. Delivery: proposal first, the experimental branches become the layers

The three experimental branches are rebased onto `decision-rerank/proposal`
after approval and keep their commits. Alternative: close them and
re-implement; rejected as duplicated review for no change in outcome.

### D2. Issue map

`Closes #1521` on the grep layer, `Closes #1433` and `Closes #1435` on the
web search layer. #1520 is closed as not planned with the rationale in the
proposal. #1518 and #1430 stay open and are reworded (constraint 3, step 3).

### D3. Shared engine in `apps/api/src/ranking/`

`rankCards({ judge, model, objective?, query, cards, rubric }) →
{ status: 'ranked' | 'partial' | 'unavailable', order, scores }`. `order` is
asserted to be a permutation of the card keys; judged cards sort by score
descending with a stable tie on canonical position; unjudged cards follow in
canonical order. `partial` means at least one card was not judged. Tools own
card construction and layout. The experimental `web-search/rerank.ts:rankCards`
and `grep-rerank.ts:permutationOf` collapse into it. Alternative: keep two
tool-local modules until a third caller; rejected because the duplicate
exists today and #1521 names the kernel.

### D4. Consent by configuration, no data-class declaration

Naming a model in `tools.grep.rerank` or `webSearch.rerank` is the operator's
declaration that everything the tool admits may be sent to that endpoint,
including `kb://` and `machine://` grep scopes. The operator doc states this
in one paragraph. Alternative: `decisionModels[].dataClasses` with a boot
check per consumer and a per-call skip for undeclared classes; rejected by
Leo as configuration without a present need. Consequence: #1518 constraint 3
and #1522/#1523 are reworded to "configuring the model is the declaration".

### D5. No accounting in this change

The lane logs one structured line per call (`decision.completed`: tool,
model, cards, requests, judged, tokens, cost, latency). `display.rerank`
carries the served model and cost per tool call and is the owner-visible
provenance. A new issue, "side-call usage ledger", absorbs #1439 and notes
that sub-call provenance is due for a redesign with subagents. Alternatives:
fold into attempt usage (breaks the aggregate invariant at
`run-usage-accounting:414`) or a RunEvent now (scope).

### D6. `display.rerank` is the provenance; receipts untouched

Fields: `model` (served id as the provider reports it), `order`, `scores`,
`latencyMs`, `costUsd`. Receipts stay system-prompt-only.

### D7. Guard: rank only when the model cannot see everything

`grep`: no call when the whole result fits the inline part. `web_search`: no
call when the fetched set is within `limit`. A result the model sees whole
needs no ordering and pays nothing. Alternative: rank from three candidates
up (experiment); rejected as cost without benefit.

### D8. `rerank: { model }`, no mode

Presence means applied. The experiment's `shadow` mode recorded a would-be
order for later comparison; the fixture set (D11) replaces that purpose.

### D9. Visible failure

`web_search` appends `rerank: unavailable` to its `notes`; `grep` adds one
framing line, `ranking unavailable; walk order`. Both keep canonical order.
Rendered through the existing notes and framing grammars.

### D10. Every `results` outcome is ranked

Whatever engine won, including objective-aware engines (Parallel, Exa,
DeepSeek). Answers are never ranked. Alternative (#1433's original text):
skip objective-aware winners; rejected by Leo; the fixtures can revisit it.

### D11. Fixtures and evaluation

`apps/api/fixtures/ranking/<case>.json`: `{ tool, query, objective?, cards:
[{ key, text, relevant }] }`. `pnpm --filter api ranking:eval` sends each
case to each catalogue model with live keys and prints nDCG@5 and MRR for
canonical order and each model. Recorded answers for the fixture cases pin
the unit tests of the engine and the tools, so CI needs no key. The first
cases are the two real-repo grep cases from the experiment and the two
web search cases, labeled by hand.

### D12. Transport: hand-rolled `system-one` client

The wire is specified by shape (`POST {baseUrl}/systemone`, `{ model, state,
questions }` in, `{ model, answers, usage }` out), so a later swap to
`@ai-sdk/typesafe-ai` after the AI SDK 7 upgrade changes no spec. New issue
for the swap. Bounds carried from the experiment, measured: 256 cards per
request with their questions (under OpenCode's ~80k input ceiling with the
largest card), every request of a call in parallel, 10 s per attempt, 3
attempts on 408/429/5xx and transport failures, `retry-after` honoured up
to 5 s, response bodies over 1 MiB rejected as a codec mismatch.

### D13. Rubrics fixed in code

Two strings, one per tool, part of the measured behavior. Every question
names its card key in its instructions: on a shared state, an identical
instruction on every key gave every card the same probability.

### D14. Owner UI in scope

`custom/grep.tsx` and `custom/web-search.tsx` parse `display.rerank`, show
one badge (served model, latency, cost) and a score beside each judged row;
an unavailable rerank shows the rendered note. Stories: ranked, unavailable,
absent.

### Other technical choices

- **Provider carries the wire.** `system-one` is a `providers[]` type like
  the chat wires; a key shared with a chat gateway needs two entries. The
  alternative (OMP's `api` on the model, provider as credential only) is a
  refactor of model-client selection and is not needed.
- **Decision client is not a `ModelClient`.** `model-client-factory` fails
  with an explicit error for a `system-one` provider named by `models[]`.
  Tools receive the judge through `ToolContext.decisions`, optional and
  fail-closed like `modelClients`.
- **One client per catalogue id**, built at boot from the catalogue, so two
  entries on different routes never share an endpoint.
- **Cards.** `web_search`: `[k] <title> — <host> — <snippet>`, 400 units.
  `grep`: path plus up to three matching lines, 384 units, one card per file
  run. Keys are `p<index>` in canonical order.
- **State.** `{ criteria: { yes, no }, task: <untrusted-data instruction>,
  objective?, query, cards: { key: text } }`; one `noul` question per card
  with `criteria: { true, false }`.
- **Within-engine dedupe** uses the aggregate's grouping key (canonical URL
  without `www.` and a trailing `/`), first occurrence wins, applied in the
  output layer before cards are built.
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
The experimental branches carry `mode: shadow | on`; the implementation
layers delete `mode` before publication, so no shipped configuration ever
contained it.

## Open Questions

None that change the specs or the layers. Which model an operator turns on
is answered by `ranking:eval` on that operator's keys.
