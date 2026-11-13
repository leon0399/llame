# Proposal

## Why

The decision lane sizes every request by one constant, 256 cards, whatever the
model behind the catalogue entry accepts, and sends all split requests at once
([#1717](https://github.com/leon0399/llame/issues/1717)). A full request is
roughly 30k tokens of state and 60k in total: at or over Jev's documented 32k
per-question and 64k per-request ceilings, and past the ~32 KB at which
OpenRouter moves Jev to its slower long-context mode. A small self-hosted
member fails harder. `laya-multilingual` behind a LiteLLM gateway takes 1,024
tokens per question; at 16 grep cards it cut the state, still answered HTTP
200, and returned one collapsed probability that the current codec accepts as
a ranking. After a 32-card request its server stopped answering.

Decision models are a general model class, not a search feature, so the fix
describes what each model accepts and lets the lane derive request sizes.

## What Changes

- Each `decisionModels[]` entry can declare optional `limits`:
  `perQuestionContextTokens` (state plus one question),
  `perRequestContextTokens` (state plus every question) and
  `maxQuestionsPerRequest`. The token names follow TypeSafe's
  `per_question_context` and `per_request_context`. An omitted limit uses a
  conservative default: 8,192 per question and 32,768 per request, with no
  question default.
- A `system-one` provider can declare `maxConcurrentRequests`, default 4. Every
  catalogue entry on that provider shares the bound in one process.
- The lane keeps one shared state per request, caps a request at 32 cards, and
  lowers the count until the request fits the model's limits, down to one card.
  It cuts a card that alone exceeds the window. It estimates tokens as UTF-8
  bytes divided by 3, rounded up.
- A response that reports truncation (`usage.truncated: true` or
  `usage.state_tokens_dropped` above 0) makes its request unavailable.
- No existing configuration needs a change. A large call now sends more,
  smaller requests, and an undeclared entry gets the default limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `decision-models`: request bound and parallelism change from 256 cards sent
  together to model-derived packing under a 32-card cap and a per-provider
  concurrency bound; truncation reports make a request unavailable.
- `instance-config`: the decision catalogue entry gains optional `limits`, and
  a `system-one` provider gains optional `maxConcurrentRequests`.

## Evidence, intent and decisions

The member survey, the Laya probe, published reranking evidence and a Jev
layout eval are summarized in [design.md](design.md). The eval ran
`typesafe/jev-1.14` on the four `fixtures/ranking` cases: a 32-card shared
state ranked at least as well as one card per request on every case for about
a third of the tokens. Leo settled the shape on 2026-11-13; the design records
each decision and its rejected options.

Non-goals: the Gemini and OpenAI decision wires, a per-tool cap on judged
items, a `choice` pass over top candidates, changes to `rerankModels[]`, and
any change to how Laya checkpoints are served.

Assumptions: vendor ceilings are documented in tokens, and llame has no
tokenizer for these models, so the estimate errs high. A server can truncate
without a report; the declared limits are the guard and the report is a
backstop.

## Impact

- `apps/api/src/instance-config`: schema, types, loader validation for the new
  fields; JSON schema descriptions.
- `apps/api/src/decisions`: request packing, token estimate, card fit,
  per-provider concurrency, truncation check.
- `docs/product/operator/decisions.md`: the fields, defaults and their meaning.
- No database, API surface, or model-visible change. Ranked tools keep their
  output contract; only the number and size of side requests change.
