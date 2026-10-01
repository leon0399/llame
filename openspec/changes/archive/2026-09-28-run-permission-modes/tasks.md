Track [#977](https://github.com/leon0399/llame/issues/977) and its PR layers through
[Project tracking](../../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision; keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Every layer
is created and published with `$gh-stack`, implemented with `$openspec-apply-change`, self-reviewed
before it is marked ready, and monitored per `CONTRIBUTING.md`.

```text
(master) <- run-permission-modes/proposal
         <- run-permission-modes/api
         <- run-permission-modes/web
         <- run-permission-modes/finalize
```

| Layer      | Parent     | Owns                                                                                                                                                         | Estimated authored lines                                                                    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `api`      | `proposal` | configuration gate, accept-time validation, Run persistence, the permission-admission seam and bypass decisions, usage, the listing endpoint, and their docs | about 1,100, plus generated migration metadata and OpenAPI client churn reported separately |
| `web`      | `api`      | the composer selector, per-chat selection, send transport, usage badge, and their stories and docs; closes #977                                              | about 550                                                                                   |
| `finalize` | `web`      | spec synchronization, task records, and archive movement only                                                                                                | under 100                                                                                   |

Every layer leaves the repository shippable. After `api` merges, an operator who enables `bypass`
can use it through the API and every Run reports its mode; the web client still sends no mode.
After `web` merges, owners select the mode in the composer and see bypassed turns in the badge.
Each shipping layer adds its own operator documentation and dated `CHANGELOG.md` entry.

## 1. `run-permission-modes/api` — gate, persistence, bypass admission, listing (design D1–D10)

- [x] 1.1 Add optional `tools.permissionModes` to `llame-config.ts`, the loader, the published `llame.config.schema.json`, and `llame.config.json.example` (commented, showing `["default", "bypass"]` without enabling it), with the `["default"]` default; verify by unit tests that omission, `["default"]`, and `["default", "bypass"]` load in order, and that `[]`, `["bypass"]`, an unknown value, a duplicate, a non-string, and an interpolation token each fail naming `tools.permissionModes`, per the `instance-config` delta
- [x] 1.2 Add `runs.permission_mode` (`text not null default 'default'`, check constraint over the known values) to the schema with one generated Drizzle migration; verify `pnpm db:generate` reports no further changes, the migration applies on the integration database, and a pre-existing Run row reads `default`
- [x] 1.3 Add `permissionMode` to `CreateMessageDto` (optional enum `default | bypass`), validate it in `chat-loop.service.ts` after model and effort and before any database work against the API's enabled modes with a `PermissionModeNotAvailableError` (422 `permission_mode_not_available`) mapped in `chats.controller.ts`, and persist it on the Run in the accept transaction; verify by unit and pretransaction tests every `permission-modes` "Chat sends accept an optional permission mode" scenario, including that a rejected mode opens no tenant transaction and enqueues nothing
- [x] 1.4 Return the persisted mode from the claim transaction beside `effort` and resolve the attempt's effective mode against the worker's `tools.permissionModes`; add `permissionMode` to `RunResponse` and `ContextReceiptResponse`; verify by integration tests that a `bypass` Run on a bypass-enabled worker resolves `bypass`, the same Run on a default-only worker resolves `default`, both responses report the accepted mode, and user B cannot read user A's Run or receipt
- [x] 1.5 Add the `permission_mode_bypass` allow reason to `PermissionDecision`, an optional `permissionMode` on `ToolContext` (absent means `default`), and a single `admitPermission(context, options)` beside the evaluator; route `tools/runner.ts`, both paths in `tools/web-read/admission.ts`, and both checks in `tools/workspace.ts` through it, and have the Workspace re-check in `run-execution.service.ts` skip evaluation under an effective `bypass`; verify by unit tests, per site, that `default` decides exactly as before and `bypass` admits with reason `permission_mode_bypass`, the process policy ID, and no clause reference, and that a `bypass` web read produces no address record
- [x] 1.6 Accept `permission_mode_bypass` in durable transcript reconstruction (`runs/assistant-transcript.ts`) for call and derived-locator decisions while still dropping unknown reasons; verify by unit tests that a stored bypass decision reconstructs on the tool part and that an unknown reason is still dropped
- [x] 1.7 Integration tests with the scripted model client and the recommended policy covering the `tool-call-permissions` delta: a `bypass` Run executes a B6-rejected Bash call and records its bypass decision before `tool.started`; the same call in `default` is rejected; a `bypass` Run on a default-only worker is rejected by B6; a `bypass` `enter_workspace` binds `/tmp/project` and the next `default` Run detaches it with `permission_rejected`; a `bypass` read of another owner's `kb://` Space is refused; a tool outside `tools.allowed` stays unavailable under `bypass`
- [x] 1.8 Write `usage.permissionMode: "bypass"` through `buildTurnTelemetry` only for an attempt whose effective mode is `bypass`, on both the completed and non-completed terminal paths; verify by unit tests that a bypassed turn records it, a downgraded or `default` turn omits it, and that a fork copies it while the public share projection carries no usage
- [x] 1.9 Verify the mode never reaches model context: a unit test that two otherwise identical Runs in `default` and `bypass` render byte-identical system prompts, receipts, and context items
- [x] 1.10 Add `GET /api/v1/permission-modes` (`listPermissionModes`, cookie-authenticated) returning `{ modes: [{ value }] }` in configuration order, and regenerate the OpenAPI document and web client; verify by controller tests for the default and bypass-enabled lists and a 401 without a session, and that a second generation produces a clean diff
- [x] 1.11 Document `tools.permissionModes`, the instance-wide effect of enabling `bypass`, what it does and does not relax, prompt-injection and Workspace MCP exposure, and the `permission_mode_bypass` record in `docs/product/operator/native-files.md`; update `SPEC.md` §8 and §13 and `README.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 1.12 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests for the touched modules, and the touched integration suites
- [x] 1.13 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [x] 1.14 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `run-permission-modes/web` — composer selector and usage badge (design D11)

- [x] 2.1 Add the per-chat permission-mode selection to `ChatContext` (stored with the chat id it was chosen in, `default` for any other chat, never persisted) and send `permissionMode: "bypass"` only while selected, through the latest-value reference pattern in `use-chat-engine.ts` and `prepareSendMessagesRequest`; verify by transport unit tests that `bypass` is sent verbatim and `default` omits the field, and by a chat-page test that navigating to another chat reads `default`
- [x] 2.2 Add `PermissionModeSelector` at the left of `PromptInputToolbar`: a dropdown with radio items, a title and one-line description per mode, rendering nothing unless the generated listing hook returns at least two modes, and the destructive `Button` variant while `bypass` is selected; add its stories (default-only hidden, both modes, bypass selected, listing failed); verify with Storybook MCP story tests and return the preview URLs, or the Storybook CLI fallback when MCP is unavailable
- [x] 2.3 On a send rejected with `permission_mode_not_available`, invalidate the listing query and reset that chat's selection to `default`; verify by a chat-page test with a mocked 422
- [x] 2.4 Parse `usage.permissionMode` in `message-usage.tsx` and render the `Bypass` segment after effort and before latency, plus a mode row in the usage detail; verify by `message-usage` unit tests that a bypass usage renders `GPT-5 · high · Bypass · 900ms` and that usage without a mode renders exactly as before, and update the affected chat-message-row story
- [x] 2.5 Update `README.md` for the composer control and add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #977`; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 2.6 Verify `pnpm --filter web lint`, `typecheck`, and the focused unit tests, and exercise the composer in a browser against a bypass-enabled API: select `bypass`, send a call the policy rejects, observe it execute and the badge show `Bypass`, then reload and observe `default`
- [x] 2.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 2.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `run-permission-modes/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the `web` top before `$openspec-sync-specs` writes. Its
self-review and GitHub review are post-archive gates, not tasks here.

- [x] 3.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass
- [x] 3.2 Confirm `openspec status --change run-permission-modes --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean
