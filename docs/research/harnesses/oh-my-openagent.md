---
type: Reference
title: "oh-my-openagent (OmO)"
description: "One agent product adapted into OpenCode, Codex and a pi fork; Git-backed memory with a gated cheap-model advisor; durable child tasks with exactly-once completion; approval bypassed by default"
resource: "https://github.com/code-yeongyu/oh-my-openagent"
tags:
  - harness
  - multi-harness
  - memory
  - subagents
  - continuation
  - permissions
status: stable
generated:
  by: "omp/claude-opus-5-5"
  at: "2026-09-30"
observed:
  date: "2026-09-30"
  revision: "42ec97ee455f08704833298f69eeeb15f38c0093"
sources:
  - id: roadmap-multi-harness
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/ROADMAP.md#L65-L91"
    title: "multi-harness stance and why OpenCode is one target"
  - id: oc-plugin-interface
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/plugin-interface.ts#L37-L108"
    title: "OpenCode hook handlers"
  - id: codex-plugin-manifest
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-codex/plugin/.codex-plugin/plugin.json#L21-L45"
    title: "Codex command-hook manifest"
  - id: senpi-compose
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/extension/compose.ts#L18-L111"
    title: "host capability check and per-component disable flags"
  - id: boulder-session-prefix
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/boulder-state/src/storage/shared.ts#L5-L15"
    title: "host-prefixed session ids"
  - id: memory-tool-commands
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/tools/memory.ts#L13-L20"
    title: "memory tool commands"
  - id: memory-str-replace
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/tools/memory.ts#L119-L129"
    title: "str_replace replaces the first match"
  - id: memory-commit-write
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/tools/commit-write.ts#L32-L51"
    title: "write lock, clean check and one commit per operation"
  - id: memory-clean-check
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/git/repo.ts#L88-L93"
    title: "repository-wide clean-tree precondition"
  - id: memory-path-confinement
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/memfs/paths.ts#L135-L168"
    title: "realpath confinement against symlink escape"
  - id: memory-precommit-schema
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/memfs/hooks-scripts.ts#L74-L95"
    title: "pre-commit frontmatter key allowlist and protected read_only"
  - id: memory-compile-head
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/compile/compile.ts#L18-L30"
    title: "memory block compiled from a committed revision"
  - id: memory-projection-pin
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/projection-pin.ts#L1-L7"
    title: "session-pinned memory projection"
  - id: memory-pressure-warning
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/prompt.ts#L118-L125"
    title: "advisory memory-pressure line"
  - id: reflection-machine
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/machine.ts#L114-L160"
    title: "reflection trigger evaluation"
  - id: reflection-park
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/park.ts#L8-L11"
    title: "failure-streak parking constants"
  - id: reflection-validate
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/completion-validation.ts#L37-L75"
    title: "post-run validation of reflection commits"
  - id: reflection-integrate
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/worktree-integration.ts#L79-L132"
    title: "merge-back under the writer lock"
  - id: memory-defaults
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-config-core/src/schema/memory.ts#L7-L53"
    title: "reflection and recall defaults"
  - id: kibitzer-wake
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/kibitzer/wake-policy.ts#L84-L98"
    title: "wake only on a new candidate"
  - id: kibitzer-nudge-admission
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/kibitzer/nudge-tool.ts#L89-L115"
    title: "nudge admission rules"
  - id: recall-render
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/recall/render.ts#L21-L33"
    title: "escaped recalled-memory block"
  - id: changelog-kibitzer-reference
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/CHANGELOG.md#L972"
    title: "5.0.0-beta.65: a nudge is reference, not an order"
  - id: task-spawn-spec
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/state/record-types.ts#L40-L47"
    title: "persisted spawn spec"
  - id: task-terminal-idempotence
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/state/transitions.ts#L123-L137"
    title: "late transitions ignored on terminal records"
  - id: task-interrupt-order
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/steering/controls.ts#L13-L33"
    title: "terminal transition before abort"
  - id: task-reconcile
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/lifecycle/reconcile.ts#L23-L40"
    title: "foreign-owner check before reconcile"
  - id: task-notify-routing
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/completion/routing.ts#L4-L30"
    title: "which terminal states notify, and how"
  - id: task-notify-rollback
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/completion/notifier.ts#L135-L146"
    title: "delivery-failure rollback"
  - id: task-child-tool-filter
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/runners/in-process/shared-tool-filter.ts#L17-L50"
    title: "delegation tools stripped from children"
  - id: task-depth-policy
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/manager/depth-policy.ts#L14-L33"
    title: "depth limit and allowed_subagents bypass"
  - id: task-child-options
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/runners/in-process/child-options.ts#L128-L137"
    title: "child allowlist applied only when present"
  - id: task-isolation-refuse
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/isolation/prepare.ts#L32-L61"
    title: "isolation refuses instead of degrading"
  - id: task-concurrency
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/manager/concurrency.ts#L52-L72"
    title: "model or provider lane with a global cap"
  - id: category-dead-chain
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/category/resolver.ts#L341-L369"
    title: "dead fallback chain refused with missing providers"
  - id: boulder-checklist
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/boulder-state/src/plan-checklist.ts#L19-L41"
    title: "plan checklist; blocked rows never continue"
  - id: ulw-continuation-limit
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/ulw-execute-continuation/index.ts#L11-L52"
    title: "continuation limit reset on user input"
  - id: todo-enforcer-limits
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/hooks/todo-continuation-enforcer/constants.ts#L22-L25"
    title: "todo enforcer stagnation and failure limits"
  - id: ultrawork-subscribe
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/skills/ultrawork/SKILL.md#L377-L402"
    title: "waiting discipline: subscribe, never sleep"
  - id: monitor-envelope
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/features/monitor/envelope.ts#L9-L14"
    title: "untrusted monitor-output envelope"
  - id: hashline-hash
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/hashline-core/src/hash-computation.ts#L5-L26"
    title: "8-bit per-line xxHash32 tag"
  - id: hashline-validate
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/hashline-core/src/validation.ts#L162-L181"
    title: "validate every reference before applying"
  - id: hashline-flag
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts#L58-L59"
    title: "hashline_edit, off by default"
  - id: agents-md-inject
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/agents-md-core/src/injector.ts#L30-L70"
    title: "walk-up AGENTS.md appended to read output"
  - id: rules-budgets
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/rules-engine/src/engine/constants.ts#L77-L84"
    title: "rule injection budgets"
  - id: license
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/LICENSE.md#L24-L27"
    title: "Sustainable Use License limitations"
  - id: codex-autonomous
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-codex/src/install/codex-config-permissions.ts#L6-L16"
    title: "autonomous Codex permissions"
  - id: codex-autonomous-default
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/cli/install-validators.ts#L250"
    title: "autonomy on unless explicitly false"
  - id: codex-hook-trust
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-codex/src/install/codex-hook-trust.ts#L85-L104"
    title: "installer-computed hook trust hashes"
  - id: claude-code-floor
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-native/bin/lib/claude-code-floor.js#L5-L27"
    title: "advertised Claude Code version raised in the installed engine"
  - id: mcp-env-blocklist
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/mcp-client-core/src/skill-mcp-manager/env-cleaner.ts#L3-L59"
    title: "stdio MCP environment blocklist"
  - id: journal-entries
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/journal/entries.ts#L1-L12"
    title: "reflection transcript entries, truncated but not redacted"
  - id: sandbox-bwrap
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/sandbox-platform.ts#L142-L148"
    title: "bubblewrap profile binds / read-only"
  - id: sandbox-seatbelt
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/sandbox-platform.ts#L214-L223"
    title: "seatbelt profile allows by default"
  - id: sandbox-auto-degrade
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/sandbox-platform.ts#L273-L281"
    title: "auto policy runs unsandboxed"
  - id: reflection-fork
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/worker/spawn-payload.ts#L151-L180"
    title: "fork-mode reflection reuses the parent prefix and cwd"
  - id: posthog-key
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/telemetry-core/src/constants.ts#L1-L2"
    title: "default PostHog host and key"
  - id: telemetry-default
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-config-core/src/schema/telemetry.ts#L11-L13"
    title: "telemetry enabled by default"
  - id: telemetry-machine-id
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/telemetry-core/src/machine-id.ts#L11-L16"
    title: "machine id from prefix and hostname"
  - id: session-read
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/tools/session-manager/tools.ts#L102-L120"
    title: "session_read takes any session id"
  - id: agent-sort-shim
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/shared/agent-sort-shim.ts#L44-L56"
    title: "process-wide sort patch predicate"
  - id: binary-download
    resource: "https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/shared/binary-downloader.ts#L24-L31"
    title: "helper binary download without digest check"
---

# oh-my-openagent (OmO)

- **Stack:** Bun/TypeScript monorepo (about 50 packages) plus Rust desktop-control crates; v5.1.6; Sustainable Use License 1.0 (source-available, non-commercial)

Formerly oh-my-opencode. One agent product ships three ways: an OpenCode plugin,
a Codex CLI plugin (`lazycodex`), and "OmO Native", an extension for senpi, the
author's fork of [pi-mono](./pi-mono.md), launched as `omo`. About twenty
harness-neutral `*-core` packages hold the logic. It is a single-user local tool
with no tenant model. Source inspected at the pinned revision; nothing was run.
Memory and the durable child-task engine exist only in the Native edition:
the OpenCode and Codex editions import neither `memory-core` nor `senpi-task`.

**Study**

1. **An adapter layer over borrowed hosts, deliberately without a unified hook
   API.** Each edition has one composition root: the OpenCode plugin returns a
   hook-handler object[^oc-plugin-interface], the Codex edition is a manifest of
   command hooks that read JSON from stdin[^codex-plugin-manifest], and the Native
   extension probes seven host capabilities, disables itself on a mismatch rather
   than throwing, and registers a disable flag per
   component[^senpi-compose]. OmO never mints a session id; it keys state on the
   host's id with a `codex:`, `opencode:` or `senpi:`
   prefix[^boulder-session-prefix]. The roadmap rejects a shared hook abstraction
   over unstable host APIs, and says OpenCode is only one target because its
   plugin prompt injection returns before the prompt is durably accepted, so hooks
   reacting to the same idle edge duplicate work or
   loop[^roadmap-multi-harness]. High confidence for #29 and peer adapters: a
   narrow per-executor port with a capability probe and a published feature
   matrix, and llame's Run mapped to `(executor, external session)`. The OpenCode
   failure is the case for llame accepting work durably instead of injecting into
   a peer's loop.
2. **Memory is a local Git repository written one commit per operation.** A
   single `memory` tool carries seven commands[^memory-tool-commands]. Each runs
   under a per-identity write lock, refuses while any path in the repository is
   uncommitted, and commits only the touched paths with writer, session and turn
   trailers[^memory-commit-write][^memory-clean-check]. Paths pass a realpath
   walk that rejects symlink escapes[^memory-path-confinement], and a pre-commit
   hook allowlists frontmatter keys and stops the agent changing
   `read_only`[^memory-precommit-schema]. There is no content precondition:
   `str_replace` replaces the first match[^memory-str-replace] and the clean
   check is repository-wide. High confidence for #212 and #513: commit per
   operation with Run trailers and a hook-enforced schema fit a Git-backed Space,
   while the edit precondition stays #706's per-file snapshot tag.
3. **The prompt sees committed HEAD, pinned per session.** The compiler reads
   only a revision's tree, so uncommitted edits never reach the
   prompt[^memory-compile-head]. A session keeps the bytes compiled at its first
   turn's HEAD, stored as a session entry so a resume reproduces them; later
   commits arrive as one line in a hidden notice, and the pin moves only on
   compaction, `/recompile` or a rewritten history, because any system-prompt
   change rewrites the conversation's prompt cache[^memory-projection-pin]. The
   only size control is an advisory pressure line near a 30,000-token
   estimate[^memory-pressure-warning]. High confidence for #513 and #972: the
   frozen baseline plus deltas from the
   [recency digest study](../long-term-memory/2026-08-12-recency-digest-prior-art.md),
   with a hard cap llame must add.
4. **Reflection is a detached child in a Git worktree, merged only after
   validation.** A pure state machine reserves a run on a successful settle after
   a compaction, a step threshold or a transcript-byte backlog, and keeps one
   active run plus one coalesced pending run[^reflection-machine]; defaults are
   25 steps on the `quick` model category with a 15-minute
   limit[^memory-defaults]. Three non-retryable or six retryable failures in a
   row park automatic reflection behind a six-hour probe[^reflection-park].
   Before merge, validation requires untouched Git administration files, a clean
   tree, descent from the recorded base, confined changed paths and valid
   frontmatter[^reflection-validate]. Integration runs under the writer lock,
   returns `parent_dirty` when the parent has any change, merges `--no-ff` with
   an `Omo-Run` trailer, and aborts to
   `merge_conflict`[^reflection-integrate]. High confidence for an agent-write
   child Run under #212 and #39: branch per Run, post-hoc path and schema
   checks, explicit terminal outcomes, trailer-based idempotence.
5. **Kibitzer: a cheap advisor that spends a model turn only when a lexical gate
   finds something new.** Hooks feed a bounded, redacted event stream to a
   resident read-only sidecar on the `quick` category. It wakes only when lexical
   selection over committed notes finds a path not yet offered or surfaced in
   the session and a cooldown allows[^kibitzer-wake]; it is on by default with
   two nudges per wake, two concurrent wakes and eight tool
   calls[^memory-defaults]. Its only output is `nudge(path, hint)`, which rejects
   unoffered, already surfaced, `system/`, secret-like, agent-addressed and
   over-200-character hints[^kibitzer-nudge-admission]; the delivered block is
   escaped and labelled reference only[^recall-render]. The upstream changelog
   measured why: of 3,143 local deliveries, 465 sent the agent to open the note
   and 75 became a different task, 72 of them in sessions with no real user
   request in view, because the block arrived on the user
   channel[^changelog-kibitzer-reference]. Moderate confidence for #194 and #39
   as a design; high for the lesson that advisor text on the user channel
   acquires user authority, so llame renders it as a typed, non-instructional
   context part with delivery provenance on the Run.
6. **Durable child tasks with one terminal writer and exactly-once
   completion.** Each Native child is a JSON record plus an event log, and the
   persisted spawn spec holds launch facts (cwd, prompt, instructions, tool
   names), never tool closures or credentials[^task-spawn-spec]. A terminal
   record ignores later status transitions and audits the
   attempt[^task-terminal-idempotence]. Interrupt and cancel write the terminal
   state before aborting the handle, so the runner's late completion is
   rejected[^task-interrupt-order]. Session start reconciles orphans only after
   checking every record for a live foreign owner[^task-reconcile]. Only
   `completed`, `error` and `lost` notify, since a parent-initiated cancel
   already returned in the tool result[^task-notify-routing], and a failed
   batched delivery rolls back the notified epoch and
   retries[^task-notify-rollback]. High confidence for #765 and #207:
   database-first cancellation, an owed-notification flag per child Run
   attempt, and a spawn record that cannot restore authority.
7. **Child authority is narrowed, with two gaps.** Children lose every task,
   team and workflow tool, so they cannot delegate[^task-child-tool-filter].
   Depth defaults to 1, but an `allowed_subagents` match admits a target at any
   depth[^task-depth-policy], and a child without an agent allowlist keeps the
   parent's whole remaining tool surface, because the allowlist is applied only
   when present[^task-child-options]. Requested isolation refuses the spawn
   rather than run on the real tree when a clone or baseline cannot be
   prepared[^task-isolation-refuse]. Concurrency is a lane per model or provider
   under a global cap[^task-concurrency]. High confidence for #765: persist the
   child's allow and deny lists on its Run and intersect them with the parent
   policy; copy neither the any-depth bypass nor the full-surface default.
8. **Model categories resolved against live credentials.** A task names a
   category; resolution walks a builtin provider-ranked chain against the models
   the configured credentials serve, and refuses before spawning, naming the
   attempted chain and missing providers, when no rung
   resolves[^category-dead-chain]. Moderate confidence for #37 and #765: resolve
   a child's model from an ordered chain at admission, record it on the Run, and
   refuse with a diagnostic instead of silently widening to a costlier model.
9. **"Done" comes from durable state, and waits are subscriptions.** Plan
   continuation counts top-level checkboxes, and a `[~]` blocked row never keeps
   a loop alive[^boulder-checklist]; it auto-continues at most eight times in a
   row, resetting on each user input[^ulw-continuation-limit]. The OpenCode todo
   enforcer stops after three stagnant or five failed
   attempts[^todo-enforcer-limits]. The Native prompt forbids sleeping and
   polling: every wait is a `tool.monitor` subscription registered in the same
   code-mode cell that starts the work[^ultrawork-subscribe], and the OpenCode
   monitor tools deliver process output in an envelope marked
   untrusted[^monitor-envelope]. Moderate confidence for #769 and #1051: capped,
   deduplicated continuation over Run-owned todos, and background jobs whose
   output wakes the Run as untrusted observation. The cap bounds unattended
   drift, not spend, so llame still needs a cost ceiling.
10. **Hashline edits and path-scoped instruction injection.** The opt-in
    `hashline_edit` tags each read line with an 8-bit xxHash32 code and rejects
    the whole edit when any referenced line's tag no longer
    matches[^hashline-hash][^hashline-validate][^hashline-flag]. Reading a file
    appends each not-yet-injected `AGENTS.md` between it and the project root to
    the tool result, tracked per session[^agents-md-inject], and matched rules
    are capped at 12,000 characters each and 40,000 per
    result[^rules-budgets]. Moderate confidence: the reject-whole-call validation
    supports #706, but an 8-bit per-line tag is too weak for concurrent writers,
    so llame's file-level tag stays; lazy per-path injection with budgets is
    prior art for #1029.

**Caution**

- The Sustainable Use License limits use to internal business, personal or
  non-commercial purposes[^license]. llame is MIT, so study mechanisms and copy
  no code.
- Approval is bypassed by default. The Codex installer writes
  `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` and hides
  both warnings[^codex-autonomous] unless the option is explicitly
  false[^codex-autonomous-default], and it stamps its own hooks with trust
  hashes so Codex never reviews them[^codex-hook-trust].
- The Native launcher edits the installed engine to advertise Claude Code
  2.1.280, because the provider rejects older clients on subscription
  OAuth[^claude-code-floor]. That is client impersonation; #754 keeps its
  provider-owned execution path.
- Skill stdio MCP children inherit `process.env` minus named variables and
  `_KEY`, `_TOKEN` and `_PASSWORD`-style suffixes, and declared env bypasses the
  filter[^mcp-env-blocklist], so `PGPASSWORD` and llame's own `POSTGRES_URL`
  would pass. llame's declared-environment rule is the right one.
- Memory is on by default and sends transcripts to background model children:
  the reflection payload carries user, assistant and plain-text reasoning,
  truncated but not redacted[^journal-entries], and secret handling is a prompt
  instruction. The reflection sandbox confines writes only, binding `/`
  read-only or allowing everything but writes on
  macOS[^sandbox-bwrap][^sandbox-seatbelt]; its default `auto` mode runs
  unsandboxed where the platform lacks
  support[^memory-defaults][^sandbox-auto-degrade], and the fork
  variant inherits the parent's prompt prefix and cwd[^reflection-fork].
- Telemetry is on by default to a PostHog key in
  source[^posthog-key][^telemetry-default], identified by SHA-256 over a fixed
  prefix and the hostname[^telemetry-machine-id], which is guessable.
- `session_read` opens any session id without an ownership
  check[^session-read]. That is harmless for one local user and a cross-tenant
  read in llame.
- The OpenCode plugin patches `Array.prototype.sort` process-wide to reorder
  agent lists[^agent-sort-shim], and the comment-checker binary is downloaded
  from GitHub with redirects followed and no digest check[^binary-download].

[^roadmap-multi-harness]: [multi-harness stance and why OpenCode is one target](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/ROADMAP.md#L65-L91)

[^oc-plugin-interface]: [OpenCode hook handlers](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/plugin-interface.ts#L37-L108)

[^codex-plugin-manifest]: [Codex command-hook manifest](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-codex/plugin/.codex-plugin/plugin.json#L21-L45)

[^senpi-compose]: [host capability check and per-component disable flags](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/extension/compose.ts#L18-L111)

[^boulder-session-prefix]: [host-prefixed session ids](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/boulder-state/src/storage/shared.ts#L5-L15)

[^memory-tool-commands]: [`memory` tool commands](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/tools/memory.ts#L13-L20)

[^memory-str-replace]: [`str_replace` replaces the first match](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/tools/memory.ts#L119-L129)

[^memory-commit-write]: [write lock, clean check and one commit per operation](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/tools/commit-write.ts#L32-L51)

[^memory-clean-check]: [repository-wide clean-tree precondition](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/git/repo.ts#L88-L93)

[^memory-path-confinement]: [realpath confinement against symlink escape](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/memfs/paths.ts#L135-L168)

[^memory-precommit-schema]: [pre-commit frontmatter key allowlist and protected `read_only`](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/memfs/hooks-scripts.ts#L74-L95)

[^memory-compile-head]: [memory block compiled from a committed revision](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/compile/compile.ts#L18-L30)

[^memory-projection-pin]: [session-pinned memory projection](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/projection-pin.ts#L1-L7)

[^memory-pressure-warning]: [advisory memory-pressure line](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/prompt.ts#L118-L125)

[^reflection-machine]: [reflection trigger evaluation](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/machine.ts#L114-L160)

[^reflection-park]: [failure-streak parking constants](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/park.ts#L8-L11)

[^reflection-validate]: [post-run validation of reflection commits](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/completion-validation.ts#L37-L75)

[^reflection-integrate]: [merge-back under the writer lock](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/reflection/worktree-integration.ts#L79-L132)

[^memory-defaults]: [reflection and recall defaults](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-config-core/src/schema/memory.ts#L7-L53)

[^kibitzer-wake]: [wake only on a new candidate](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/kibitzer/wake-policy.ts#L84-L98)

[^kibitzer-nudge-admission]: [nudge admission rules](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/kibitzer/nudge-tool.ts#L89-L115)

[^recall-render]: [escaped recalled-memory block](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/recall/render.ts#L21-L33)

[^changelog-kibitzer-reference]: [5.0.0-beta.65: a nudge is reference, not an order](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/CHANGELOG.md#L972)

[^task-spawn-spec]: [persisted spawn spec](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/state/record-types.ts#L40-L47)

[^task-terminal-idempotence]: [late transitions ignored on terminal records](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/state/transitions.ts#L123-L137)

[^task-interrupt-order]: [terminal transition before abort](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/steering/controls.ts#L13-L33)

[^task-reconcile]: [foreign-owner check before reconcile](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/lifecycle/reconcile.ts#L23-L40)

[^task-notify-routing]: [which terminal states notify, and how](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/completion/routing.ts#L4-L30)

[^task-notify-rollback]: [delivery-failure rollback](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/completion/notifier.ts#L135-L146)

[^task-child-tool-filter]: [delegation tools stripped from children](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/runners/in-process/shared-tool-filter.ts#L17-L50)

[^task-depth-policy]: [depth limit and `allowed_subagents` bypass](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/manager/depth-policy.ts#L14-L33)

[^task-child-options]: [child allowlist applied only when present](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/runners/in-process/child-options.ts#L128-L137)

[^task-isolation-refuse]: [isolation refuses instead of degrading](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/isolation/prepare.ts#L32-L61)

[^task-concurrency]: [model or provider lane with a global cap](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/manager/concurrency.ts#L52-L72)

[^category-dead-chain]: [dead fallback chain refused with missing providers](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/senpi-task/src/category/resolver.ts#L341-L369)

[^boulder-checklist]: [plan checklist; blocked rows never continue](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/boulder-state/src/plan-checklist.ts#L19-L41)

[^ulw-continuation-limit]: [continuation limit reset on user input](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/ulw-execute-continuation/index.ts#L11-L52)

[^todo-enforcer-limits]: [todo enforcer stagnation and failure limits](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/hooks/todo-continuation-enforcer/constants.ts#L22-L25)

[^ultrawork-subscribe]: [waiting discipline: subscribe, never sleep](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/skills/ultrawork/SKILL.md#L377-L402)

[^monitor-envelope]: [untrusted monitor-output envelope](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/features/monitor/envelope.ts#L9-L14)

[^hashline-hash]: [8-bit per-line xxHash32 tag](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/hashline-core/src/hash-computation.ts#L5-L26)

[^hashline-validate]: [validate every reference before applying](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/hashline-core/src/validation.ts#L162-L181)

[^hashline-flag]: [`hashline_edit`, off by default](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts#L58-L59)

[^agents-md-inject]: [walk-up `AGENTS.md` appended to read output](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/agents-md-core/src/injector.ts#L30-L70)

[^rules-budgets]: [rule injection budgets](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/rules-engine/src/engine/constants.ts#L77-L84)

[^license]: [Sustainable Use License limitations](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/LICENSE.md#L24-L27)

[^codex-autonomous]: [autonomous Codex permissions](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-codex/src/install/codex-config-permissions.ts#L6-L16)

[^codex-autonomous-default]: [autonomy on unless explicitly false](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/cli/install-validators.ts#L250)

[^codex-hook-trust]: [installer-computed hook trust hashes](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-codex/src/install/codex-hook-trust.ts#L85-L104)

[^claude-code-floor]: [advertised Claude Code version raised in the installed engine](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-native/bin/lib/claude-code-floor.js#L5-L27)

[^mcp-env-blocklist]: [stdio MCP environment blocklist](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/mcp-client-core/src/skill-mcp-manager/env-cleaner.ts#L3-L59)

[^journal-entries]: [reflection transcript entries, truncated but not redacted](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/memory-core/src/journal/entries.ts#L1-L12)

[^sandbox-bwrap]: [bubblewrap profile binds `/` read-only](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/sandbox-platform.ts#L142-L148)

[^sandbox-seatbelt]: [seatbelt profile allows by default](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/sandbox-platform.ts#L214-L223)

[^sandbox-auto-degrade]: [`auto` policy runs unsandboxed](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/sandbox-platform.ts#L273-L281)

[^reflection-fork]: [fork-mode reflection reuses the parent prefix and cwd](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-senpi/src/components/memory/worker/spawn-payload.ts#L151-L180)

[^posthog-key]: [default PostHog host and key](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/telemetry-core/src/constants.ts#L1-L2)

[^telemetry-default]: [telemetry enabled by default](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-config-core/src/schema/telemetry.ts#L11-L13)

[^telemetry-machine-id]: [machine id from prefix and hostname](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/telemetry-core/src/machine-id.ts#L11-L16)

[^session-read]: [`session_read` takes any session id](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/tools/session-manager/tools.ts#L102-L120)

[^agent-sort-shim]: [process-wide sort patch predicate](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/shared/agent-sort-shim.ts#L44-L56)

[^binary-download]: [helper binary download without digest check](https://github.com/code-yeongyu/oh-my-openagent/blob/42ec97ee455f08704833298f69eeeb15f38c0093/packages/omo-opencode/src/shared/binary-downloader.ts#L24-L31)
