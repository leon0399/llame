Track [#1065](https://github.com/leon0399/llame/issues/1065) and
[#1098](https://github.com/leon0399/llame/issues/1098) and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

For this delivery Leo authorized concurrent development: each layer gets
independent correctness and security review plus simplify and ponytail-review
passes, then test CI is driven green. Mutation testing and external review
continue on earlier layers while the next layer is developed; they remain
delivery work, not prerequisites for starting that development.

```text
master
  <- redact-configured-credentials/proposal
  <- redact-configured-credentials/credential-set
  <- redact-configured-credentials/bash
  <- redact-configured-credentials/model-failures
  <- redact-configured-credentials/finalize
```

| Layer                                          | Parent           | Ownership                                                                                                                      | Authored estimate | Closes |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------ |
| `redact-configured-credentials/proposal`       | `master`         | The approved proposal, design, deltas, and this task list.                                                                     | ~750              | none   |
| `redact-configured-credentials/credential-set` | `proposal`       | Substitution values and document leaves, and the configured credential set the loader collects, with tests.                    | ~1,000            | none   |
| `redact-configured-credentials/bash`           | `credential-set` | One intervals redaction routine and raw-position bash redaction on the host, `ssh://`, and Machine paths, with tests and docs. | ~1,100            | #1065  |
| `redact-configured-credentials/model-failures` | `bash`           | Redacting every language-model failure through the client factory and title logs, keeping error identity.                      | ~800              | #1098  |
| `redact-configured-credentials/finalize`       | `model-failures` | Spec sync, task records, and archive movement only.                                                                            | ~250              | none   |

## 0. proposal

- [x] 0.1 Run adversarial review with two independent reviewers per round, one of them security-focused; verify findings against the shipped specs and code; commit each round separately.
- [x] 0.2 Prove the final revision: `pnpm exec openspec validate redact-configured-credentials --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized script diff of each MODIFIED block against its canonical requirement keeping every canonical scenario in order; record Leo's approval of that revision, including proposal decisions A1-A4.
- [x] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [x] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. credential-set

- [ ] 1.1 Extend `@workspace/config-interpolation` so each substitution reports whether a `:-` fallback applied, and a `{path:…|json:…}` substitution reports its document's string leaves from the same single read, with tests; then collect the configured credential set in `loadInstanceConfig` while resolving the fields that design D1 lists: each provider and web search `key`, the `github` adapter `token`, header and stdio `env` substitutions, credential-shaped document leaves, and the `POSTGRES_URL` password and `PGPASSWORD` from the loader's `env`; apply the 16-character and 64-bit entropy gate and the credential-shaped name rule for document leaves, and expose the set only through the D1 accessor; verify `config-loader.test.ts` cases for every configuration-side scenario of the seven `instance-config` requirements, including a provider, engine, and adapter credential present and the `yandex` `folderId` and `openai-codex` `accountId` absent, `app` and `postgres` absent with a 32-character hex key and a passphrase present, a short `sk-` value absent, a Codex document's refresh and id tokens and an array under a credential name present with its timestamp absent, `POSTGRES_URL`'s password and `PGPASSWORD` present and the whole URL absent, a provider and remote MCP header substitution and a stdio `env` substitution present with `Bearer`, a header name, a variable name, and a `:-` fallback absent, a URL and its userinfo and query values, a literal header, a stdio `command` and `args` value, a `{session:id}` value, a keyless placeholder, `knowledge.root`, a numeric setting, and a `searxng` `baseUrl` absent, and an unchanged deep-equality result for a configuration with no members.
- [ ] 1.2 Verify the set appears in no serialized projection: a high-entropy canary credential is absent from `GET /api/v1/models` and every other configuration-derived response.
- [ ] 1.3 Verify the layer: `pnpm --filter @workspace/config-interpolation test`, in `apps/api` `pnpm exec vitest run --project unit src/instance-config src/models`, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.4 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.5 Pass the GitHub review and CI gate under Ready-PR monitoring, referencing #1065 and #1098 without closing either.

## 2. bash

- [ ] 2.1 Add `protectedValueIntervals` to `@workspace/runtime-safety`, returning merged raw match intervals, and rebuild `redactProtectedString` on it (design D4); verify unit tests for containment, partial overlap, adjacency, and that existing MCP redaction tests still pass.
- [ ] 2.2 In `packages/bash-executor`, implement design D2's three raw-position steps in `sanitizeKnownResult`, accepting a `BashKnownResult` or a `BashTimedOutResult` and per-stream capture metadata (the ended-by-llame flag and an optional gap position), in the bound's unit, replacing `sanitize.ts` `sanitizeStream`'s split/join redaction and its clip of unredacted text; keep a host capture lookahead of the longest member past the bound, and pass whether llame ended each stream (capture limit or timeout); verify `watch.test.ts` and `sanitize`/contract cases for a member just before the bound, an earlier long member followed by the longest member just past the bound, a crossing member whose last character begins another member, a short member contained in a longer one with the capture cut inside the longer, a non-ASCII member split across chunks and across the byte bound, a capture cut mid-member, and a timeout kill mid-member whose stream ends within the drain, each yielding no character of any member and correct truncation metadata; a natural exit whose output ends in a member prefix keeps that tail; and that the contract tests still pass.
- [ ] 2.3 Thread the set from the D1 accessor into the run's tool context; pass it as `protectedValues` from `apps/api/src/tools/bash.ts` to the host executor, to `ssh-bash.ts`'s `sanitizeKnownResult` call (preserving the stderr head/tail gap offset in the collector, mapping it into `commandStderr` in the parser, and trimming both gap sides as design D2 step 2 requires), and to a hub-side `sanitizeKnownResult` on the Machine's `proc.bash` answer before `spillBashResult`; verify host, `ssh://`, and Machine tests where a command prints a canary provider key and a canary MCP header value, the result, its artifact parts, and the persisted `native.result` event contain `[REDACTED]` and neither canary, no canary appears in the request sent to the ssh client or the Machine, a Machine answer truncated mid-canary leaves no prefix, and a printed `knowledge.root` path survives.
- [ ] 2.4 Document the redaction, its threat model, the boot snapshot, the entropy gate and its accepted leak (a credential under 16 characters or 64 estimated bits, no part of a provider `baseUrl` or remote MCP `url`, a literal header value, a stdio `command` or `args` substitution, or the `openai-codex` `accountId` is not a member), the encoded-form limits, and that non-secrets are written literally, in `docs/product/reference/tools/bash.md` and the bash operator page; correct `docs/product/operator/providers/codex-subscription.md`, which says llame never reads refresh or ID tokens, to say the loader reads them only to redact them; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: `pnpm --filter @workspace/runtime-safety test`, `pnpm --filter @workspace/bash-executor test`, in `apps/api` `pnpm exec vitest run --project unit src/tools src/mcp src/machines`, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 2.6 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1065` in the PR body.

## 3. model-failures

- [ ] 3.1 List every consumer that branches on a language-model failure (`instanceof`, `isInstance`, `name`, `statusCode`, `lastError`, `code`, abort reasons) and record the list in the PR body; wrap the client `createModelClient` builds per design D3; verify each listed consumer classifies a credential-bearing failure exactly as the same failure without it, that `name` and `code` are unchanged, that a symbol-keyed AI SDK marker survives, and that a member inside `cause`, `lastError`, and `errors[]` is redacted. With a synthetic test double (no shipped SDK produces one), verify that an error whose credential-bearing `message` is non-writable and non-configurable, and a frozen error, each reach the run, its event, and the logger as a redacted replacement that still passes `instanceof` and `isInstance` for its class, and never as the original object.
- [ ] 3.2 Verify the wrapper always installs an `onError` and that a request with no caller handler logs only the redacted error, with no raw SDK object in the log line.
- [ ] 3.3 Route title generation's failure log through the redacted error; verify a title test where a canary credential in the upstream message is absent from the log line.
- [ ] 3.4 Verify per-wire tests with a stubbed upstream echoing the entry's resolved key: `openai-responses`, `openai-completions`, and `opencode-go` report `[REDACTED]` in the run's failure, its terminal event, and its log line; `anthropic-messages` and `openai-codex` report no key; a non-retried `openai-completions` envelope `Invalid API key.` is reported unchanged; for the "Every request kind is covered" scenario, a configured header substitution echoed in a compaction failure, a hosted web search failure, and a rejected structured generation is absent from every recorded, emitted, and logged message; and an `openai-responses` stream that fails after output begins with a plain `error` or `response.failed` envelope, the canary in its `message` and `code`, reaches the run handler and the Sentry event without the canary.
- [ ] 3.5 Update the provider failure section of each provider operator runbook to state the redaction; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 3.6 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/models src/titles src/runs src/tools/web-search`, the run-failure integration tests that cover provider failures, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 3.7 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 3.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1098` in the PR body.

## 4. finalize

- [ ] 4.1 Enter `redact-configured-credentials/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the seven added `instance-config` requirements and the added `provider-api-selection` requirement appear word for word, and that each MODIFIED requirement in `bash-execution`, `provider-api-selection`, `opencode-go-provider`, and `provider-request-headers` matches its delta with every canonical scenario kept. If `reconcile-opencode-go-route-failure-wording` (#1200) synced first, rebuild the `opencode-go-provider` delta from the new canonical text before syncing; if this change syncs first, rebuild #1200's delta so it keeps the credential exception, and record that on #1200.
- [ ] 4.2 Confirm archive readiness: `openspec status --change redact-configured-credentials --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 4.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
