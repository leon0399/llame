# web_search objective spike

Noncanonical development research for the planned `web_search` `objective`
field and engine query limits. No production behavior or approved OpenSpec
scope changes.

- [Report](./report.md) - Query and objective lengths written by three models,
  and the measured effect of DeepSeek Search's `ori_question`.
- [Stage 1 runner](./experiments/web-search-objective.ts) - Drafted tool
  surface, 30 frozen prompts in six groups, two description variants and the
  summary table.
- [Stage 2 runner](./experiments/deepseek-ori-question.ts) - DeepSeek Search
  with and without `ori_question`; prints top-5 overlap with the baseline.
- [Model calls, required tool choice](./experiments/model-calls-forced.jsonl)
  and [model calls, DeepSeek flash](./experiments/model-calls-deepseek-flash.jsonl) -
  Recorded `web_search` arguments per model, variant and prompt.
- [DeepSeek search results](./experiments/deepseek-search-results.jsonl) -
  Titles, URLs and `rerank_score` per arm, for manual relevance review.

## Reproduce

The runners import llame's config loader and model clients, so they run from
`apps/api` against the operator configuration and `apps/api/.env.local`. Every
model call and DeepSeek search is billed; restrict models with `SPIKE_MODELS`.

```bash
pnpm exec turbo run build --filter=api^...
cp -r docs/research/tool-harness/2026-10-26-web-search-objective-spike/experiments apps/api/spike
cd apps/api
SPIKE_MODELS=<id>,<id> SPIKE_OUT=spike/out/calls.jsonl pnpm exec tsx spike/web-search-objective.ts
SPIKE_IN=spike/out/calls.jsonl SPIKE_SOURCE_MODEL=<id> pnpm exec tsx spike/deepseek-ori-question.ts
```

Set `SPIKE_TOOL_CHOICE=auto` for endpoints that reject a required tool choice.
Delete `apps/api/spike` afterwards.
