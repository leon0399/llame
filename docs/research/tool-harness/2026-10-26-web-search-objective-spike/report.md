---
type: Research
title: "web_search objective and query lengths, and DeepSeek ori_question effect"
description: "Measures how long three configured models write a drafted web_search query and objective, and whether DeepSeek Search's ori_question changes its results."
tags: [web-search, deepseek, objective, spike]
status: stable
generated:
  by: omp/claude-opus-5-5
  at: 2026-10-26
sources:
  - id: deepseek-search
    url: https://api-docs.deepseek.com/api/search
  - id: deepseek-responses
    url: https://api-docs.deepseek.com/guides/responses_api
---

# web_search objective and query lengths, and DeepSeek `ori_question` effect

Two questions decide how a planned `objective` field maps onto engines with
short limits. How long are the `query` and `objective` that models actually
write? And does DeepSeek Search's `ori_question` (at most 128 characters)
change results enough that cutting a longer objective to 128 matters?[^deepseek-search]

## Setup

Stage 1 ([script](./experiments/web-search-objective.ts)) gives each model 30
user turns in six groups (fact, research, news, library docs, Russian or CIS,
product comparison) with a drafted `web_search` tool: `query`, `objective`
(at most 2,000 characters), `engines`, `recency`, `limit`, and a catalog of
seven example engines with their query limits. The description asks for a
short, keyword-like query and a concise objective. Variant `target120` adds
"Aim for about 120 characters" to the objective guidance. Each turn requests
one `web_search` call; nothing is executed.

| Model                 | Wire                 | Tool choice |
| --------------------- | -------------------- | ----------- |
| `claude-haiku-5-5`    | `anthropic-messages` | required    |
| `gpt-6-luna`          | `openai-codex`       | required    |
| `deepseek-v4.1-flash` | `opencode-go`        | auto        |

The `opencode-go` endpoint rejected a required tool choice with HTTP 400, so
that model ran with `auto`. Its objective-presence counts are not comparable
with the other two.

Stage 2 ([script](./experiments/deepseek-ori-question.ts)) takes Haiku's
stage-1 calls, the longest objectives, and runs each query against DeepSeek
Search three ways: no `ori_question`, the `concise` objective cut to 128
characters, and the `target120` objective cut to 128 characters. It compares
the result lists.

## Results

Lengths are Unicode code points.

| Model                 | Variant   | Objective present | Objective p50 / p90 / max | Objective ≤ 128 | Query p50 / p90 / max | Query ≤ 128 |
| --------------------- | --------- | ----------------- | ------------------------- | --------------- | --------------------- | ----------- |
| `gpt-6-luna`          | concise   | 29/30             | 97 / 142 / 168            | 86%             | 82 / 108 / 118        | 100%        |
| `gpt-6-luna`          | target120 | 30/30             | 108 / 146 / 168           | 83%             | 76 / 108 / 124        | 100%        |
| `claude-haiku-5-5`    | concise   | 29/30             | 93 / 162 / 187            | 76%             | 56 / 90 / 110         | 100%        |
| `claude-haiku-5-5`    | target120 | 30/30             | 86 / 142 / 178            | 83%             | 62 / 90 / 105         | 100%        |
| `deepseek-v4.1-flash` | concise   | 22/30             | 81 / 121 / 146            | 95%             | 51 / 73 / 85          | 100%        |
| `deepseek-v4.1-flash` | target120 | 22/30             | 79 / 98 / 106             | 100%            | 52 / 77 / 101         | 100%        |

No objective repeated its query. No query exceeded 128 characters, so none
would have hit DeepSeek's, Parallel's (200) or Yandex's (400) query limit.

DeepSeek Search, 59 comparisons against the no-`ori_question` baseline:

| Measure                                   | Count                             |
| ----------------------------------------- | --------------------------------- |
| Identical top-10 order                    | 56                                |
| Identical top-10 set                      | 56                                |
| Any `rerank_score` change on a shared URL | 5                                 |
| Top-5 Jaccard below 1.00                  | 3 (0.67 each, prompts `n2`, `p1`) |

## Conclusions

- With a "concise" instruction, 76–95% of objectives fit 128 characters, and
  the "about 120 characters" hint moves Haiku's p90 from 162 to 142 but
  barely moves GPT's. A 128-character cut applies to roughly one objective in
  five on the frontier models.
- `ori_question` had almost no effect on DeepSeek Search results for these
  queries, so whether a long objective is cut, omitted or sent whole has
  little practical consequence for that engine.
- Short query limits (128, 200, 400) are unlikely to trigger for models that
  receive the keyword-query instruction.

## Limits

- One run per cell and no DeepSeek baseline repeat, so the three differing
  comparisons may be search nondeterminism rather than `ori_question`.
- One source model for stage 2, an agent-written fixture of 30 English and
  Russian turns, and a minimal system prompt instead of llame's.
- The engine catalog in the tool description is illustrative, not llame's
  shipped description.
- DeepSeek's server-side `web_search` tool on the Responses API was not
  tested.[^deepseek-responses]

[^deepseek-search]: DeepSeek Search API reference, `ori_question` and `query` limits.

[^deepseek-responses]: DeepSeek Responses API compatibility, `web_search` tool on `deepseek-v4-pro`.
