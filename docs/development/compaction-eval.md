# Compaction eval

The compaction eval exercises the production summarization path against five
small transcripts and one OpenCode Go model request per transcript. It uses the
same packaged `COMPACTION_INSTRUCTION` and `buildCompactionRequest` as live
compaction, but runs outside Vitest and does not need Postgres.

## Prerequisites

- Node and pnpm are installed and dependencies are present (`pnpm install`).
- An OpenCode Go subscription key is available as `OPENCODE_GO_API_KEY`.
- The configured `longcat-2.5-preview-free` model is available to the OpenCode Go
  gateway. The eval declares that provider and model in
  `apps/api/evals/compaction/eval.config.json`; it does not use the operator's
  `llame.config.jsonc`.

The runner forces `LLAME_CONFIG_PATH` to that eval config and resolves the key
through the production `{env:OPENCODE_GO_API_KEY}` interpolation. Do not paste
the key into the config or a fixture.

## Run

From the repository root:

```bash
OPENCODE_GO_API_KEY=... pnpm --filter api eval:compaction
```

The command prints one `PASS` or `FAIL` row for each fixture and exits nonzero
if setup fails, a model request fails, or any assertion fails. It is intentionally
not part of `test:integration`, `test:coverage`, or CI; runs that reach a model
request spend provider quota.

To check the setup failure without making a provider request, run:

```bash
cd apps/api
env -u OPENCODE_GO_API_KEY pnpm eval:compaction
```

The output must name the configuration failure and
`OPENCODE_GO_API_KEY is not set`. An unknown configured model fails similarly
with a named model error before fixtures are sent.

## Assertions

The fixtures cover a correction, a cancelled task, a pasted fake token, a
Spanish conversation, and an unresolved question. The runner checks that:

- the fake token is absent while `[REDACTED]` is present;
- the cancelled task is absent from `Active` and `Open Questions and Next
Steps`;
- the unresolved question is quoted verbatim under `Latest Request`;
- the correction appears under `Errors and Corrections` and the superseded
  value is absent from the active or open-question sections; and
- the Spanish summary contains the fixture's Spanish language marker and a
  specified fact, with no English marker words in section bodies outside code
  spans.

The eval is a model-quality signal, not a replacement for the pinned-string
unit tests for the packaged instruction and checkpoint envelope. A failed row
should be investigated as either a prompt/model regression or a changed
fixture expectation; do not weaken the assertion merely to make a run green.
