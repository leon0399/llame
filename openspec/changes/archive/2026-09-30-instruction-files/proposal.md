## Why

A Chat bound to a Workspace gets that project's skills and MCP servers, but not its
instruction files: `AGENTS.md`, `CLAUDE.md`, and the per-directory files that monorepos
layer beneath them. The model works in this repository without `apps/api/AGENTS.md`'s
migration rules unless it happens to read the file itself, and nothing brings the file back
after compaction. [#974](https://github.com/leon0399/llame/issues/974) deferred this
explicitly to [#975](https://github.com/leon0399/llame/issues/975).

Two constraints already recorded on #975 shape the design. A tool result cannot carry the
text, because replay caps a tool pair at 8,000 UTF-16 units and clears payloads first; this
repository's `apps/api/AGENTS.md` alone is 17 KB. The system prompt cannot carry it either,
because a mid-chat change invalidates the cached prefix
([#972](https://github.com/leon0399/llame/issues/972)). What fits is a rail context item,
and the rail today has no way to place an item between the model steps of one Run. That
gap is the first half of this change; the instruction-file producer is the second.

## What Changes

- Add a rail mechanism for **in-Run context items**: an item authored between model steps
  of a Run is stored as a `data-context` part on that Run's assistant message immediately
  after the last tool part of the triggering step, replayed as a user-role text message after
  that tool result, re-supplied at the same position on every later step of the Run, published
  only with the winning attempt, and recorded in the Run's context-item record in step
  order. `context-injection` gains this as a second carrier beside the triggering user
  message. Verified on the Anthropic Messages, OpenAI Responses (stored and
  `store: false` with encrypted reasoning), and OpenCode Go Chat Completions wires, with
  reasoning preserved where the wire emits it; see design.md D2.
- Add the **`instructions` producer** (form `notice`). For a touched directory `D`, it walks
  from the filesystem root down to `D` and, in each directory, selects at most one base file
  by the first existing name in `LLAME.override.md`, `LLAME.md`, `AGENTS.override.md`,
  `AGENTS.md`, `CLAUDE.override.md`, `CLAUDE.md`, and independently at most one local file
  by the first existing name in `LLAME.local.md`, `AGENTS.local.md`, `CLAUDE.local.md`.
  Selection replaces: a directory that adds `LLAME.md` stops contributing its `AGENTS.md`.
  Files are loaded once per compaction epoch per canonical path; a bundle carries only the
  files not yet in effective context. One item per model step carries every newly loaded file
  in directory order, broad to specific, base before local within a directory, each in a
  `<file path="…">` block labelled with the path where it was found, plus one scope sentence (each file applies to work under its own
  directory; a deeper file takes precedence over a broader one where they conflict), the
  rail precedence statement, and a per-file truncation line when a file exceeds 32 KiB.
  Empty files contribute nothing.
- **Triggers.** `enter_workspace` loads the chain for the canonical root from the next model
  step. Native `read`, `edit`, and `write` on a local filesystem path load the chain for the
  path's directory from the next model step, whether or not the target exists; a `kb://`
  locator loads the chain from the root of its own Space down to the touched directory,
  labelled and keyed by logical `kb://` locators, so no host path ever reaches the model or
  the owner. `bash`, `knowledge_search`, `skill://`, and web locators do not trigger. Each
  accepted user turn on a bound Chat whose root chain is not in effective context stages the
  root chain before the first request, which covers compaction and bindings that predate this
  change. A model `read` of an instruction file itself neither triggers that file nor marks it
  seen.
- **Seen set.** Derived, not stored: the file identities named by `instructions` items in the
  Chat's effective history (messages after the active compaction's cutoff, plus items
  staged or emitted by the current attempt) — a canonical host path, or the logical `kb://`
  locator for a Space candidate. Compaction does not carry in-Run items into
  replacement history, so a file absorbed by a compaction reloads on the next trigger. No
  Chat column, migration, or fork remap.
- **Authorization and audit.** Candidate existence and size are probed without a permission
  decision or audit event — on the executor for a host path, through the Run owner's
  Knowledge resolver for a Space, which loads nothing for another owner's, missing, or
  unavailable Space; the probe reveals nothing to the model. Each
  existing candidate is one or more paged system-origin `read`s admitted by the `read`
  permission group and audited like a model read with origin `instructions`; a denied file is
  omitted from the bundle and never named to the model. The model therefore receives nothing
  it could not read itself; the owner additionally learns, through the chip and audit, that a
  denied candidate exists — except in a step where every candidate is denied, which produces
  no item and therefore no chip, leaving the denied `read` audit event as the only record.
  Disclosure of that case is tracked in
  [#1039](https://github.com/leon0399/llame/issues/1039).
- **Owner disclosure.** The item's private metadata records loaded, truncated, and denied
  paths; the transcript shows a chip listing them; the Run context-item record copies the
  model-visible text only. Non-owners, shares, exports, and search projections see none of it.

Non-goals: `@`-style imports and link-form imports, tracked as
[#1029](https://github.com/leon0399/llame/issues/1029); a stored once-per-chat seen set;
removal or supersession notices on Workspace exit or switch; `bash` `cwd` as a trigger; a
per-trigger aggregate byte cap; path pointers to deeper instruction files at entry; content
digests for re-announcing an edited file; a `.local.override` chain.

## Assumptions, confirmed with Leo

The walk stops at the filesystem root, so an instruction file in any ancestor of a touched
path, including the executor host's home directory, enters every Chat that touches a
descendant path on that executor. This is accepted for the personal-first deployment and
recorded as a tradeoff in design.md. `LLAME.md` replacing `AGENTS.md` in the same directory
is accepted; a repository that wants both writes the shared text in `LLAME.md` or waits
for #1029. "Seen" means once per compaction epoch, matching Claude Code and OpenCode, not
once per Chat. The walk inside a Knowledge Space stops at that Space's own root: the operator
Knowledge root above it spans every owner's Spaces and is a private host path, so nothing above
a Space is loaded and no Space loads for an owner who cannot reach it.

## Capabilities

### New Capabilities

- `instruction-files`: candidate chains and per-directory selection, the directory walk and
  its ceiling for host paths and for `kb://` locators within their Space, triggers, the
  derived seen set, system-origin admission and audit, bundle content and bounds, owner
  disclosure, and compaction behavior.

### Modified Capabilities

- `context-injection`: items may be carried by a Run's assistant message between model
  steps, replayed as a user-role message after the triggering tool result and re-supplied on
  later steps; `instructions` joins the producer precedence list after `workspace`; the Run
  context-item record includes in-Run items in step order; the SDK conversion boundary maps
  assistant-message `data-context` parts to user-role text messages; and the Workspace
  binding-change requirement finishes the re-check before the accepted-turn `instructions`
  load, so a detaching attempt stages no `instructions` item.
- `workspace-entry`: entry also triggers the `instruction-files` load for the canonical root
  from the next model step (In-Run Workspace transitions), and the binding re-check (Each Run
  attempt re-checks the binding) runs before the accepted-turn `instructions` load, which a
  detaching attempt skips.

## Impact

- `apps/api/src/chats`: the `instructions` producer, its packaged template, and the
  effective-history seen-set derivation; `context-builder` replay of assistant-message
  `data-context` parts.
- `apps/api/src/runs`: in-Run item staging, per-step message re-splicing through the
  existing `prepareStep`/`onStepStart` seam, publication with the winning attempt, the Run
  context-item record, and system-origin reads with `instructions` audit origin.
- `apps/api/src/tools`: the trigger hook on native `read`/`edit`/`write` and Workspace entry.
- `apps/api/src/knowledge`: owner-scoped Space resolution and candidate probing for the
  Space-scoped walk, reusing the existing locator resolution and its host-path containment
  check.
- `apps/web`: the instructions chip on assistant and user messages.
- Docs: `docs/product/operator/native-files.md`, `docs/product/operator/knowledge.md`, `SPEC.md`'s context-rail and Workspace
  lines, `CHANGELOG.md`.
- No schema change and no migration.
