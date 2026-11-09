---
type: Research
title: "Child agents across conversation forks: prior art"
description: "What oh-my-pi, Claude Code, Codex, OpenClaw, OpenCode, Gemini CLI and Pi do with existing child agents when the parent conversation is forked, branched or rewound: listing, messaging, copying, sharing, detaching and reply routing (#1612 Q8f)."
tags: [subagents, forks, lineage, agent-communication]
status: draft
generated: { by: "omp/claude-opus-5-5", at: "2026-11-08" }
---

# Q8f: what happens to child agents when the parent conversation is forked

Research for llame #1612, question Q8f. Primary sources only. Fetched or read 2026-11-08.
Pinned commits (local checkouts under `~/.cache/checkouts/github.com/`):
oh-my-pi `88a69582c7`, openai/codex `d92aae5501`, openclaw `d40aa7c6f2b`, sst/opencode `1bf08ae46a`,
google-gemini/gemini-cli `cd1b45c2d`, badlogic/pi-mono `c856eb0b`. Claude Code facts come from docs
(`https://code.claude.com/docs/en/{sessions,agent-view,sub-agents,agent-teams,checkpointing}.md`, fetched 2026-11-08).
Paths below are relative to the repo root; OMP paths are under `packages/coding-agent/src/`; Codex under `codex-rs/`.
`[INFERENCE]` = read from code but not exercised.

## Summary

No harness implements the llame options exactly. Four distinct behaviours exist:

1. Eager copy of the child transcripts into the fork (oh-my-pi `/fork`).
2. Move: children stay running and re-point to the new session (Claude Code `/branch`).
3. Detach: children stay with the original; the fork has a fresh root and a hard ownership check refuses it (OpenCode, OpenClaw).
4. Share and steal: any holder of the child id may resume it, and the single parent edge moves to the resumer (Codex v1 `resume_agent`).

No harness copies a child lazily on first write (option A). Only oh-my-pi copies, and it copies eagerly.

## 1. oh-my-pi (can1357/oh-my-pi @ 88a69582c7)

Ownership model: a child belongs to a root session by file path, not by id.
`session/session-manager.ts:380-398` says a subagent writes `<parent>/<agentId>.jsonl`, where `<parent>/` is the parent
file minus `.jsonl`. `registry/persisted-agents.ts:540-545` `sessionFileBelongsToRoot` is a path-prefix test.
`ensurePersistedRoster` (`:571`) restores `parked` refs by scanning only the current root's artifacts dir.
`agent://<id>` resolves against the caller root's dir first (`internal-urls/agent-protocol.ts:355-368`).
Messaging a parked ref revives it (`irc/messaging.ts:70-113`, "was parked; revived").

Three transitions, three different outcomes:

| Command                               | Code                                                                    | Children                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/fork` (whole session)               | `session/agent-session.ts:11900-11990`; `session-manager.ts:2524`       | New session file, same entries, header `parentSession` = old id. `await copySessionArtifacts(old, new)` (`:11964`, impl `session-manager.ts:182-214`) copies the whole artifacts dir, subagent `.jsonl` and `.md` outputs included. Result: same child ids (`Anna`), now owned by the new root, as independent copies. The method body never calls `#cancelOwnAsyncJobs` (cf. `:13984` in branch). [INFERENCE] a still-running async child keeps its owner id and delivers into the new transcript. |
| `/fork` at an entry (`fork(entryId)`) | `:11905-11917`, `copyArtifacts: true` at `:11912`                       | Path root..entry only, but the whole artifacts dir is copied in the background (`session-manager.ts:4100-4160`). Children spawned after the cut are copied too (no time filter) [INFERENCE from `fs.cp` of the directory]. Running jobs are cancelled (`:13984`).                                                                                                                                                                                                                                   |
| `/branch` (alias `/rewind`)           | `slash-commands/builtin-session.ts:622`; `agent-session.ts:13916-14040` | `createBranchedSession(leafId, {copyArtifacts: undefined})` (`:14003`). Artifacts are NOT copied: the new root has no children. Own async jobs and running subagents are cancelled (`:13984`). Old children remain on disk under the old root and are not in the new root's roster (detach plus kill).                                                                                                                                                                                              |

`/tree` navigation (`navigateTree`, `:14189`) stays in one file, so nothing happens to children.

Revival from a branch: possible only for children whose transcript lives under the new root, so after `/fork` yes (copies),
after `/branch` no. Replies: a revived copy reports to the root that owns its file. There is no cross-root routing.

## 2. Claude Code (docs, fetched 2026-11-08)

- `/branch` (`sessions.md#branch-a-session`): copies the transcript, switches the same process into the copy, original stays on disk.
  State table: "In-flight background subagents and background Bash commands: Keep running. Their output appears in the new branch
  you switched into, not in the original session." This is a move: results route to the new branch, not the original.
- `claude --continue --fork-session`: new process, so permission grants are not carried; the doc says nothing about running subagents.
- `/fork` (`agent-view.md#copy-the-session-with-/fork`): copies the conversation into a new background session while the
  original keeps running. "After the fork, the two conversations are independent: nothing the copy does enters the original
  conversation on its own", except explicit cross-session messaging. The docs do not say whether running or finished subagents of
  the source appear in the copy. UNDOCUMENTED. The nearby "What carries over" list (backgrounded subagents carry over) is for
  `/background`, a move, not `/fork`.
- Subagent resume (`sub-agents.md#resume-subagents`): `SendMessage` with the agent id or name resumes it. Transcripts are kept
  and a resumed subagent keeps its full history. A subagent that Claude stopped resumes automatically on a message. One stopped
  by the user does not.
- `/rewind` (`checkpointing.md`): restores code and conversation. "Subagent edits not restored": rewind restores only files the
  main conversation edited. Teammates: "`/resume` and `/rewind` do not restore in-process teammates" (`agent-teams.md#limitations`).
  The lead may then message teammates that no longer exist.
- A "fork" in Claude Code is also a subagent type (`/subtask`, `sub-agents.md#fork-the-current-conversation`): a child that
  inherits the whole parent transcript. That is spawn-with-context, not a fork of the parent.
- `/btw` and agent-view do not list subagents as rows (`agent-view.md:107`).

## 3. Codex CLI (openai/codex @ d92aae5501)

Thread fork: `core/src/thread_manager.rs:1637-1740` (`fork_thread_with_initial_history`) builds a new thread from a history
snapshot (`ForkSnapshot::{TruncateBeforeNthUserMessage, Interrupted}`, `:214-239`). It sets `forked_from_thread_id` and gets a fresh
thread id. Nothing in this path touches spawn edges or children.

Spawn edges: SQLite table `thread_spawn_edges(parent_thread_id, child_thread_id PRIMARY KEY, status)`
(`state/migrations/0021_thread_spawn_edges.sql`). `upsert_thread_spawn_edge` is
`ON CONFLICT(child_thread_id) DO UPDATE SET parent_thread_id = excluded.parent_thread_id` (`state/src/runtime/threads.rs:154-178`).
A child has exactly one parent. `Open` is written at spawn (`core/src/agent/control.rs:640-665`). `close_agent` writes `Closed`
(`agent/control/legacy.rs:55-90`).

After a fork:

- The fork starts with zero edges. Descendants are restored only on resume of the same thread id:
  `restore_v2_agent_metadata(&config, resumed.conversation_id)` runs only for `InitialHistory::Resumed` (`thread_manager.rs:2420-2433`)
  and lists descendants by that root id (`agent/control/spawn.rs:112-135`). V1 resume loads `Open` children by the resumed id
  (`spawn.rs:927-995`). A fork has a new id, so it sees none.
- The fork's copied history still contains the parent's collab tool-call items with child thread ids.
- `resume_agent` (V1, `tools/handlers/multi_agents/resume_agent.rs:34-130`) takes any thread id. There is no ancestry check:
  `AgentTarget::Id(id) => Ok(*id)` (`agent/control/target.rs:17-21`). `resume_agent` builds a `ThreadSpawn` source whose parent is the
  caller (`:80-95`), reopens the child from its rollout, and calls `persist_thread_spawn_edge_for_source` (`spawn.rs:1109`). The
  upsert overwrites `parent_thread_id`. So a fork that resumes an old child steals it: it leaves the original parent's `list_thread_spawn_children`.
  V1 completion watchers then notify the new parent (`spawn.rs:1095-1108`). [INFERENCE for the end-to-end sequence; each step is in the code above.]
- V2 path references (`/root/name`) resolve only in the live registry (`control/target.rs:55-71`), so a fork cannot address a child
  by path unless it is re-registered. Id targets still work.
- Test hint: `core/src/agent/control_tests.rs:1556` `resume_agent_from_rollout_does_not_reopen_v2_descendants`.

Result: Codex shares the child by id and re-parents on resume (last resumer wins). There is no copy.

## 4. OpenClaw (openclaw/openclaw @ d40aa7c6f2b)

- `/fork` (`src/auto-reply/reply/commands-fork.ts:80-384`) creates a new gateway session
  `agent:<agent>:fork:<uuid>` with `parentSessionKey` and `fork: true` (`:271-275`) and copies the transcript
  (`session-fork.ts`, `forkSessionFromParentTranscript`). Preview text says "Earlier context is copied; new messages stay here."
- Children are not copied or re-linked. `session-create-service.ts:849-853`: "Spawn lineage is declared, never inferred ...
  everything else (operator chats, forks, harness and plugin sessions) persists as a depth-0 root", and the spawn authority
  receipt is captured only for `creation.via === "spawn"` (`config/sessions/session-entry-lineage.ts:69-87`).
- `parentSessionKey` is a navigation link. `spawnedBy` is spawn authority (`config/sessions/types.ts:332-340`). [INFERENCE] the fork is
  not the controller of the original's children, because the fork entry carries no `spawnedBy` and no spawn receipt; I did not trace the controller check itself.
- Completion routing: `completionOwnerSessionKey` is "Immutable session key authorized to receive this child's completion handoff"
  (`types.ts:339`). Docs `docs/tools/subagents/announce.md:14-54`: results go to the requester's captured origin. Replies therefore
  always return to the original requester session, never to the fork. A fork has no route to announce.
- In-place reset (`docs/tools/subagents/nesting.md:83-87`): `/reset` and `sessions.reset` cancel unfinished native subagents
  associated with that session, keep child transcripts, and refuse to reset if cancellation is incomplete.
  `preserveSessionLineage` (`session-entry-lineage.ts:90-115`) keeps `spawnedBy`, `parentSessionKey`, `forkSource` across reset.
- `sessions_spawn context:"fork"` is the child-inherits-parent-transcript option (`docs/tools/subagents.md:26-32`), again spawn-with-context.

Result: detach. The fork is a depth-0 root; children stay with the original and keep reporting to it.

## 5. OpenCode (sst/opencode @ 1bf08ae46a, `packages/core`)

- `Session.fork` (`core/src/session.ts:339-379`) publishes `SessionEvent.Forked`. `projectFork` (`core/src/session/projector.ts:111-250`)
  inserts the new session with `parent_id: null` and `fork_session_id`/`fork_boundary` (`:152-158`). It copies settled messages only
  (`:190-200`: incomplete assistant, running shell, running compaction rows are skipped). Children (rows with `parent_id = parent`) are untouched.
- `subagent` tool (`core/src/tool/plugin/subagent.ts:152-166`): continuing a child by `sessionID` requires
  `existing.parentID === context.sessionID`, else `Session <id> is not a child of the current session`. A fork whose copied history
  mentions `sessionID` X cannot continue it.
- Completion routing: `recovery.parentSessionID = context.sessionID` (`:219-224`). Notifications go to the spawner (original).
- `Session.remove` interrupts, cancels jobs, then removes children (`session.ts:~395-405`). Deleting the original deletes the children that the fork's history still names.

Result: detach with a strict ownership check (option C, plus a dangling-reference hazard).

## 6. Gemini CLI, Pi, others

- Gemini CLI (`cd1b45c2d`): no fork or branch. `/restore` (`docs/cli/checkpointing.md`) restores files, the conversation, and
  re-proposes a tool call. `/rewind` (`docs/cli/rewind.md:42-50`) is destructive ("the AI model loses all memory of the interactions
  that were removed"). Local subagents run as one-shot executions; `local-executor.ts:149` keeps `parentSessionId` and `:811-817` saves
  a summary. I found no resume-by-id path for local subagents; `SendMessage` hits in `agents/` are the A2A remote client. No fork semantics for children.
- Pi (`badlogic/pi-mono`, `packages/coding-agent`): sessions are an in-file tree, with `/tree`, `/fork` (new session from an earlier user
  message), and `/clone` (copy of active branch) (`docs/sessions.md:30-40`, `docs/session-format.md:72`). Pi ships no subagents
  (`README.md:19`). The example extension spawns `pi --mode json -p --no-session` subprocesses (`examples/extensions/subagent/index.ts:298`),
  so children are ephemeral and untied to any session. A fork therefore has no children to inherit.
- Searched but not read: other harnesses in `docs/research/harnesses/` were not examined for this question.

## Comparison

| System                                   | Fork sees/lists children                     | Fork can message/resume                   | Child copied / shared / dropped                               | Reply routing                                          |
| ---------------------------------------- | -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| oh-my-pi `/fork`                         | Yes, copied roster (same ids)                | Yes, copies, revived on message           | Copied eagerly (whole artifacts dir)                          | Copy reports to the new root                           |
| oh-my-pi `/branch`                       | No                                           | No                                        | Dropped from new root; running ones cancelled; old files kept | n/a                                                    |
| Claude Code `/branch`                    | Same process, same subagent list [INFERENCE] | Yes (running continue)                    | Moved: running keep going                                     | Output appears in the branch, not the original         |
| Claude Code `/fork` (copy as bg session) | Undocumented                                 | Undocumented                              | Undocumented                                                  | Sessions independent; cross-session messaging explicit |
| Codex fork                               | No edges                                     | Yes by id (no ancestry check)             | Shared; edge re-parented to the resumer                       | V1 watcher notifies the last resumer                   |
| OpenClaw `/fork`                         | No (depth-0 root)                            | No (not controller)                       | Detached; originals unchanged                                 | Original requester (immutable owner)                   |
| OpenCode fork                            | No (`parent_id` null)                        | No ("not a child of the current session") | Detached                                                      | Original spawner                                       |
| Gemini CLI                               | no fork                                      | n/a                                       | n/a                                                           | n/a                                                    |
| Pi                                       | no subagents in core                         | n/a                                       | n/a                                                           | n/a                                                    |

## Implications for llame Q8f options

- A, copy-on-write child on first write from a fork: no prior art does lazy copy. oh-my-pi's eager directory copy is the nearest
  and only works because a child is a file in the parent's directory. In llame a child Chat is a DB entity with a ledger and
  possible live Run; a fork writing to it would need to clone the child chat on demand (new chat id, copied history). It gives
  independence without the ledger confusion of sharing, but needs a rule for ids the fork's copied history still names (`chat://uuid`
  would point to the original until the first write rewrites the handle).
- B, shared child with requester routing: closest is Codex, and Codex shows the hazard. With one parent edge per child, resume
  from a fork silently steals the child from the original, and no ownership check prevents it. If llame shares, requester routing must be per
  message/turn (the sender is recorded and the reply goes back to it), not a single mutable parent pointer; otherwise the
  original parent loses results. Claude Code's `/branch` moving output to the new branch is the same steal, tolerable only because the old branch is abandoned.
- C, fork drops/detaches children (read-only history): the most common outcome (OpenClaw, OpenCode, oh-my-pi `/branch`, Gemini, Pi).
  Both OpenClaw and OpenCode back it with an explicit ownership check at the write path (OpenCode: `parentID` must equal the caller;
  OpenClaw: immutable `completionOwnerSessionKey`). That check is what stops the dangling ids in copied history from becoming a
  takeover. Cost: copied history contains `chat://` handles the fork cannot write to, so the error must be clear ("child belongs to
  chat X; ask it there"), and `read` of those handles should stay allowed. OpenCode shows the other hazard: deleting the original
  cascades to children the fork still names.
- Whatever is chosen, `write chat://child` needs an explicit authority rule (owner check or recorded requester) from day one; the only
  system without one (Codex v1 `resume_agent`) exhibits the steal behaviour.
