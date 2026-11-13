# Proposal

## Why

The decision lane sizes every request by one constant, 256 cards, whatever the
model behind the catalog entry accepts, and sends all split requests at once
([#1717](https://github.com/leon0399/llame/issues/1717)). By llame's own
estimate a full 256-card request is about 34k tokens per question and 65k per
request: near Jev's documented 32k per-question and 64k per-request ceilings,
and far past the ~32,000 bytes at which OpenRouter moves Jev to its slower
long-context mode. A small self-hosted member fails harder.
`laya-multilingual` behind a LiteLLM gateway takes 1,024 tokens per question.
At 16 grep cards it cut the state, marked every question truncated, and still
answered HTTP 200; the current codec accepts that answer as a ranking. After a
32-card request its server stopped answering.

Decision models are a general model class, not a search feature, so the fix
describes what each model accepts and lets the lane derive request sizes.

## What Changes

- Each `decisionModels[]` entry can declare optional `limits`:
  `perQuestionContextTokens` (state plus one question),
  `perRequestContextTokens` (state plus every question) and
  `maxQuestionsPerRequest`. The token names follow TypeSafe's
  `per_question_context` and `per_request_context`. An omitted limit uses a
  default: 8,192 per question and 32,768 per request (or the per-question
  limit when larger), with no question default.
- A `system-one` provider can declare `maxConcurrentRequests`, default 4. Every
  catalog entry on that provider id shares the bound in one process.
- The lane keeps one shared state per request and fills each request in
  canonical order up to 32 cards and the model's limits. One call judges at
  most its first 256 cards; the rest keep their canonical order unjudged. A
  card that alone exceeds a limit is cut to the longest prefix that fits. The
  lane estimates tokens as UTF-8 bytes of the serialized JSON divided by 3,
  rounded up.
- A response that reports truncation (`usage.truncated: true` or
  `usage.state_tokens_dropped` above 0) makes its request unavailable.
- An existing configuration loads unchanged. A small self-hosted member must
  declare its `limits`: the defaults fit hosted members such as Jev, not a
  1,024-token checkpoint.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `decision-models`: request bound and parallelism change from 256 cards sent
  together to model-derived packing under a 32-card request bound, a 256-card
  call bound, and a per-provider attempt bound; truncation reports make a
  request unavailable; queued slot waits follow the enclosing cancellation.
- `instance-config`: the decision catalog entry gains optional `limits`, and a
  `system-one` provider gains optional `maxConcurrentRequests`.
- `web-search`: the 300-card aggregate scenario judges its first 256 cards.
- `tool-result-rendering`: the partial-answer rank-record scenario follows the
  256-card call bound.

## Evidence, intent and decisions

The member survey, the Laya probe, published reranking evidence and a Jev
layout eval are summarized in [design.md](design.md). On the four
`fixtures/ranking` cases a 32-card shared state ranked no worse than one card
per request, at about a third of the tokens; the fixtures are too easy to
separate the layouts on quality. Leo settled the shape on 2026-11-13; the
design records each decision and its rejected options.

Non-goals: the Gemini and OpenAI decision wires, a configurable per-tool item
cap, a `choice` pass over top candidates, changes to `rerankModels[]`, and any
change to how Laya checkpoints are served.

Assumptions: vendor ceilings are documented in tokens, and llame has no
tokenizer for these models, so the estimate is a byte heuristic. A server can
truncate without a report; the declared limits are the guard and the report is
a backstop.

## Impact

- `apps/api/src/instance-config`: schema, types, loader validation for the new
  fields; JSON schema descriptions.
- `apps/api/src/decisions`: request packing, token estimate, card fit,
  per-provider attempt bound, call bound, truncation check, a
  `state_too_large` failure reason.
- `docs/product/operator/decisions.md`: the fields, defaults, the per-process
  bound, and guidance for small members.
- No database, API surface, or model-visible change. Ranked tools keep their
  output contract; calls past 256 cards leave their tail unjudged.
