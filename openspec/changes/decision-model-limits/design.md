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
- `apps/api` has pg-boss worker concurrency and fixed-size batching in the
  search reindex paths (`CONCURRENCY = 20`), but no shared limiter keyed by an
  external server, and no limiter library is installed.
- An enclosing deadline or cancellation makes `judgeRequests` rethrow, so a
  rank call that outlives the tool deadline fails the whole tool call with the
  runner's timeout; it does not leave a judged head and an unjudged tail.
- `grep` puts no bound on its card count: a large walk produces thousands of
  file-run cards.

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
with every question marked truncated, and the current codec accepts it. The
answers were flat at 8 cards too, so the flatness is not shown to come from
truncation. After the 32-card
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
  4 to 10 times less wall time (0.3 s against 1.3 to 2.9 s).
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
  TypeSafe's `{ query, candidate }` pair shape. The eval script was a one-off
  and its raw output is not committed; the implementation layer records the
  injection and reversed-order cases through `ranking:record`.

## Goals / Non-Goals

**Goals:**

- Request size follows the model, attempt concurrency follows the server, and
  card counts stay ranking constants of the lane.
- A server-reported cut never becomes an accepted ranking.
- Ranking never turns a large walk into a whole-call timeout by queueing.

**Non-Goals:**

- Choosing a layout per model, a `choice` pass, shuffled order, and a
  configurable per-tool item cap. Each waits for evidence on llame's own data.
- Exact token counts. No tokenizer for these members ships in llame.
- Bounding concurrency across processes or across provider ids that point at
  one server. The bound is per process and per provider id.

## Decisions

Decision codes match the review with Leo on 2026-11-13. The two review rounds
on this proposal changed G4, G8 and G11; each change is marked.

**G1. Limits belong to the catalog entry.** A limit is a property of one model
on one route: Jev is 64k per request on TypeSafe and 262k through OpenRouter,
and two Laya checkpoints on one server differ (512 and 1,024). Rejected: limits
on the provider (cannot tell checkpoints apart) and a built-in table keyed by
model id (every new checkpoint needs a release).

**G2 and G9. Omitted limits default to 8,192 per question and 32,768 per
request.** When only a per-question limit is declared above 32,768, the
per-request default rises to match, so a declared Liquid 65,536 is not capped
silently; when both are declared, per-question above per-request fails boot.
`maxQuestionsPerRequest` has no default and cannot raise the 32-card bound.
These defaults suit hosted members: 32 ASCII grep cards estimate about 4,500
per question. They do not protect a small member, which must declare its
limits; 32 grep cards fit the default and are the exact request that preceded
the Laya outage. The defaults do not keep a body under OpenRouter's ~32,000
bytes either: escaped or non-ASCII cards can reach about 37 KB within them.
Rejected: no bound (keeps the oversized request as the default), Jev's
documented values (no protection at all), and required fields (boot friction
for hosted members that fit the defaults).

**G3 and G10. Limits are tokens; the lane estimates
`ceil(utf8Bytes(JSON.stringify(...)) / 3)`.** The per-question estimate is the
serialized state plus the largest serialized question; the per-request
estimate is the serialized state plus the serialized `questions` map. Body
envelope and `model` are excluded; the difference is tens of bytes. Vendors
document tokens, so operators copy their numbers. Assumption, not measured
against a tokenizer: three bytes per token errs high for code and stays high
for two-byte scripts such as Cyrillic. Rejected: bytes as the unit (every
vendor figure needs conversion) and the chat-side `length / 4` estimate, which
counts UTF-16 units and undercounts Cyrillic.

Laya reserves a fixed question budget inside its window
(`max(64, max_len - head_max_len - 8)` for the state, 760 of 1,024 on the
multilingual checkpoint). The per-question limit subtracts the estimated
question instead, so the operator page tells such an operator to declare the
state budget plus a typical question, not the raw window.

**G4. `maxConcurrentRequests` on the `system-one` provider, default 4
(revised).** Capacity belongs to the server: both Laya checkpoints share one
server, and hosted routes rate-limit per account. A FIFO counting
semaphore keyed by provider id, built once with the decision clients, wraps
each attempt, not each request: a retry wait releases its slot, so one failing
request cannot hold the server while it backs off. A slot wait listens to the
call's signal and leaves the queue at once on abort; the earlier draft claimed
the existing signal check covered this, but that check runs only after a slot
is held. The call's `latencyMs` becomes its wall time, including slot waits,
instead of the slowest request's own time. Rejected: unbounded by default (a
self-hosted server receives every split request at once) and a bound per
catalog entry (two checkpoints on one server double it).

**G5. A truncation report makes its request unavailable.** The cut is to the
shared state, so every question of that request read less evidence. The usage
schema reads `truncated` and `state_tokens_dropped` when present and fails
closed on a wrong type; it still ignores every other extra field, including
`truncated_questions`. The reason is `invalid_response`. Such a request
contributes no usage even though the server billed it, as with every other
rejected response; the log therefore understates spend on a misdeclared
member. This is a backstop: `LAYA_JEV_STRICT=1` strips the fields, so the
declared limits remain the guard. Rejected: keep only questions not listed in
`truncated_questions`.

**G7. Keep the shared state, at most 32 cards per request, filled in order.**
The published production measurements (Unblocked, Opine) used this layout at
20 to 30 per request; llame's eval found it no worse at a third of the tokens,
though its fixtures could not separate the layouts on quality. Packing is
greedy, contiguous and in canonical order: a request takes the next card while
its estimates fit the entry's limits and the bound. Card keys keep their
canonical position across the call, so the existing key rule holds. Rejected:
one card per request everywhere (no measured gain, about three times the
tokens and many round trips) and a per-model layout field (no evidence yet).

**G8. A card that alone exceeds a limit is cut to fit (revised).** The lane
sends the longest code-point prefix of the card text that fits, cut after key
replacement. When the state without any card text already exceeds the limit,
nothing can fit, so the call is `unavailable` with a new lane reason,
`state_too_large`, and logs 0 requests. Today an empty request list reports
`upstream_error`, which would misstate the cause. A 2,000-unit grep objective
alone estimates about 950 tokens, so this case is real on 512- and 1,024-token
members. Rejected: drop the card (files with long matches never rank on small
members).

**G11. One call judges at most its first 256 cards (changed).** The
grilling chose no per-call cap, on the premise that the tool deadline leaves an
unjudged tail. The review showed that premise false: a deadline during ranking
fails the whole tool call, and `grep` can send thousands of cards, which at 32
per request and four slots becomes dozens of queued waves. A fixed lane
constant of 256, the old single-request size, bounds a call to eight requests:
two waves at the default slots on Jev. The tail keeps its canonical order
unjudged, which the tool-result-rendering contract already places last. It is
a lane constant, not a tool option, so the G11 rejection of configuration
stands. Rejected: a time budget inside the lane (it cannot see the tool
deadline) and leaving the call unbounded.

**G12. Canonical order in production.** The order effect is measurable but
moved one rank in the eval; shuffling only randomizes a bias and makes
identical calls disagree. `ranking:record` gains a reversed-order variant so a
later change can measure the effect.

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
- [Small members need many requests] → at about three cards per request, a
  256-card call is about 85 requests, roughly 20 waves at four slots, and a
  deadline still fails the whole tool call. The operator can raise
  `maxConcurrentRequests` only as far as the server tolerates.
- [One call can delay another on a shared provider] → FIFO slots and the
  256-card call bound limit the delay to the queued waves ahead of it.
- [Per-process and per-provider-id bound] → several worker processes, or two
  provider ids on one server URL, multiply the load; the operator page states
  both.
- [Layout evidence is thin] → the fixtures saturate. Harder cases, starting
  with #1606, are needed before any later layout change.

## Migration Plan

No data or API migration. An existing configuration loads unchanged and gets
the default limits and concurrency; a small self-hosted member should add
`limits` in the same deploy. Rollback is a revert of the implementation layer;
no persisted state depends on the new fields.
