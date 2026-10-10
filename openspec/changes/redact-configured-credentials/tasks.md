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

| Layer                                          | Parent           | Ownership                                                                                                           | Authored estimate | Closes |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `redact-configured-credentials/proposal`       | `master`         | The approved proposal, design, deltas, and this task list.                                                          | ~700              | none   |
| `redact-configured-credentials/bash`           | `proposal`       | The configured credential set, one intervals redaction routine, and raw-position bash cutting, with tests and docs. | ~1,000            | #1065  |
| `redact-configured-credentials/model-failures` | `bash`           | Redacting every language-model failure through the client factory and title logs, keeping error identity.           | ~700              | #1098  |
| `redact-configured-credentials/finalize`       | `model-failures` | Spec sync, task records, and archive movement only.                                                                 | ~250              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round, one of them security-focused; verify findings against the shipped specs and code; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate redact-configured-credentials --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized script diff of each MODIFIED block against its canonical requirement keeping every canonical scenario in order; record Leo's approval of that revision, including proposal decisions A1-A4.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. bash

- [ ] 1.1 Extend `@workspace/config-interpolation` so a `{path:…|json:…}` substitution reports its document's string leaves from the same single read, with tests; then collect the configured credential set in `loadInstanceConfig` while resolving each member field (design D1), applying the 8-character floor and the credential-shaped name rule; verify `config-loader.test.ts` cases for every scenario of the five `instance-config` requirements, including a literal key, a blank key, a Codex document's refresh token present and its timestamp absent, `POSTGRES_URL`, its password, `PGPASSWORD`, a `postgres://app:app@…` password absent, a credential-shaped literal MCP header present and `Accept` absent, a SearXNG base URL substitution present, and `knowledge.root`, a numeric setting, and a stdio `args` substitution absent.
- [ ] 1.2 Verify the set appears in no serialized projection: a canary credential is absent from `GET /api/v1/models` and every other configuration-derived response.
- [ ] 1.3 Extend `redactProtectedString` in `@workspace/runtime-safety` to merge overlapping and adjacent match intervals into one marker (design D4); verify unit tests for containment, partial overlap, adjacency, and that existing MCP redaction tests still pass.
- [ ] 1.4 In `packages/bash-executor`, decode streams with a streaming UTF-8 decoder and implement design D2's four raw-position steps; verify `watch.test.ts` cases for a member just before the bound, an earlier long member followed by the longest member just past the bound, a crossing member whose last character begins another member, a short member contained in a longer one with the stream force-closed inside the longer, a non-ASCII member split across chunks, and a stream force-closed mid-member, each yielding no character of any member and correct truncation metadata; and that the contract tests still pass.
- [ ] 1.5 Pass the set as `protectedValues` from `apps/api/src/tools/bash.ts`; verify a `bash.ts` test where a command prints a canary provider key and a canary MCP header value, the result and the persisted `native.result` event contain `[REDACTED]` and neither canary, and a printed `knowledge.root` path survives.
- [ ] 1.6 Document the redaction, its threat model, the boot snapshot, and the encoded-form and short-value limits in `docs/product/reference/tools/bash.md` and the bash operator page; correct `docs/product/operator/providers/codex-subscription.md`, which says llame never reads refresh or ID tokens, to say the loader reads them only to redact them; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.7 Verify the layer: `pnpm --filter @workspace/config-interpolation test`, `pnpm --filter @workspace/runtime-safety test`, `pnpm --filter @workspace/bash-executor test`, in `apps/api` `pnpm exec vitest run --project unit src/instance-config src/tools src/mcp`, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.8 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.9 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1065` in the PR body.

## 2. model-failures

- [ ] 2.1 List every consumer that branches on a language-model failure (`instanceof`, `isInstance`, `name`, `statusCode`, `lastError`, `code`, abort reasons) and record the list in the PR body; wrap the client `createModelClient` builds per design D3; verify each listed consumer classifies a credential-bearing failure exactly as the same failure without it, that `name` and `code` are unchanged, and that a member inside `cause`, `lastError`, and `errors[]` is redacted.
- [ ] 2.2 Verify the wrapper always installs an `onError` and that a request with no caller handler logs only the redacted error, with no raw SDK object in the log line.
- [ ] 2.3 Route title generation's failure log through the redacted error; verify a title test where a canary credential in the upstream message is absent from the log line.
- [ ] 2.4 Verify per-wire tests with a stubbed upstream echoing the entry's resolved key: `openai-responses`, `openai-completions`, and `opencode-go` report `[REDACTED]` in the run's failure, its terminal event, and its log line; `anthropic-messages` and `openai-codex` report no key; a non-retried `openai-completions` envelope `Invalid API key.` is reported unchanged; and, for the "Every request kind is covered" scenario, a configured header substitution echoed in a compaction failure, a hosted web search failure, and a rejected structured generation is absent from every recorded, emitted, and logged message.
- [ ] 2.5 Update the provider failure section of each provider operator runbook to state the redaction; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 2.6 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/models src/titles src/runs src/tools/web-search`, the run-failure integration tests that cover provider failures, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 2.7 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 2.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1098` in the PR body.

## 3. finalize

- [ ] 3.1 Enter `redact-configured-credentials/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the five added `instance-config` requirements and the added `provider-api-selection` requirement appear word for word, and that each MODIFIED requirement in `bash-execution`, `provider-api-selection`, `opencode-go-provider`, and `provider-request-headers` matches its delta with every canonical scenario kept. If `reconcile-opencode-go-route-failure-wording` (#1200) synced first, rebuild the `opencode-go-provider` delta from the new canonical text before syncing; if this change syncs first, rebuild #1200's delta so it keeps the credential exception, and record that on #1200.
- [ ] 3.2 Confirm archive readiness: `openspec status --change redact-configured-credentials --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 3.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
