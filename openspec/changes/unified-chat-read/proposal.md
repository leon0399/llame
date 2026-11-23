## Why

Chat recall has a separate `conversation_read` tool even though `read` already owns locator-based reads. The recency digest cannot identify a readable Chat or its Workspace, and its system-prompt baseline duplicates disclosure state in three Chat columns.

## What Changes

- Add `read("chat://")` for the owner's non-archived Chats. Reuse one Chat row for this listing and the recency digest.
- Add `read("chat://<uuid>")` for a compact message index. Show the latest 50 eligible messages by default, in chronological order. `M` selectors address immutable message sequences, not filtered positions.
- Add `read("chat://<uuid>/<seq>[:L…]")` for the existing visible-message text view. `:raw` removes numbered prefixes without exposing reasoning, tool parts, or context items.
- Add a point-in-time Run status annotation to read results only. Use the current non-terminal Run status, or `idle`. Never place status in digest items.
- Emit directly readable `chat://` locators from content and timeline search results. Keep the owner-facing `/chat/<id>#msg-<seq>` links.
- Use the ordinary `read` permission group with selector-free canonical Chat resource identities. Retain owner RLS independently of permission mode.
- **BREAKING:** delete `conversation_read`, its declaration, prompt, configuration entry, and new-call executor. Preserve historical observations as stored data.
- Give shared Chat rows a title, locator, absolute activity date, message count, canonical Workspace locator or `unbound`, and two excerpts. Each excerpt has at most 100 Unicode code points. One comes from the first user message, the other from the latest eligible message. Omit duplicate source messages and empty excerpts.
- Move the digest baseline to a persisted `recency-digest` snapshot on the context rail. Derive disclosure state from effective stored items. Delete `recency_digest_baseline`, `recency_digest_told`, and `recency_digest_rebaked_from`.
- Keep the opt-in, selection caps, pin semantics, untrusted-content notice, and non-erasure contract. Add bounded notices when an already-announced Chat changes Workspace.
- Preserve already-disclosed digest state across compaction while sharing is off. Carry that state in a separate snapshot, never in the checkpoint summary.
- **BREAKING:** delete the `chats.*` namespace from system and tool-description templates. Reject references at startup with an actionable diagnostic.

## Capabilities

### New Capabilities

None. `conversation-reads` keeps ownership of the Chat read contract and the shared Chat row.

### Modified Capabilities

- `conversation-reads`: locator forms, visible text, message index, shared Chat rows, owner authority, read-only status, and bounds.
- `native-file-tools`: Chat dispatch, live `M` selectors, mutation refusals, and logical-source exceptions to filesystem behavior.
- `chat-search`: readable content and timeline locators instead of separate reader coordinates.
- `tool-call-permissions`: canonical Chat identities and removal of the recommended `conversation_read` group.
- `tool-calling`: retirement of the standalone reader and preservation of historical observations.
- `tool-prompt-templates`: search guidance follows `read` membership.
- `tool-result-rendering`: `M` index headers and continuations, ordered Chat attribution, and historical read-status annotations.
- `model-system-prompts`: removal of `chats.*`, digest-free new receipts, and compaction without digest columns.
- `context-injection`: rail-only digest residency and atomic post-checkpoint snapshot placement.
- `chat-recency-digest`: shared rows, transcript-derived disclosure, baseline snapshots, Workspace notices, consent, inspection, and migration.
- `owner-chat-forks`: digest state follows the copied effective prefix rather than the source Chat's current columns.
- `turn-actions`: digest-only carrier rows do not replace the latest turn, and replaced replies stay unavailable through Chat reads.
- `instance-config`: explicit rejection of the retired tool and prompt namespace.

## Acceptance

- An owner follows a content search locator directly with `read` and receives the same eligible message and line space.
- A Chat index skips checkpoints, revised or mutable replies, and digest-only host messages without renumbering.
- Chat reads report `idle`, `queued`, `running_model`, `awaiting_jobs`, or `awaiting_quota` from current durable state.
- Status never enters the recency digest, even when the same Chat changes Run status between preparations.
- Missing, foreign, shared-only, and deleted Chat targets have the same closed not-found result. Empty trusted identity fails closed.
- An archived Chat is absent from discovery but remains directly readable by its owner, as today.
- A selector changes the read window, not the permission identity. Case changes cannot evade a `chat://` reject.
- `edit` and `write` refuse Chat locators without effects. This change starts no Run in another Chat.
- New digest snapshots and notices persist final text before model I/O. A retry replays those bytes without duplicate disclosure.
- A Workspace change in an already-announced Chat produces a bounded notice, without a full-list refresh or new schema state.
- Enabled compaction starts a fresh digest epoch. Disabled compaction carries only previously disclosed state and reads no source Chat.
- An owner fork derives digest disclosure only from its copied prefix. A public share or shared fork discloses none of it.
- Startup rejects `conversation_read` in `tools.allowed` or prompt overrides, and rejects `chats.*` in replaceable templates.
- Migration preserves Chats and historical observations. No database reset, transcript rewrite, or compatibility executor is required.

## Decisions and sources

The [feature brief](https://github.com/leon0399/llame/issues/703) and [digest cutover](https://github.com/leon0399/llame/issues/1906) define one change because both use the same Chat row requirement.

Settled addressing and lineage come from [Q7](https://github.com/leon0399/llame/issues/1612#issuecomment-6714683229) and [Q7a](https://github.com/leon0399/llame/issues/1612#issuecomment-6714919158). The [selector decision](https://github.com/leon0399/llame/issues/1833) fixes `L`, `M`, and canonical output spelling. The [producer rule](https://github.com/leon0399/llame/issues/1489#issuecomment-6715360525) forbids dedicated told-state columns.

Leo settled Q1 through Q8 and Q5a in the [first decision record](https://github.com/leon0399/llame/issues/703#issuecomment-7111170009). Q9 and the additional read-only status requirement are in the [second record](https://github.com/leon0399/llame/issues/703#issuecomment-7111204049).

Leo clarified disabled carry and historical migration in [Q10 and Q11](https://github.com/leon0399/llame/issues/703#issuecomment-7112407333). Disabled compaction preserves only the frozen baseline. Migration omits only unprovable derived disclosure and privately reports affected Chats, without resetting messages or blocking every Chat.
[Chat-to-Chat messaging](https://github.com/leon0399/llame/issues/1903) builds on these addresses but owns writes and write-started Run authority. [Map #1754](https://github.com/leon0399/llame/issues/1754) supplies that dependency context. [#972](https://github.com/leon0399/llame/issues/972) retains temporal-anchor and cache-breakpoint work. Removing the digest alone does not make complete system prompts identical across Chats.

## Assumptions and boundaries

- The proposal branch `unified-chat-read/proposal` was created with `gh stack init --base origin/master` before any change artifact.
- Existing uncommitted files belong to Leo. They were restored after the rebase and remain outside proposal commits.
- Bare `chat://` lists all non-archived owned Chats, including the current Chat and untitled Chats. The digest retains its narrower eligibility rules.
- The Chat collection uses existing line-index listing selectors. A Chat's message index uses sequence-based `M` selectors.
- Message line reads preserve exact source windows, without native filesystem context-line expansion. The shared visible-text coordinates remain stable.
- Chat locators do not become prompt imports, grep scopes, aliases, or public-share grants in this change.
- Status is an observation of a durable Run, not proof that a process is alive or a promise that the next read sees the same state.
- New latest-message excerpts can disclose assistant visible text. The combined excerpt limit stays 200 code points per row.
- Workspace affinity describes a stored binding. Reading it neither probes that Machine nor grants access to its files.
- Proposal review and artifact readiness confer no implementation or publication permission.

## Non-goals

- Chat writes, inter-Chat delivery, subagent spawn, lineage storage, or loop bounds.
- Chat recaps, a unified search engine, public history access, or private-part inspection.
- Temporal-anchor removal, provider cache breakpoints, cache-hit claims, or new operator options.
- Changes to the web Chat list's existing preview format.

## Impact

The implementation changes the API reader, selector parser, permission projection, search shaping, registry, prompts, digest producer, Run preparation, compaction, fork copy, and focused tests. The second cutover needs a data migration before it drops the three digest columns. Each shipping layer updates its reference and operator documentation, changelog, and completed roadmap entries.

Two implementation layers form one linear stack. The reader layer closes #703. The digest layer builds on it and closes #1906. Finalize owns canonical spec synchronization and archive movement. No application code belongs in this proposal branch.
