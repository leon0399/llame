Track [#974](https://github.com/leon0399/llame/issues/974) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#975](https://github.com/leon0399/llame/issues/975), [#976](https://github.com/leon0399/llame/issues/976), [#977](https://github.com/leon0399/llame/issues/977), and [#758](https://github.com/leon0399/llame/issues/758) are separate work, not native blockers. [#978](https://github.com/leon0399/llame/pull/978) removes the superseded `tool-search` change independently.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- workspace-entry/proposal
         <- workspace-entry/core
         <- workspace-entry/web
         <- workspace-entry/skills
         <- workspace-entry/mcp-authorization
         <- workspace-entry/workspace-mcp
         <- workspace-entry/finalize
```

- `proposal` owns only proposal, design, the delta specs, and this task list.
- `core` (parent `proposal`, estimated 1,700 authored lines): the binding, both tools, relative-path projection for execution and permissions, re-check and detach, narration, and forks. Its PR references #974.
- `web` (parent `core`, estimated 300 authored lines): the chat API binding field and the chat-header indicator. References #974.
- `skills` (parent `web`, estimated 600 authored lines): Workspace skill sources. References #974.
- `mcp-authorization` (parent `skills`, estimated 700 authored lines): retire the MCP read-only attestation for all servers. References #974.
- `workspace-mcp` (parent `mcp-authorization`, estimated 1,900 authored lines): mid-Run tool additions, their Run record and receipt row, and Workspace MCP clients. Its merge completes #974's acceptance, so its PR uses `Closes #974`.
- `finalize` owns only spec sync, checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file. UI presentation details live here and in design.md, not in the specs.

## 1. `workspace-entry/core`: binding, tools, projection, and narration

- [ ] 1.1 Add nullable `workspace_root`, `workspace_executor_id`, and `workspace_told` to `chats` with a generated Drizzle migration (design D1). Verify `pnpm db:generate` reproduces it, the migration applies to a populated database, and an integration test shows user A cannot read or write user B's binding columns under RLS.
- [ ] 1.2 Add the pure `resolveWorkspacePath` projection and feed it to `read`, `edit`, `write` path handling and bash `cwd` through `ToolContext.workspaceRoot` (design D3, D5). Verify with unit tests for each native-file-tools and bash-execution scenario in this change: entered relative read, `..` leaving the root, unentered relative refusal, omitted bash `cwd` defaulting to the root, relative bash `cwd`, and locator schemes unaffected.
- [ ] 1.3 Evaluate projected values in `evaluateToolPermission`, including the implied bash `cwd` (design D3). Verify with permission tests for every tool-call-permissions scenario in this change, including `read("../../.ssh/id_ed25519")` rejected by an absolute `.ssh` reject and an omitted bash `cwd` rejected by a `cwd` reject on the root.
- [ ] 1.4 Register `enter_workspace` and `exit_workspace` as host-capability tools with packaged description prompts and schemas; implement canonicalization, dual-path permission evaluation, switching, the fenced binding write, and the result shape without skills or MCP (design D2). Verify with tests for the workspace-entry tool scenarios: non-absolute path, non-directory, symlink whose canonical target is rejected, switch, exit, missing `nativeExecutorId`, and a superseded attempt that cannot write the binding.
- [ ] 1.5 Re-check the binding during accepted-turn preparation and detach on executor mismatch, missing root, or a permission reject, staging the clear with the other chat-row state (design D4). Verify with integration tests for each detach cause, that a retried attempt does not reattach, and that a detached binding stays cleared after the executor returns.
- [ ] 1.6 Add the `workspace` context-item producer with its packaged template and told-state comparison, reset by a newly active compaction (design D6). Verify with tests that entry is narrated on the next accepted turn, detach carries its reason, an unchanged binding emits nothing, compaction re-establishes the current root, and the rendered system prompt is byte-identical before and after entry.
- [ ] 1.7 Copy the binding, but not its told-state, in owner forks. Verify with a fork integration test that the fork keeps the binding, its first accepted turn narrates it, its first Run re-checks it, and a fork of an unbound Chat stays unbound.
- [ ] 1.8 Document the nine-group recommended policy in `llame.config.json.example`, Workspace entry and its host-authority boundary in `docs/native-files.md`, the native-host line in `SPEC.md`, and one paragraph in `docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md` recording the absolute-path exception to §5.4; add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 1.9 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused API integration files touched above, `pnpm format:check`, `git diff --check`, and `pnpm exec openspec validate workspace-entry --strict`; record the commands in the PR body.
- [ ] 1.10 Self-review (SR) the parent-relative draft diff against REVIEW_GUIDE.md, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 1.11 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `web` layer.

## 2. `workspace-entry/web`: binding indicator

- [ ] 2.1 Expose the current binding root on the owner's chat API response and regenerate the OpenAPI client. Verify with an API test that the owner sees the root, another owner receives 404 for the Chat, and a second generation produces no diff.
- [ ] 2.2 Show the bound root in the chat header, updating after entry, exit, and detach, using existing design-system components and tokens per DESIGN.md. Verify with component tests and a story; run the Storybook story tests and return preview URLs.
- [ ] 2.3 Add a dated `CHANGELOG.md` entry. Run `pnpm --filter web lint`, `typecheck`, and `test:coverage`, plus `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record the commands in the PR body.
- [ ] 2.4 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 2.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `skills` layer.

## 3. `workspace-entry/skills`: Workspace skill sources

- [ ] 3.1 Accept ordered extra sources in the skill catalog snapshot and pass the bound Chat's `.claude/skills`, `.agents/skills`, `.llame/skills` sources to `skill://` reads, the turn skill state, and explicit activation (design D7). Verify with tests for each agent-skills scenario in this change: `.llame` overrides `.agents` and `.claude`, a Workspace skill overrides an operator skill by name, another Chat sees only operator skills, and `GET /api/v1/skills` is unchanged.
- [ ] 3.2 List Workspace skills in the `enter_workspace` result and make them loadable in the entering Run. Verify with a worker integration test that enters and reads `skill://<name>` in the same Run, and that the next accepted turn's catalog delta announces the new skills.
- [ ] 3.3 Document Workspace skill sources in `docs/skills.md`; add a dated `CHANGELOG.md` entry. Run the API checks from 1.9 for this layer and record them in the PR body.
- [ ] 3.4 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 3.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `mcp-authorization` layer.

## 4. `workspace-entry/mcp-authorization`: retire the read-only attestation

- [ ] 4.1 Add `unverified` to the safety classification set, label MCP executors with it, and admit MCP candidates by allowlisted source rather than `read_only` (design D10). Verify with tests for the tool-calling scenarios in this change: an allowlisted write-capable MCP tool with an allowing permission group executes, one without a permission group is rejected, and code-owned tools keep today's gate.
- [ ] 4.2 Drop the configured-server lookup from `tools.allowed` MCP validation while keeping the grammar and 64-character bound. Verify with config-loader tests that `mcp__unconfigured__*` boots and a malformed MCP entry still fails startup naming the path.
- [ ] 4.3 Remove the read-only attestation from `SPEC.md`, the write-capable MCP deferral in `VISION.md`, and `docs/mcp-tools.md`, adding a migration note that operators must add permission rejects for mutating MCP tools; add a dated **BREAKING** `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.4 Run the API checks from 1.9 for this layer and record them in the PR body.
- [ ] 4.5 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 4.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `workspace-mcp` layer.

## 5. `workspace-entry/workspace-mcp`: mid-Run tools and Workspace MCP

- [ ] 5.1 Pin the installed `ai` behavior with a regression test: a key added to the bound tool record during a step is declared on the next step and executable (design D9). Verify it fails when the addition is removed.
- [ ] 5.2 Admit and insert tool declarations during a Run, remove them on exit or switch, and record each addition in a new owner-scoped `runs.added_tool_declarations` column with a generated migration (design D9). Verify with tests for the tool-calling mid-Run scenarios: callable on the next step, a removed id refused as unavailable, the step cap still applying, the record written in the terminal transaction, and a non-owner unable to read it.
- [ ] 5.3 Add the per-Chat `WorkspaceMcpClients` provider: config merge, portable entry shape, interpolation with protected values, root `cwd` defaults, start on entry or attempt start, stop on exit, switch, detach, shutdown, and 30-minute idle, and shadowing only after a successful start (design D8). Verify against the stdio fixture for each mcp-tools Workspace scenario: merge precedence, `${VAR:-default}`, redaction of a resolved value, an unsupported transport reported without failing entry, a failed server not shadowing, and Chat B never receiving Chat A's tools.
- [ ] 5.4 Report each Workspace server's state in the `enter_workspace` result and include the Chat's Workspace tools in the next Run's catalog so `tool-availability` announces them. Verify with a worker integration test that enters, calls a Workspace MCP tool in the same Run, and sees it available from the start of the next Run.
- [ ] 5.5 Show tools added during a Run as a row in the owner's receipt view. Verify with a component test and a story; run the Storybook story tests and return preview URLs.
- [ ] 5.6 Document Workspace MCP config, interpolation, lifetime, shadowing, and the audited-repository assumption in `docs/mcp-tools.md`; add a dated `CHANGELOG.md` entry. Run the API checks from 1.9 and the web checks from 2.3 for this layer and record them in the PR body, which uses `Closes #974`.
- [ ] 5.7 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 5.8 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before creating `finalize`.

## 6. `workspace-entry/finalize`: spec sync and archive

- [ ] 6.1 After every implementation layer is published, verified, and checked, create only the finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; this layer contains no application fix and no shipping record.
- [ ] 6.2 Inspect `pnpm exec openspec status --change workspace-entry --json` and this task list; stop if an artifact or earlier task is incomplete. Complete this task as part of `$openspec-archive-change`, preserving checked history, and verify strict specs/all validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.
