Track [#974](https://github.com/leon0399/llame/issues/974) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#975](https://github.com/leon0399/llame/issues/975), [#976](https://github.com/leon0399/llame/issues/976), [#977](https://github.com/leon0399/llame/issues/977), and [#758](https://github.com/leon0399/llame/issues/758) are separate work, not native blockers. [#978](https://github.com/leon0399/llame/pull/978) (tool-search redesign) is separate work; this change owns only the in-Run tool additions made by Workspace entry.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- workspace-entry/proposal
         <- workspace-entry/core
         <- workspace-entry/web
         <- workspace-entry/skills
         <- workspace-entry/mcp-authorization
         <- workspace-entry/mid-run-tools
         <- workspace-entry/workspace-mcp
         <- workspace-entry/finalize
```

- `proposal` owns only proposal, design, the delta specs, and this task list.
- `core` (parent `proposal`, estimated 1,850 authored lines): the binding columns and generation,
  both tools, relative-path projection for execution and permissions, re-check and immediate
  detach, narration, and fork isolation. Its PR references #974.
- `web` (parent `core`, estimated 350 authored lines): the owner chat API binding field and the
  chat-header indicator. References #974.
- `skills` (parent `web`, estimated 650 authored lines): Workspace skill sources and failure
  isolation. References #974.
- `mcp-authorization` (parent `skills`, estimated 750 authored lines): retire the MCP read-only
  attestation for all servers and update every eligibility gate. References #974.
- `mid-run-tools` (parent `mcp-authorization`, estimated 1,200 authored lines): SDK pin,
  mid-Run declaration additions in active-attempt memory, the model-system-prompts exception,
  and runtime next-Run resolution. References #974.
- `workspace-mcp` (parent `mid-run-tools`, estimated 1,500 authored lines): per-Chat clients,
  config, interpolation, lifecycle, generation keying, and shadowing. Its merge completes
  #974's acceptance, so its PR uses `Closes #974`.
- `finalize` owns only spec sync, checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file. UI presentation details live here and in design.md, not in the specs.
The proposal layer is a named review-budget exception at approximately 3,100 authored lines:
MODIFIED blocks must copy whole canonical requirements across 12 capabilities, and the
**BREAKING** MCP contract is atomic with the feature. Evidence is
`git diff --shortstat master...workspace-entry/proposal`. Re-estimate all later layers against
their immediate parent; this exception does not relax the approximately 2,000-line budget for
implementation layers.

## 1. `workspace-entry/core`: binding, tools, projection, and narration

- [x] 1.1 Add nullable `workspace_root`, `workspace_executor_id`, `workspace_told`,
      `workspace_told_from`, and `workspace_detach_reason`, plus integer
      `workspace_generation`, to `chats` with a generated Drizzle migration (design D1). Use the
      closed detach-reason codes and increment generation only when an enter establishes or
      switches a binding, an exit clears a bound Chat, or a detach clears one; same-root re-entry
      and exit on an unbound Chat leave it unchanged. Stage `workspace_told` and
      `workspace_told_from` together during accepted-turn preparation and write both in the same
      successful accepted-turn transaction; the compaction path never writes Chat state. Verify
      `pnpm db:generate` reproduces it, the migration applies to a populated database, and an
      integration test shows user A cannot read or write user B's binding columns under RLS.
- [x] 1.2 Add the pure lexical `resolveWorkspacePath` projection and feed it to `read`, `edit`,
      `write` path handling and bash `cwd` through the attempt-scoped root cell (design D3, D5).
      Preserve a trailing separator, do not call `realpath`, follow symlinks only through the OS, and
      define relative as no leading `/` and no recognized case-insensitive `scheme://` prefix.
      Verify entered relative read, `..` leaving the root, unentered relative refusal, omitted bash
      `cwd` defaulting to the root, relative bash `cwd`, locator schemes unaffected, a trailing
      separator staying in the projected string and producing the same `not_found`/invalid behavior
      as its absolute form, and a same-step `read("f")` using the root committed before entry.
- [x] 1.3 Evaluate projected values in `evaluateToolPermission`, including the implied bash
      `cwd`, without matching submitted relative text (design D3). Verify every projection permission
      scenario, including `read("../../.ssh/id_ed25519")` rejected by an absolute `.ssh` reject and
      omitted bash `cwd` rejected by a `cwd` reject on the root; keep command-text matching unchanged.
- [x] 1.4 Register `enter_workspace` and `exit_workspace` as host-capability tools with packaged
      descriptions and schemas. Implement submitted-path permission evaluation in the runner,
      then a read-only delivery-fence check before any filesystem probe, followed by the
      realpath/directory probe, independent canonical-path allow/reject evaluation with
      provenance, the fenced compare-and-set write, and post-commit client stop and other effects
      (design D2). At most one `enter_workspace` or `exit_workspace` call may take effect per
      model step: the first claims the transition slot and later calls return non-fatal
      `workspace_transition_conflict` without effect. Classify entry as `execute_code` and exit
      as `write_low_risk`, bind `runs.worker_id` through native execution, record neither as
      `native.attempt`, make queue retries idempotent, and make authorized exit on an unbound Chat
      harmless. Verify non-absolute and non-directory paths, symlink rejection, submitted-path
      rejection, canonical-path `no_allow` with no binding or MCP start, same-root no-op without
      restart or generation change, switch, missing `nativeExecutorId`, both same-step transition
      conflicts (`enter_workspace(A)` then `exit_workspace()` and `enter_workspace(A)` then
      `enter_workspace(B)`), and a superseded attempt with no side effect.
- [x] 1.5 Re-check the binding during attempt preparation on the worker before Workspace skills,
      `$skill`, MCP clients/catalog, or the Workspace producer. Detach immediately in its own
      owner-scoped transaction fenced by the Run's current delivery; clear the binding, increment
      generation, store the closed reason, and expose no Workspace skill activation,
      `skill://` resolution, or tools to the detaching attempt (design D4). An already-frozen
      skill-catalog baseline may still list Workspace skills, and the next accepted turn's catalog
      notice removes them. Verify executor mismatch and absence, root missing/non-directory, root
      moved, permission rejection requiring an allow and no reject, and `tool_not_allowed`. Include
      the detach-then-fail retry scenario: a retry whose checks would pass still finds the Chat
      unbound, and an executor returning later does not restore it.
- [x] 1.6 Add the `workspace` context-item producer with its packaged template and comparison
      rule: treat the told state as null whenever `workspace_told_from` differs from the Chat's
      latest compaction identity. Emit a rail-only `snapshot` current-state item, a separate
      detach `notice`, and stage `workspace_told` with `workspace_told_from` for the same
      accepted-turn transaction; the compaction path does not write Chat state (design D6).
      Verify entry and exit narration, detach reason in a separate notice, unchanged binding
      silence, compaction re-establishment, no notice for a never-bound Chat, and the rendered
      system prompt remaining byte-identical before and after entry.
- [x] 1.7 Copy the binding root, executor id, and generation in owner forks but not
      `workspace_told`, `workspace_told_from`, or detach reason. Verify an owner fork keeps the
      binding, its first accepted turn narrates it, its first Run re-checks it, and a visitor fork
      of a public bound Chat is unbound and discloses no root; a fork of a detached Chat stays
      unbound.
- [x] 1.8 Document the nine-group recommended policy in `llame.config.json.example`: add
      `enter_workspace` and `exit_workspace`; the `enter_workspace` group uses an operator-edited
      field allow such as
      `{ "field": "path", "regex": "^/home/operator/projects/[^/]+/?$" }`, plus F1-F3 and
      E1 `(^|[/\\])node_modules([/\\]|$)`, E2 `^/(tmp|var/tmp)(/|$)`, and E3
      `(^|[/\\])Downloads([/\\]|$)` rejects on `enter_workspace.path`. Every directory this group
      allows is trusted to run code and read host secrets through its Workspace MCP configuration;
      the other eight groups keep whole-tool allows. Add W1 on `edit.path` and `write.path` with
      case-insensitive text-reject regex `(?i)(^|[/\\])\.mcp\.json$` and W2 with
      `(?i)(^|[/\\])\.(llame|agents|claude)[/\\]`; document that in-repo aliases such as symlinks
      can bypass these rejects and there is no executor-level guard. Add Workspace entry and its
      host-authority boundary in `docs/native-files.md`. Update `SPEC.md:35` so Workspace is a
      current runtime object on the native executor, add the local-node research paragraph
      recording the absolute-path exception to §5.4, and add a dated `CHANGELOG.md` entry. Verify
      the example-policy scenarios, including the canonical `no_allow` case and preservation of
      F1-F3.
- [x] 1.9 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused API
      integration files touched above, `pnpm format:check`, `git diff --check`, and
      `pnpm exec openspec validate workspace-entry --strict`; record the commands in the PR body.
- [x] 1.10 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted
      findings, and rerun affected checks before marking ready.
- [x] 1.11 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `web` layer.

## 2. `workspace-entry/web`: owner binding API and indicator

- [x] 2.1 Expose the current canonical binding root or null on the owner's Chat API response and
      regenerate the OpenAPI client. Verify the owner sees the root, another owner receives 404 for
      the Chat, the RLS path cannot read or write another owner's columns, and public share
      projections and shared/visitor forks never expose the root; a second generation produces no
      diff.
- [x] 2.2 Show the bound root in the chat header, updating after entry, exit, and detach, using
      existing design-system components and tokens per DESIGN.md. Verify with component tests and a
      story; run the Storybook story tests and return preview URLs.
- [x] 2.3 Add a dated `CHANGELOG.md` entry. Run `pnpm --filter web lint`, `typecheck`, and
      `test:coverage`, plus `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record
      the commands in the PR body.
- [x] 2.4 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun
      affected checks before marking ready.
- [x] 2.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `skills` layer.

## 3. `workspace-entry/skills`: Workspace skill sources

- [x] 3.1 Accept ordered extra sources in the skill catalog snapshot and pass the bound Chat's
      `.claude/skills`, `.agents/skills`, and `.llame/skills` sources to `skill://` reads, the turn
      skill state, and explicit activation (design D7). Missing, unreadable, non-directory, and
      over-limit Workspace sources contribute nothing, never make operator discovery unavailable,
      and do not count toward the operator 32-source bound. Verify `.llame` overrides `.agents` and
      `.claude`, a Workspace skill overrides an operator skill by name, another Chat sees only
      operator skills, `GET /api/v1/skills` is unchanged, and the case-folded/precedence catalog is
      isolated per Chat.
- [x] 3.2 List Workspace skills in the `enter_workspace` result and make them loadable in the
      entering Run. Verify with a worker integration test that entry and `skill://<name>` read work
      in the same Run, and that the next accepted turn's catalog delta announces the new skills.
- [x] 3.3 Document Workspace skill sources in `docs/skills.md`; update `SPEC.md:196` so skill
      sources include Workspace sources while entered; add a dated `CHANGELOG.md` entry. Run the API
      checks from 1.9 for this layer and record them in the PR body.
- [x] 3.4 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun
      affected checks before marking ready.
- [x] 3.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `mcp-authorization` layer.

## 4. `workspace-entry/mcp-authorization`: retire the read-only attestation

- [x] 4.1 Add `unverified` to the safety classification set, label MCP executors with it, and
      admit MCP candidates by allowlisted source rather than `read_only` (design D10). Update every
      read-only gate: `groupEligibleTurnToolCandidates` in `tools/turn-tool-catalog.ts`,
      `resolveDynamicToolBinding` in `runs/snapshot-tool-execution.ts:164`, the
      `isClassifiedTool`/`resolveAdvertisedTools` closed list in `tools/registry.ts:36-44,125`,
      and unavailable MCP entries in `mcp-runtime.service.ts:199`. Verify an allowlisted
      write-capable MCP tool with an allowing permission group executes, one without a permission
      group is rejected, unavailable entries retain no stale executor, and code-owned tools keep
      today's host-capability gate. Durably record each MCP dispatch attempt before invoking it by
      reusing the native-attempt recovery path. Verify that redelivery of any Run carrying a
      recorded `native.attempt` fails as `outcome_unknown` without a native-executor or `workerId`
      precondition, and that every open call with a matching durable `native.result` is settled
      from that result regardless of tool source; a queue retry after a dispatched MCP call makes
      no second call.
- [x] 4.2 Drop the configured-server lookup from `tools.allowed` MCP validation while keeping
      the grammar and 64-character bound. Verify with config-loader tests that
      `mcp__unconfigured__*` boots, a malformed MCP entry still fails startup naming the path, and
      the canonical `no_allow` path remains a permission decision rather than a fabricated tool.
- [x] 4.3 Update `SPEC.md:130` (the MCP attestation/prohibition sentence), `SPEC.md:134` (queue
      retries of read-only Runs), and `SPEC.md:138` (§13.5 runtime execution of `read_only` tools)
      to reflect `unverified`; update the canonical `mcp-tools` Purpose from explicitly enabled
      read-only tools to allowlisted tools authorized by permissions, and update the canonical
      `tool-calling` Purpose directly in `openspec/specs/tool-calling/spec.md` during this layer.
      Update `README.md` (~260-261) to remove the instruction to allowlist each namespaced tool as
      read-only, and update `apps/api/AGENTS.md` (~248-249) to remove the wildcard read-only
      attestation. Remove the read-only attestation and write-capable MCP deferral from `VISION.md`
      and `docs/mcp-tools.md`, adding an operator migration note that permitting
      `enter_workspace` on a directory that any allowlisted tool can write — `bash`, native
      `write`/`edit` without W1/W2, or write-capable operator or Workspace MCP tools — is
      equivalent to `execute_code` and host-secret exfiltration. Add a dated **BREAKING**
      `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [x] 4.4 Run the API checks from 1.9 for this layer and record them in the PR body.
- [x] 4.5 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun
      affected checks before marking ready.
- [x] 4.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `mid-run-tools` layer.

## 5. `workspace-entry/mid-run-tools`: SDK handle and in-memory additions

- [x] 5.1 Pin the installed `ai` behavior with a regression test: the exact key added to the
      mutable object assigned to `streamOptions.tools` during a step is declared on the next step
      and executable there, together with the bound-executable map used at execution (design D9).
      Verify the test fails when the addition is removed or when the SDK stops re-reading the record.
- [x] 5.2 Admit and insert Workspace declarations during a Run through the same source,
      allowlist, classification, and schema gates. Retain declaration keys on exit, switch, and
      detach while marking their executors unavailable; later calls receive a non-fatal unavailable
      refusal. Keep declarations and bound executors in active-attempt memory only; do not add a
      Run-level column or persist a Run tool set. Admit only ids in the adding server's
      `mcp__<server>__` namespace. Verify next-step callability, re-entry or root-switch re-adding
      an id with an identical in-memory declaration rebinds its executor, a changed declaration
      contributes no executor in this attempt and is reported as available from the next Run, a
      foreign-namespace id is refused, a removed id is refused as unavailable, and the step cap
      still applies.
- [x] 5.3 Modify the `model-system-prompts` contract and carry its MODIFIED delta for trusted
      Workspace additions: carve them out of the fixed admitted-declaration rule for in-memory
      trusted additions only. Persist no addition record, schemas, descriptions, or hashes, and
      provide no receipt view for them. Verify the receipt remains prompt-only and exposes no
      model-facing tool definition for the additions.
- [x] 5.4 Add a dated `CHANGELOG.md` entry. Run the API checks from 1.9 and the web checks from
      2.3 for this layer, plus the focused SDK and owner-isolation tests, and record the commands in
      the PR body.
- [x] 5.5 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun
      affected checks before marking ready.
- [x] 5.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `workspace-mcp` layer.

## 6. `workspace-entry/workspace-mcp`: clients, config, and lifecycle

- [ ] 6.1 Add the per-Chat Workspace MCP client provider keyed by `(chatId, canonical root,
workspace_generation)`. Keep Workspace candidates and executors out of the process-wide
      operator MCP runtime; compose each attempt from the current Chat key with its resolver
      layered over the operator resolver. Implement `.llame/mcp.json` over `.mcp.json` merge,
      portable entry shapes, start on entry or attempt start, stop on exit/switch/detach/shutdown,
      stale-key cleanup at attempt start, and 30-minute idle cleanup. Verify Chat A's clients and
      tools never reach Chat B or another owner; in one process, bind two Chats to Workspaces that
      define the same server id and verify each Chat calls only its own server; and verify another
      process discards stale clients before using a current binding.
- [ ] 6.2 Implement `${VAR}`, `${VAR:-default}`, `{env:…}`, and `{path:…}` interpolation from
      the executing process's environment and filesystem, including llame's own environment;
      resolve relative `{path:…}` from the Workspace root; make unresolved values unavailable
      with a safe diagnostic; never re-scan resolved values or shell-interpret commands/args.
      Protect every non-empty Workspace remote `headers` value, literal or interpolated; protect
      resolved interpolation values in stdio `command`, `args`, and `env` except `:-default`
      fallback literals, while leaving literal stdio `command`, `args`, and `env` text unprotected
      solely because it is literal. Verify merge precedence, defaults, redaction, relative paths,
      unreadable files, the accepted audited-repository boundary, a literal `Authorization` header
      echoed by a Workspace server being redacted, and that an ambient llame process variable not
      referenced by Workspace config is absent from its stdio child's environment.
- [ ] 6.3 Implement deferred shadowing: a byte-equal Workspace/operator server id defers when
      operator tools are already declared in the running attempt, reports
      `shadows from the next Run`, retains operator executors for that attempt, and attempt-start
      composition shadows from the next attempt that composes the live binding, including a retry
      attempt of the same Run, after a successful Workspace start under the same tool ids and
      exact-id permission groups. A
      Workspace id differing from an operator id only by ASCII case is unavailable with reason
      `case-only collision with an operator server` and contributes no tools; operator tools are
      unaffected. A failed Workspace server does not shadow. Verify deferred shadowing, the
      case-only collision scenario, and the next-attempt transition.
- [ ] 6.4 Report every Workspace server's state in the `enter_workspace` result and compose the
      Chat's currently admitted Workspace tools from the start of the next attempt so
      `tool-availability` announces them. Verify malformed files and unsupported transports leave
      entry successful, failed servers are unavailable, a Workspace tool is callable in the
      entering attempt when it does not defer to an existing operator declaration, a changed
      re-added declaration surfaces `available from the next Run` in the entry result, and the
      next attempt starts the generation-matching client set and resolves Workspace tools from the
      live binding at its start rather than from prior attempt state.
- [ ] 6.5 Update `SPEC.md:132` to document per-process operator MCP clients plus per-Chat
      Workspace MCP clients. Document Workspace MCP config, interpolation, lifetime, generation
      keying, per-Chat resolver isolation, byte-equal deferred shadowing, case-only collision
      unavailability, and the audited-repository assumption in `docs/mcp-tools.md`; add a dated
      `CHANGELOG.md` entry. Run the API checks from 1.9 and web checks from 2.3 for this layer and
      record them in the PR body, which uses `Closes #974`.
- [ ] 6.6 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun
      affected checks before marking ready.
- [ ] 6.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before creating `finalize`.

## 7. `workspace-entry/finalize`: spec sync and archive

- [ ] 7.1 After every implementation layer is published, verified, and checked, create only the
      finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify
      `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`; this layer contains no application fix and no
      shipping record.
- [ ] 7.2 Inspect `pnpm exec openspec status --change workspace-entry --json` and this task list;
      stop if an artifact or earlier task is incomplete. Complete this task as part of
      `$openspec-archive-change`, preserving checked history, and verify strict specs/all validation,
      Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.
