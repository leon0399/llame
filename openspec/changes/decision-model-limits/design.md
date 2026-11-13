# Design

## Context

See [proposal.md](proposal.md) for motivation. Current state, read at
`6eb012d0a`:

- `apps/api/src/decisions/decisions.service.ts` cuts each card to the tool's
  `cardBound` (384 UTF-16 units for `grep`, 400 for `web_search`), groups the
  cards by `DECISION_MAX_CARDS_PER_REQUEST = 256`, builds one shared state per
  group with `buildJudgeRequest`, and sends every group through
  `Promise.all`.
- `apps/api/src/decisions/decision-client.ts` accepts a response when the
  envelope, the `noul` answers and `usage.input_tokens`/`output_tokens` are
  valid. It ignores unknown fields, so Laya's `usage.truncated` and
  `usage.state_tokens_dropped` pass through unread.
- `decisionModels[]` entries are `{ id, provider, model }`; a `system-one`
  provider is `{ id, type, key, baseUrl, billing?, headers? }`. Nothing
  describes what a model accepts.
- The only in-process concurrency control in `apps/api` is pg-boss worker
  concurrency; no limiter library is installed.

### Members surveyed

Read on 2026-11-13 through vendor documentation and model cards; numbers are
vendor-stated unless marked measured.

| Member                 | Wire                       | State + one question                 | State + all questions               | Questions | State billed            | Overflow                        |
| ---------------------- | -------------------------- | ------------------------------------ | ----------------------------------- | --------- | ----------------------- | ------------------------------- |
| TypeSafe Jev 1.13/1.14 | System One                 | 32k                                  | 64k (262k with long-context header) | no limit  | once                    | 400 `max_tokens_exceeded`       |
| Jev through OpenRouter | System One                 | not stated                           | 262k; long-context above ~32 KB     | not found | not stated              | not found                       |
| Liquid `d1`, `d1.1`    | System One                 | 65,536 (`d1-ultra` 32,768), 250 KB   | not found                           | 128       | once (pages disagree)   | 422                             |
| Gemini Decision 1      | own (`/v1beta/decisions`)  | none separate                        | 262,144                             | 1,000     | once                    | 400                             |
| GPT-6 Luna Decisions   | own (`/v1/decisions`)      | not documented                       | not documented                      | 400       | not stated              | not documented                  |
| Laya multilingual      | System One (`laya[serve]`) | 1,024, of which 256 for the question | server budget                       | not found | per question (measured) | cuts state, reports `truncated` |
| Laya english           | same                       | 512, of which 192 for the question   | server budget                       | not found | per question (inferred) | same                            |

Sources: [TypeSafe models](https://docs.typesafe.ai/models.md),
[TypeSafe errors](https://docs.typesafe.ai/api/errors.md),
[OpenRouter Jev guide](https://openrouter.ai/docs/guides/community/jev.md),
[Liquid make-decisions reference](https://docs.liquid.ai/api/reference/decision-models/make-decisions),
[Gemini Decisions API](https://aistudio.google.com/docs/decisions-api),
[OpenAI decisions guide](https://developers.openai.com/api/docs/guides/decisions.md),
[Laya multilingual card](https://huggingface.co/convaiinnovations/laya-multilingual),
[`laya` package](https://pypi.org/project/laya/).

Two token ceilings and one count recur; each member leaves some blank. Jev's
billing in the repository's own fixtures matches a state read once: 40 cards
cost $0.000284, about 6.7k tokens at $0.042 per million.

### Laya probe (measured)

`laya-multilingual` through a LiteLLM gateway, real `grep` cards
built by `buildJudgeRequest`:

| Cards | Input tokens | State tokens | Truncated     | Latency | Probability range |
| ----- | ------------ | ------------ | ------------- | ------- | ----------------- |
| 4     | 1,624        | 308          | no            | 0.96 s  | 0.325 to 0.396    |
| 8     | 5,368        | 573          | no            | 3.1 s   | 0.411 to 0.429    |
| 16    | 16,384       | 1,030        | all questions | 11.7 s  | 0.599 to 0.624    |
| 32    | HTTP 500     |              |               | 26.9 s  |                   |

Input tokens grow as questions times state. The 16-card response was HTTP 200
with collapsed answers that the current codec accepts. After the 32-card
request the server refused connections. The vendor card puts the base
checkpoints near chance zero-shot (0.362 and 0.352 against a 0.318 baseline);
only `laya-typed-decisions` is competitive. No configuration fixes that; this
change only keeps the lane safe on such a member.

### Candidate layout evidence

No published source compares one candidate per request against many
candidates in one state on one workload.

| Source                                                                                          | Layout                                       | Result                                                            |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| [Unblocked](https://getunblocked.com/blog/jev-in-production-vs-cross-encoder/)                  | shared state, 20 per request                 | beat their cross-encoder; a per-pair variant scored below it      |
| [Opine](https://tryopine.com/blog/jev-as-reranker)                                              | shared state, 20 to 30 per request           | nDCG@20 0.876 at 200 candidates; Voyage 3 0.815, GPT-6 Luna 0.864 |
| [TypeSafe rerank cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)               | one candidate per request                    | vendor top-k gains; no layout comparison                          |
| [TypeSafe large pools](https://docs.typesafe.ai/cookbooks/infinite_cardinality_choice.md)       | shared state, 300 per request, then `choice` | vendor 78% top-1                                                  |
| [Hindsight](https://hindsight.vectorize.io/blog/2026/09/24/adding-jev-reranker-what-we-learned) | one `choice` over candidates                 | recall@1 0.94 against 0.87 per candidate; scores are relative     |
| [TypeSafe jaggedness](https://docs.typesafe.ai/model-jaggedness.md)                             | -                                            | accuracy falls with unrelated state; indirection costs accuracy   |
| [Ranker injection study](https://arxiv.org/html/2602.16752)                                     | -                                            | 99 to 100% attack success when candidates share one context       |

### Jev layout eval (measured)

`typesafe/jev-1.14` through OpenRouter, the four `fixtures/ranking` cases,
four requests in flight, one run per variant plus a repeat as the noise floor:

| Case                       | Layout          | nDCG@5 | MRR   | Mean P relevant | Mean P irrelevant | Requests | Tokens |
| -------------------------- | --------------- | ------ | ----- | --------------- | ----------------- | -------- | ------ |
| `permission-evaluator`     | shared, 32 cap  | 0.000  | 0.125 | 0.550           | 0.324             | 2        | 7,121  |
| `permission-evaluator`     | one per request | 0.000  | 0.077 | 0.480           | 0.365             | 40       | 21,687 |
| `retry-synthetic`          | shared, 32 cap  | 1.000  | 1.000 | 0.920           | 0.130             | 1        | 4,461  |
| `retry-synthetic`          | one per request | 1.000  | 1.000 | 0.900           | 0.167             | 30       | 15,421 |
| `rls-security-definer-web` | shared, 32 cap  | 1.000  | 1.000 | 0.901           | 0.138             | 1        | 3,303  |
| `rls-security-definer-web` | one per request | 1.000  | 1.000 | 0.880           | 0.110             | 20       | 10,749 |
| `tenant-db`                | shared, 32 cap  | 1.000  | 1.000 | 0.960           | 0.201             | 2        | 7,100  |
| `tenant-db`                | one per request | 1.000  | 1.000 | 0.930           | 0.334             | 40       | 22,008 |

- Shared state ranked at least as well on every case and separated relevant
  from irrelevant better on three of four, at about a third of the tokens and
  roughly an eighth of the wall time (0.3 s against 1.3 to 2.9 s).
- Order: in the two single-request cases, reversed card order moved
  probabilities by 0.034 and 0.042 on average (maximum 0.23) against a 0.008
  noise floor. It moved one rank on `permission-evaluator` and changed no other
  ranking.
- Injection: an irrelevant card claimed it alone answered the objective. In
  the shared layout the other cards fell by up to 0.14 against a 0.06 noise
  maximum; one per request kept them within noise but let the injected card
  raise its own score more (+0.17 against +0.09). No ranking changed.
- Limits: three cases score 1.0 under every layout and one scores 0 (the card
  content gap in [#1606](https://github.com/leon0399/llame/issues/1606)), so
  the fixtures cannot separate layouts on quality. One run, one injection
  phrasing, one model. The per-card variant reused llame's keyed template, not
  TypeSafe's `{ query, candidate }` pair shape.

## Goals / Non-Goals

**Goals:**

- Request size follows the model, request concurrency follows the server, and
  card count stays a ranking constant of the lane.
- A silent server-side cut never becomes an accepted ranking.

**Non-Goals:**

- Choosing a layout per model, a `choice` pass, shuffled order, and per-tool
  item caps. Each waits for evidence that the shared layout or canonical order
  loses on llame's own data.
- Exact token counts. No tokenizer for these members ships in llame.
- Bounding concurrency across processes. The bound is per process; an
  operator with several workers divides it.

## Decisions

Decision codes match the review with Leo on 2026-11-13.

**G1. Limits belong to the catalogue entry.** A limit is a property of one
model on one route: Jev is 64k per request on TypeSafe and 262k through
OpenRouter, and two Laya checkpoints on one server differ (512 and 1,024).
Rejected: limits on the provider (cannot tell checkpoints apart) and a
built-in table keyed by model id (every new checkpoint needs a release).

**G2 and G9. Omitted limits default to 8,192 per question and 32,768 per
request, with no question default.** A full 32-card batch fits these defaults
on Jev, and the body stays under OpenRouter's ~32 KB long-context switch.
Rejected: no bound (keeps the failure as the default), Jev's documented values
(32 times too large for small members), and required fields (boot friction for
no safety gain). The 32-card cap makes a question default redundant.

**G3 and G10. Limits are tokens; the lane estimates
`ceil(utf8Bytes / 3)`.** Vendors document tokens, so operators copy their
numbers. Bytes over three overcounts code about twofold and stays high for
two-byte scripts such as Cyrillic. Rejected: bytes as the unit (every vendor
figure needs conversion) and the chat-side `length / 4` estimate, which
undercounts Cyrillic and would let a near-full request reach truncation.

**G4. `maxConcurrentRequests` on the `system-one` provider, default 4.**
Capacity belongs to the server: both Laya checkpoints share one server,
and hosted routes rate-limit per account. A counting semaphore keyed by
provider id, built once with the decision clients, wraps each request. It is
about twenty lines; no dependency is warranted. The enclosing deadline and
cancellation already stop queued work, because each request checks its signal
before its first attempt. Rejected: unbounded by default (a self-hosted server
receives every split request at once) and a bound per catalogue entry (two
checkpoints on one server double it).

**G5. A truncation report makes its request unavailable.** The cut is to the
shared state, so every question of that request read less evidence. Checking
`usage.truncated === true` or `usage.state_tokens_dropped > 0` is an optional
extension of the usage schema; Jev and Liquid responses omit both and are
unaffected. This is a backstop: `LAYA_JEV_STRICT=1` strips the fields, so the
declared limits remain the guard. Rejected: keep only questions not listed in
`truncated_questions`.

**G7. Keep the shared state, capped at 32 cards, lowered to fit.** The
published production measurements (Unblocked, Opine) used this layout at 20 to
30 per request, and llame's eval agreed at a third of the tokens. Packing is
greedy in canonical order: add cards while the request's estimates fit the
entry's limits and the cap, then start the next request. Card keys keep their
canonical position across the call, so the existing key rule holds. Rejected:
one card per request everywhere (no measured gain, about three times the
tokens and many round trips) and a per-model layout field (no evidence yet).

**G8. A card that alone exceeds a limit is cut to fit.** The lane repeats the
existing code-point cut with a smaller bound, after key replacement, until a
one-card request fits. When the state without any card text already exceeds
the limit, the lane sends nothing for that card and it stays unjudged.
Rejected: drop the card (files with long matches never rank on small models).

**G12. Canonical order in production.** The order effect is measurable but
moved one rank in the eval; shuffling only randomizes a bias and makes
identical calls disagree. The eval records two orders so a future change can
measure it.

**G13. `web_search` keeps the shared layout.** Cross-card injection moved
other cards by at most 0.14 on Jev and changed no ranking. Per-card isolation
does not stop self-promotion. A recorded injection fixture for `ranking:record`
lets the measurement repeat when a model changes; it is a live-model eval, not
a CI test.

## Risks / Trade-offs

- [The estimate undercounts for some tokenizer and script] → the truncation
  backstop marks such a request unavailable where the server reports it; the
  operator lowers the declared limit.
- [A server truncates without a report] → declared limits are the guard; an
  operator who declares limits above the real window gets degraded answers.
  The operator page states this.
- [More requests per call on small members] → each carries fewer cards, so
  latency per call grows on those members; the tool deadline leaves the tail
  unjudged in canonical order, which is the existing failure contract.
- [Per-process bound] → several worker processes multiply the load on one
  server; the operator page states the bound is per process.
- [Layout evidence is thin] → the fixtures saturate. Harder cases, starting
  with #1606, are needed before any later layout change.

## Migration Plan

No data or API migration. An existing configuration loads unchanged and gets
the default limits and concurrency. Rollback is a revert of the implementation
layer; no persisted state depends on the new fields.
