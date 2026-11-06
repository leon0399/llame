# Proposal

## Why

`grep` returns its passages in walk order and `web_search` in engine order.
On a large result the inline head shows the first files of a byte-ordered
walk, or the engine's generic top hits, while the file or page that answers
the model's question sits in the artifact. The model then reads the artifact
page by page, or stops early.

A decision model (System One / Jev class: one forward pass over a shared
state and keyed yes/no questions, calibrated probabilities out, no generated
text) can order those candidates by the call's `objective` for a fraction of
a cent and under a second. The experimental stack
([#1584](https://github.com/leon0399/llame/pull/1584),
[#1588](https://github.com/leon0399/llame/pull/1588),
[#1590](https://github.com/leon0399/llame/pull/1590)) proved the mechanics on
live keys (measurements recorded in
[#1590's measurement comment](https://github.com/leon0399/llame/pull/1590#issuecomment-6685284326)):
on a 162-file walk of `apps/api/src` the implementing file,
`db/tenant-db.service.ts`, ranked first at 0.75; on a 469-file walk
`tools/permissions/evaluator.ts` ranked first at 0.81, judged in two parallel
requests for $0.0037 in 0.6 s; on a synthetic 30-file fixture the three
implementations scored 0.74–0.83 against 0.03–0.04 for comment-only files on
every probed model. The research behind it is
[#1524](https://github.com/leon0399/llame/pull/1524) (objective-ranked
results) and [#1581](https://github.com/leon0399/llame/pull/1581) (decision
models as an open, self-hostable class).

Issues: [#1521](https://github.com/leon0399/llame/issues/1521) (shared
ranking engine with an objective on `grep`),
[#1433](https://github.com/leon0399/llame/issues/1433) (rerank stage for web
search), [#1435](https://github.com/leon0399/llame/issues/1435) (judge-model
backend); tracking
[#1518](https://github.com/leon0399/llame/issues/1518) and
[#1430](https://github.com/leon0399/llame/issues/1430).
[#1520](https://github.com/leon0399/llame/issues/1520) is closed as not
planned: it evaluated a local deterministic ranker that is not built; the
measurement it wanted moves to the fixture set below.

This change turns the experiment into shipped behavior. The design decisions
were settled with Leo in a grilling round on 2026-11-06 (D1–D14 in
[design.md](design.md)).

## What Changes

- **New capability `decision-models`.** A `providers[]` entry of
  `type: "system-one"` (`{ id, type, key, baseUrl, headers? }`) speaks the
  System One decision wire: `POST {baseUrl}/systemone` with one shared
  `state` and keyed `noul` questions. A top-level `decisionModels[]` catalog
  (`{ id, provider, model }`) names the models, beside `embeddingModels[]`.
  A `models[]` or `embeddingModels[]` entry that names a `system-one`
  provider fails startup. The lane packs up to 256 cards with their
  questions per request, sends every request of a call at once, retries only
  transient failures, never throws, and answers `unavailable` or partial
  rather than failing the tool call. Each call logs one structured line. The
  state is framed as untrusted data; resolved secrets never reach logs or
  results. `GET /api/v1/models` does not list decision models. A
  `system-one` provider has an empty default header map, and `{session:id}`
  in its headers fails startup.
- **Shared ranking engine.** Cards plus a decision model in; one of
  `ranked`, `partial`, or `unavailable` out, with an order that is a
  permutation of the input, the per-card scores, the served model, latency,
  and cost. Judged cards sort by score, ties and unjudged cards keep
  canonical order. Both tools use it.
- **`grep` accepts `objective`** (1–2,000 units) and, with
  `tools.grep.rerank: { model }` set, orders whole file runs by it after the
  walk. The walk, its counts, its stop, every bound and every admission are
  unchanged. Ranking runs only when the result does not fit inline. The
  inline head, the artifact text, and its findings share the ranked order;
  each run keeps one `## <path>` line. A lane failure keeps walk order and
  adds one framing line.
- **`web_search` reranks every `results` outcome** with
  `webSearch.rerank: { model }` set, whatever engine won, before the inline
  cut and the artifact. Answers are not ranked. Ranking runs only when the
  output does not fit the inline part (more than `limit` fetched, or cut by
  the inline bound). A lane failure keeps engine order and adds one note.
  **One engine's list is deduplicated by the aggregate's grouping key**
  before ranking and output.
- **`display.rerank`** on both results records the served model, the order
  of every card, the scores of the judged ones, latency, and cost (the
  wire's reported cost, else `null`). It is display data under the existing
  rule: stored, never rendered to the model. A failed call stores none.
- **Owner UI.** The grep and web search parts show a ranking badge (served
  model, latency, cost) and a per-row score.
- **Evaluation fixtures.** A labeled fixture set (hand-labeled subsets of
  at most 40 cards per case) and a `ranking:eval` script report nDCG@5, MRR,
  latency, and cost for canonical order against each catalog model;
  recorded answers, regenerated by a named command, pin the unit tests. No
  default model: the operator chooses by the numbers.
- **Explicit egress consent by configuration.** Naming a model in a tool's
  `rerank` block is the operator's declaration that everything that tool
  admits (host files, `kb://`, `machine://`, web snippets) may be sent to
  that endpoint. The operator documentation states it. #1518's constraint 3
  and #1522/#1523 are reworded to this.
- **Not in this change.** Accounting of decision calls in Run usage: a new
  issue "side-call usage ledger" absorbs
  [#1439](https://github.com/leon0399/llame/issues/1439). The AI SDK 7
  transport swap (`experimental_decide`): a new issue. Data-class
  declarations, `shadow` mode, rubric overrides, cross-encoder and LLM
  backends ([#1434](https://github.com/leon0399/llame/issues/1434),
  [#1436](https://github.com/leon0399/llame/issues/1436)), recall and
  Knowledge consumers ([#1522](https://github.com/leon0399/llame/issues/1522),
  [#1523](https://github.com/leon0399/llame/issues/1523)).
- **Acceptance criteria dropped from the closed issues**, recorded on them
  by the proposal layer: #1521's and #1433's shadow-record criteria (no
  `shadow` mode); #1521's "no score leaves the engine" (scores are display
  data for the owner, never model-facing); #1521's local stage-1 ranking,
  literal-anchor pinning, and "unjudged findings keep canonical positions"
  (unjudged runs follow the judged ones in canonical order); #1430's
  "a single objective-ranked engine is not reranked".

## Capabilities

### New Capabilities

- `decision-models`: the System One provider type, the `decisionModels[]`
  catalog, the request and answer contract of one decision call, its
  bounds, failure behavior, logging, and secrecy.

### Modified Capabilities

- `instance-config`: the provider `type` set gains `system-one`; a new
  top-level `decisionModels[]` catalog; `webSearch.rerank` and
  `tools.grep.rerank` blocks whose `model` must name a catalog id; a model or
  embedding entry cannot name a decision provider.
- `provider-request-headers`: the `system-one` default header map is empty
  and `{session:id}` is refused on it.
- `grep-tool`: the input gains `objective`; a ranked order for whole file
  runs when a rerank model is configured and the result does not fit the
  inline part; canonical order stays the order of the walk, bounds, and
  counts; the inline reserve for the failure line; the `ranking` field; the
  artifact and findings follow the ranked order.
- `web-search`: the rerank stage on every `results` outcome; within-engine
  URL deduplication before ranking; the failure note.
- `tool-result-rendering`: the `display.rerank` record, the grep failure
  line, the web search note, and the owner UI badge.

## Impact

- `apps/api`: `src/decisions/` (client, protocol, service, logger, module),
  `src/ranking/` (shared engine), `src/instance-config/` (schema, loader,
  rerank config), `src/tools/grep*.ts`, `src/tools/web-search/*`,
  `src/prompts/tools/{grep,web_search}.md`, `src/tools/types.ts`
  (`ToolContext.decisions`), `src/runs/run-execution.service.ts`,
  `fixtures/ranking/`, a `ranking:eval` script.
- `apps/web` and `packages/ui`: `custom/grep.tsx`, `custom/web-search.tsx`,
  stories.
- Docs: `docs/product/operator/decisions.md`,
  `docs/product/reference/tools/{grep,web-search}.md`, `CHANGELOG.md`,
  `apps/api/llame.config.jsonc.example`, `llame.config.schema.json`.
- No database change. No change to the chat model request, receipts, or Run
  usage.
- Network egress: a configured decision endpoint receives card text from the
  tools that name it. Credentials use `{env:}`/`{path:}` interpolation and
  are redacted everywhere.
