# Design

## Context

See [proposal.md](proposal.md) for motivation and the observable contract; the
[delta specs](specs) own the requirements. This document records how the rail is extended,
how the producer derives its state, the prior art consulted, and the spike that fixed the
transport. Code references are at commit `ed959f31`.

The context rail is authored once per accepted turn. `deriveAttemptStagedContext` stages
every producer in one pre-request pass
(`apps/api/src/runs/run-execution.service.ts:3330-3415`), staged items are prepended to
the triggering user message as separate text blocks (`:3477-3508`), and they are published
only when the attempt wins (`:771-812`, `:2584-2599`). Nothing appends a `data-context` part
after a tool result; the only in-Run mutation path is the trusted Workspace tool addition
through the mutable tool record (`apps/api/src/tools/attempt-tool-additions.ts:166-204`).
The seam for per-step work exists: every provider client single-sources
`prepareStep` as `onStepStart` (`apps/api/src/models/openai-model-client.ts:114`,
`apps/api/src/models/model-client.ts:90-93`), which Workspace entry already uses to commit
the pending root at the next step (`run-execution.service.ts:1431-1433`).

Tool results are `tool-${name}` parts on the assistant message
(`apps/api/src/runs/assistant-transcript.ts:39-87`), replayed as assistant tool-call and
tool tool-result pairs under `TOOL_REPLAY_CALL_LIMIT = 8000` and
`TOOL_REPLAY_TURN_LIMIT = 32000` UTF-16 units, payloads cleared first
(`apps/api/src/chats/tool-observation-part.ts:25-28,284-369`). Effective history is the
active compaction's replacement history plus messages after `uptoSeq`
(`apps/api/src/chats/context-builder.ts:533-565`); replacement records are text or
payload-cleared tool records only (`:296-307`). Told state for the digest, the skill
catalog, and the Workspace is stored in `chats` columns
(`apps/api/src/db/schema/chats.ts:97-153`), while activation retry dedup already scans the
triggering message's parts (`apps/api/src/chats/activation-parts.repository.ts:38-75`).

Skill activation is the template for a system-origin read: it runs `nativeReadTool`
through `runTool`, so the `read` permission group, timeout, and identity checks apply, and
it records `tool.requested`/`started`/`completed` with `origin: "skill-activation"`, which
the transcript projection omits (`run-execution.service.ts:1959-2027,2076-2142`,
`apps/api/src/runs/tool-activity-origin.ts:1-45`). Native `read`, `edit`, and `write`
project relative paths from the Workspace root and keep host authority for absolute ones
(`apps/api/src/tools/native-files.ts:52-111`).

## Goals / Non-Goals

**Goals:**

- One additive rail extension, in-Run items, that any later producer can reuse.
- A producer whose whole state is derivable from effective history, with no schema change.
- Loading bounded by the same permission decision a model read would get, with the same
  audit trail, and never more than the model could read itself.
- A model-visible bundle a reviewer can compare against the loaded files byte for byte.

**Non-Goals:**

- Imports of any syntax ([#1029](https://github.com/leon0399/llame/issues/1029)).
- Reworking the tool-pair replay budget, compaction replacement records, or the told-state
  columns of other producers.
- A generic "seen files" service. One consumer exists; the derivation is one function.
- Provider-wire byte identity of where the injected message lands; the spike shows the SDK
  merges or separates it per wire.

## Prior art

Inspected at the pinned revisions; details in the change's exploration record.

| Harness                    | Names per directory                                               | Eager                                 | On touch                                                 | Text placement                                 | Seen set                                                                | After compaction                                       |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| Claude Code (docs, issues) | `CLAUDE.md` + `CLAUDE.local.md`; `AGENTS.md` as an either/or mode | cwd and every parent to `/`           | Read below cwd; each directory from cwd down to the file | User-message attachment beside the tool result | In-memory path sets                                                     | Cleared; root re-injected; nested reloads on next read |
| Codex `a6e9eaa`            | `AGENTS.override.md` → `AGENTS.md` → fallbacks, first wins        | git root to cwd; 32 KiB total         | none                                                     | Contextual user message                        | Cache keyed by cwd                                                      | Re-injected                                            |
| Gemini CLI `d75234c`       | all configured names                                              | git root                              | read, ls, write, edit; file dir up to git root           | Appended to the tool result                    | In-memory path + inode sets                                             | Kept                                                   |
| OpenCode `70a2469`         | `AGENTS` → `CLAUDE` → `CONTEXT`, first wins                       | root, in system prompt                | `read`; file dir up to root, root excluded               | Appended to read output in `<system-reminder>` | Derived from effective history (`metadata.loaded`) + per-message claims | Pruned parts drop out; files reload                    |
| oh-my-pi `09e7bf6`         | AGENTS/CLAUDE per ancestor                                        | ancestors to repo root, system prompt | none; deeper files as path pointers                      | `<repo-rules>`                                 | scope and content dedup                                                 | n/a                                                    |

The chain with `.override` names is Codex's; the independent `.local` chain is Claude
Code's single local name generalized; the derived seen set is OpenCode's `extract()` plus
its claims map; the walk to `/` is Claude Code's; the per-directory trigger on write and edit
is Gemini's; the scope sentence is DeepSeek Harness's "more specific instructions take
precedence over broader ones", which no shipped harness states for path applicability.

## Decisions

### D1: In-Run items are stored on the assistant message and re-spliced on every step

**Decision:** An in-Run item is a `data-context` part appended to the attempt's assistant
message immediately after the tool part whose result triggered it. `prepareStep` rebuilds
that step's message list from one source, the attempt's stored parts plus staged in-Run
items, emitting each item as a user-role text message directly after its tool-result
message. The same rebuild runs on every step. Publication stores the parts with the
assistant message when the attempt wins; the Run context-item record appends in-Run items
after the final request's items in step order.

**Why re-splice:** `ai@6.0.256` computes `stepInputMessages = [...initialMessages,
...responseMessages]` on every step (`ai/dist/index.mjs:7723`); a `prepareStep` messages
override is used for that step only. The current AI SDK documentation describes a newer
behavior where the override persists as the base of later steps. The rebuild must therefore
derive the step's messages idempotently from the attempt's own state, never by appending to
the `messages` argument, so an upgrade cannot double-insert.

**Alternatives rejected:**

- Text inside the tool-result content, outside the pair budget. Same stored shape, but the
  tool-result message then carries two kinds of content and the pair budget would need an
  exemption rule. Kept as the fallback if a wire ever rejects the user-role shape.
- A synthetic user message row in `messages`. Breaks the one-user-message-per-turn model the
  UI, forks, search projection, and compaction all assume.
- Deferring nested loads to the next accepted turn. The model edits the file in this Run.

**Consequence:** `context-builder` gains one mapping for assistant-message `data-context`
parts; `tool-observation-part` is untouched, because the item is not a tool pair.
Compaction's replacement builder ignores the part.

### D2: Transport verified by a live spike on every reachable wire

A throwaway script (`/tmp/spike-975/spike.mjs`, deleted after this record) ran
`streamText` with two tools and `prepareStep` injecting one `<system-reminder>` user message
after the `read` result, then re-splicing it on every later step, against:

| Wire / model                                                          | Request shape observed                                                   | Accepted | Reasoning before the tool call | Followed the file's rule |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- | ------------------------------ | ------------------------ |
| `anthropic-messages` claude-sonnet-4-5, enabled thinking              | `[user, assistant, user(tool_result + reminder), assistant, user]`       | yes      | yes, and thinks again after    | yes                      |
| `anthropic-messages` claude-sonnet-5, adaptive                        | same                                                                     | yes      | no thinking emitted            | yes                      |
| `openai-responses` gpt-5.4-mini, `store: true`                        | `[…, function_call_output, user(reminder), item_reference, …]`           | yes      | yes                            | yes                      |
| `openai-responses` gpt-5.4-mini, `store: false` + encrypted reasoning | `[…, reasoning, function_call, function_call_output, user(reminder), …]` | yes      | yes                            | yes                      |
| `opencode-go` deepseek-v4.1-flash (Chat Completions adapter)          | `[system, user, assistant, tool, user(reminder), assistant, tool]`       | yes      | n/a                            | yes                      |

`openai-completions` through OpenRouter was not run (account spend limit); it uses the same
`@ai-sdk/openai-compatible` adapter as `opencode-go`. The first run, without re-splicing,
showed the reminder present on the step after injection and absent on the next, and no
model followed it; that observation is the basis of D1's re-splice rule. The Anthropic
adapter merges the reminder into the user turn that carries `tool_result`, which is the
shape Claude Code uses; the Responses adapter emits a separate `user` item.

### D3: Candidate chains and per-directory selection

Base chain `LLAME.override.md`, `LLAME.md`, `AGENTS.override.md`, `AGENTS.md`,
`CLAUDE.override.md`, `CLAUDE.md`; local chain `LLAME.local.md`, `AGENTS.local.md`,
`CLAUDE.local.md`; first existing regular file wins in each; selection replaces. A
repository that wants llame-specific text and its `AGENTS.md` writes both into `LLAME.md`
until #1029. No `.local.override` names: `.local` is already the machine override, and
twelve candidate names per directory buys nothing.

**Alternatives rejected:** merging all present names (Gemini) — unbounded and contrary to
Codex/OpenCode semantics the files were written for; an either/or mode (Claude Code) — a
configuration knob for a choice the filename already encodes.

### D4: Walk from the filesystem root to the touched directory

Every ancestor of the touched directory is a candidate directory, including ancestors of
the Workspace root and directories above any `.git`. Entering `repo/apps/api` loads
`repo/AGENTS.md`; reading a file outside the Workspace loads that tree's chain; a file read
before any Workspace exists still gets its chain.

**Tradeoff, accepted:** an instruction file in the executor host's home directory enters
every Chat that touches a descendant path on that executor, for every owner sharing it.
Permission rejects on the `read` group are the operator's tool to exclude such paths, and
D6 makes every candidate subject to them. Codex and Gemini stop at the git root; that was
rejected because it discards exactly the monorepo-root and dotfiles-root context the
exploration case needs.

### D5: Triggers are entry, native read/edit/write, and the accepted turn

Entry and file tools mark the touched directory in an attempt-local pending set during the
tool call; `prepareStep` on the next step drains the set, resolves candidates, reads them,
and emits at most one bundle per step. `bash` is excluded: a `cwd` trigger that ignores `cd`
inside the command is a rule the model would have to learn. The accepted-turn trigger stages
the bound root's chain only when some file of it is missing from effective context, so a
post-compaction turn and a Chat bound before this change both recover the root without a
new column.

The Workspace root cell already defers a binding change to the next step
(`apps/api/src/tools/workspace-path.ts:10-33`); the pending set follows the same step
boundary, so entry's own step never loads.

### D6: Existence probe without a decision, then one audited system-origin read per file

Probing nine names per directory through the permission evaluator would write dozens of
`not_found` audit rows per trigger. Existence is checked on the executor without a decision
and reveals nothing. Each existing candidate is then read through `runTool(nativeReadTool)`
with origin `instructions`, so the `read` group, bypass mode, timeout, and identity checks
apply and `tool.requested`/`started`/`completed` are recorded like skill activation. A
denied or failed read is dropped and not marked seen. The raw read (`:raw`) is used so no
line-number prefixes enter the bundle, as skill activation does.

### D7: The seen set is a derivation over effective history

`seen(attempt) = paths(instructions items in replacement-history-tail and messages after
uptoSeq) ∪ paths(items staged for this attempt) ∪ paths(in-Run items emitted this
attempt)`. Keys are canonical `realpath` values recorded in the item's private metadata.

**Why not a column:** every disclosure this producer makes is in `messages.parts`, so the
history is a complete record; a column would duplicate it and need fork remapping
(`owner-chat-forks`), a finalize-transaction write, and reset rules. The digest's "do not
re-read parts" rule exists because its baseline is disclosed in the system prompt, which is
not in `parts`; that reason does not apply here. `activation-parts.repository.ts:38-75` is
the in-repo precedent for scanning parts.

**Consequence:** once per compaction epoch. Compaction's replacement builder does not carry
in-Run items, so an absorbed file reloads on the next trigger; the root chain returns on the
next accepted turn through D5. An edit to a loaded file is not re-announced within the
epoch; a content digest is the upgrade path if that matters.

### D8: One item per trigger, path-labelled file blocks, scope sentence

Payload: `{ files: [{ path, truncated }] }`; private metadata adds `denied: [path]`. The
template renders one `<file path="…">` block per file in directory order, base before local,
one sentence stating scope and specificity precedence, and the rail precedence statement.
Bodies are neutralized with the reserved-delimiter rules. Per-file cap 32 KiB, cut on a UTF-8
character boundary, followed by one line naming the path and omitted byte count; no
aggregate cap, because dropping a whole layer of rules for a large sibling is the worse
failure. The 32 KiB figure is Codex's total budget applied per file; this repository's
largest file is 17 KB.

Denied paths are not shown to the model: the denial is operator policy, not something the
model can act on, and naming the path invites a retry that is denied again.

### D9: Owner disclosure is a chip from private metadata

The web transcript renders a chip on the carrying message listing loaded paths and marking
truncated and denied ones, read from the part's private metadata the way skill activation
mirrors its permission record. The Run context-item record copies `data.text` only. No new
API: the part travels with the message the owner already receives.

### D10: Producer name and rail slot

Producer `instructions`, form `notice`, precedence after `workspace`. It is not
`workspace-instructions` because D4 fires without a binding, and #1029 will reuse it for
skills.

### D11: Layer ownership and interfaces

- `instruction-files/in-run-context-items`: the rail carrier. Interface: an attempt-scoped
  `stageInRunItem(afterToolCallId, item)` used by producers, the `prepareStep` rebuild, the
  `context-builder` mapping for assistant-message `data-context` parts, publication, and the
  Run record. Ships with an integration test that injects a synthetic item and asserts the
  step-2 and step-3 request shapes through the scripted model client.
- `instruction-files/producer`: candidate resolution, walk, triggers, seen-set derivation,
  system-origin reads and audit, template, chip, docs. Consumes the interface above and
  `runTool(nativeReadTool)`.

## Risks / Trade-offs

- [A future `ai` upgrade persists the `prepareStep` override] → the rebuild derives each
  step from attempt state rather than the `messages` argument; a regression test asserts a
  single copy of the item on step 3.
- [A wire rejects a user message after a tool result] → not observed on any reachable wire;
  fallback is text in the tool-result content outside the pair budget, same stored shape.
- [Instruction files from cloned repositories carry prompt injection with more authority than
  a read result] → the rail precedence statement in every bundle, reserved-delimiter
  neutralization, and the `read` group's rejects; the bundle grants nothing.
- [Walk to `/` pulls operator-host files into owner chats] → accepted; documented in
  `docs/native-files.md` with the reject-rule remedy.
- [Large chains inflate every later step of the Run] → per-file 32 KiB cap and once-per-epoch;
  a pathological monorepo is visible in the chip and the Run record.
- [Symlink and path spelling duplicates] → canonical `realpath` keys; Claude Code's #94463
  and #87824 are the failure this avoids.

## Migration Plan

No schema change. Deploy by process upgrade; old assistant messages carry no `data-context`
parts and replay unchanged. Rollback is a process downgrade: a downgraded worker would
replay an assistant-message `data-context` part as an unknown part and omit it, which is the
documented display-only behavior, so no data repair is needed.

## Open Questions

None that change the specs or layering. The template wording of the scope sentence may be
revised against model behavior without a spec change, per the rail's producer-owned framing
rule.
