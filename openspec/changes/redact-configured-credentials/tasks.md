Track [#1065](https://github.com/leon0399/llame/issues/1065) and
[#1098](https://github.com/leon0399/llame/issues/1098) and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- redact-configured-credentials/proposal
  <- redact-configured-credentials/bash
  <- redact-configured-credentials/model-failures
  <- redact-configured-credentials/finalize
```

| Layer                                          | Parent           | Ownership                                                                         | Authored estimate | Closes |
| ---------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- | ----------------- | ------ |
| `redact-configured-credentials/proposal`       | `master`         | The approved proposal, design, deltas, and this task list.                        | ~350              | none   |
| `redact-configured-credentials/bash`           | `proposal`       | The configured credential set and its use in bash results, with tests and docs.   | ~400              | #1065  |
| `redact-configured-credentials/model-failures` | `bash`           | Redacting every language-model failure through the client factory and title logs. | ~600              | #1098  |
| `redact-configured-credentials/finalize`       | `model-failures` | Spec sync, task records, and archive movement only.                               | ~250              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round, one of them security-focused; verify findings against the shipped specs and code; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate redact-configured-credentials --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; record Leo's approval of that revision, including decisions D1 and D2.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. bash

- [ ] 1.1 Derive the configured credential set in `loadInstanceConfig` from the resolved provider, web-search, `github` adapter, and MCP entries, normalized with `normalizeProtectedValues`; verify `config-loader.test.ts` cases for each member kind in the instance-config scenarios, a literal key, a blank key, and that `knowledge.root`, a numeric setting, and a header's literal text are absent.
- [ ] 1.2 Verify the set appears in no serialized projection: `GET /api/v1/models` and every other config-derived response; add a test that a canary credential is absent from the models response.
- [ ] 1.3 Pass the set as `protectedValues` from `apps/api/src/tools/bash.ts`; verify a `bash.ts` test where a command prints a canary provider key and a canary MCP header substitution, the result and the persisted `native.result` event contain `[REDACTED]` and neither canary, and a printed `knowledge.root` path survives.
- [ ] 1.4 Document the redaction in `docs/product/reference/tools/bash.md` and the bash operator page, including the encoded-form and short-value limits; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.5 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/instance-config src/tools`, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.6 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1065` in the PR body.

## 2. model-failures

- [ ] 2.1 Wrap the client `createModelClient` builds so `onError`, the stream result's rejections, and `generateObject` rejections redact the set from each error's message and `cause` messages, keeping the error's class name; list every consumer that branches on the error's class or `name` and verify each still classifies the wrapped error as before.
- [ ] 2.2 Route title generation's failure log through the redacted error; verify a title test where a canary credential in the upstream message is absent from the log line.
- [ ] 2.3 Verify per-wire tests, with a stubbed upstream echoing the entry's resolved key in its failure, for `openai-responses`, `openai-completions`, `anthropic-messages`, `openai-codex`, and `opencode-go`: the run's failure, its terminal run event, and its failure log line contain `[REDACTED]`; and that `Invalid API key.` with no member is reported unchanged.
- [ ] 2.4 Update the provider failure section of each provider operator runbook to state the redaction; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/models src/titles src/runs`, the run-failure integration tests that cover provider failures, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 2.6 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1098` in the PR body.

## 3. finalize

- [ ] 3.1 Enter `redact-configured-credentials/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the four added requirements appear in `instance-config` (two), `bash-execution`, and `provider-api-selection` word for word.
- [ ] 3.2 Confirm archive readiness: `openspec status --change redact-configured-credentials --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 3.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
