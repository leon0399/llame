## Context

See [proposal.md](proposal.md) for scope and decision links. The inspected base is `a39a42ff8` on `origin/master`. The workspace pins OpenSpec 1.13.1, AI SDK 6, and TypeScript 5.9.3. This design adds no dependency.

`tools/native-files.ts` dispatches logical schemes through `LOCATOR_READERS`. `projects/project-reader.ts` already combines an owner-scoped listing, detail reads, selector handling, and mutation refusals. `tools/listing-window.ts` supplies bounded collection windows. The Chat reader belongs beside these readers, on the hub, without a Machine request.

`tools/conversation-read.ts` owns exact visible-text windows today. `chats/conversation-evidence.ts` supplies the canonical text and eligibility rules. `MessagesRepository.findConversationMessage` combines an owner predicate, trusted session identity, and adjacent eligible sequences. Keep those seams rather than constructing evidence from history DTOs or search projections.

The digest currently has a frozen JSON baseline and a growing told-set on `chats`. Baselines enter replaceable templates. Updates already use persisted `recency-digest` items. `gitToldState` and `instructionsSeenPaths` demonstrate reconstruction from effective context without producer columns.

Prior art supplies mechanisms, not authorization. The [OMP reference](../../../docs/research/harnesses/oh-my-pi.md) is the primary tool reference. Its `history://` reads and the shared read selector model support one locator reader. The [OpenClaw reference](../../../docs/research/harnesses/openclaw.md) records session history and transcript ownership. Neither replaces llame's immutable message namespace or owner RLS. The [digest study](../../../docs/research/long-term-memory/2026-08-12-recency-digest-prior-art.md) separates disclosure volume from instruction authority. The 200-code-point total remains a disclosure bound, not a token estimate.

## Goals / Non-Goals

Keep the shortest complete implementation inside existing reader, repository, and context-item boundaries. Use one Chat row formatter and separate read-only annotations. Keep producer state in persisted items, with literal text as replay authority and validated payloads as comparison authority.

Do not add a second registry, a general context-producer framework, new configuration, caches, retries, or a Machine RPC. Do not change web Chat-list DTO previews. Do not expand prompt-import admission when adding a reader scheme.

## Decisions

### D1. One hub reader, three addresses

Register `chat` in the existing scheme dispatch. Parse the address before datastore access. A UUID is the existing canonical lowercase Chat UUID. A message sequence is a positive safe integer with canonical decimal output. Accept the scheme case-insensitively and canonicalize it before permission matching. Reject userinfo, ports, query strings, fragments, extra path segments, encoded separators, aliases, and unsafe sequences. An optional terminal slash on collection addresses has the same canonical identity without it. Do not decode an address into another resource.

| Address               | Read                                                           | Selectors                                                              |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `chat://`             | Non-archived owned Chats, including current and untitled Chats | Existing single line-index listing forms                               |
| `chat://<uuid>`       | Eligible message index                                         | One `M` member                                                         |
| `chat://<uuid>/<seq>` | Exact visible-message text                                     | Existing single and multiple `L` members, bare line members, and `raw` |

`M` names actual immutable sequence values. `M5-10` selects eligible rows with `seq` in that interval. `M5+3` requests sequence values 5 through 7. `M5-` selects through the current maximum sequence. `-M5` selects the last five committed sequence positions, then applies eligibility. Accept lowercase units and the matching repeated-letter end form as the shared grammar does for `L`. Never fill a gap by renumbering or extending a finite range. Reject mixed units, comma lists on indexes, `raw` on indexes, `outline` on Chat resources, and `M` on message text. A bare number on the message index means lines and therefore fails with a hint to use `M`.

The message index defaults to the newest 50 eligible messages, displayed in increasing sequence order. An explicit `M` range starts at its lower sequence and returns at most 50 eligible rows per page. The Chat collection defaults to 20 rows, in owner pin order followed by non-pinned activity order. Break activity ties by Chat UUID. It retains untitled rows under an explicit untitled label. Collection ranges use current row positions, not persistent identities. Both indexes return a continuation locator and exact omission information without splitting a row. A single row that cannot fit fails `representation_too_large`.

Message text retains the existing `\n\n` text-part join and logical-line rules. Reuse source-line utilities, but do not enable filesystem context-line expansion or Markdown processors. Keep exact windows so search locators expand to the same message-local source. `raw` changes presentation only. Attachment placeholders come from stored parts without a media lookup, remain outside line coordinates, and appear only when the read reaches the text end. All Chat reads use the common 16,000-code-unit rendered bound and 2,000-line ceiling. Preserve whole-line fitting and fail on a first line that cannot fit. No generic clipping can replace a successful Chat page.

The message index reuses evidence eligibility rather than the owner's broader history DTO. Checkpoints, revised replies, running or otherwise mutable replies, system/tool rows, and digest-only host messages stay unavailable. Archived Chats remain directly readable, but discovery excludes them. No child lineage is introduced here. Existing and future owner-authorized child addresses remain readable; default search retains its separately settled child exclusion.

### D2. Shared rows, separate status

The shared row contains the canonical Chat locator, title, absolute activity date, message count, Workspace affinity, opening excerpt, and latest excerpt. Resolve one owner-scoped database snapshot for rows and their source messages. The opening source is the first stored user message. The latest source is the highest-sequence evidence-eligible message. Extract only visible text, collapse whitespace for these previews, then take at most 100 Unicode code points per excerpt. Do not reuse the web DTO's UTF-16 slicing. If both sources have the same sequence, emit one excerpt. If either has no visible text, omit it without substituting a different message.

Workspace affinity is the stored canonical `machine://` root, or `unbound`. Canonicalize legacy absolute roots using their stored executor identity, never the receiving Chat's current Machine. A stale binding remains an explicitly point-in-time description. No filesystem probe, Repository lookup, Project label, or extra path authority follows from this row.

Read results append status outside this formatter. In the same owner-scoped snapshot, read the single non-terminal Run and expose its exact durable status, or `idle`. Include it on every Chat collection row and on addressed Chat/message headers. Do not infer status from message timestamps or a process probe. Do not expose Run ids, errors, attempts, or provider diagnostics. The shared formatter and digest payload have no status field. Tests compare active and idle versions of the same digest input and require identical digest text and payload.

### D3. One read permission group

Project a valid Chat read to its canonical selector-free resource: collection, Chat, or exact message. Preserve the message sequence in its resource identity. A reject on a whole Chat can match both its root and messages. Evaluate permissions before any Chat lookup. An allow on `chat://` itself does not implicitly authorize every target unless the operator's clause matches them.

The example's whole-tool `read` allow already covers Chat locators. Delete its `conversation_read` group and update the documented count from nine to eight. The domain-restricted alternative remains closed unless the operator adds a `^chat://` clause. Keep all existing regex tables unchanged. `read-only` mode admits this read, `bypass` skips only the policy, and neither grants another owner's data.

Return the common `not_found` result for a missing, foreign, deleted, shared-only, or ineligible source. Keep strict malformed-address failures distinct. Return `unsupported_operation` for admitted `edit` or `write` Chat calls before any mutation or Run admission. A permission refusal can precede that result, as it does for other logical resources.

### D4. Search emits addresses and retires the executor

Keep retrieval, hydration, eligibility, ranking, excerpts, time ranges, and coverage gates unchanged. Replace content-result `offset`/`limit` navigation with one canonical locator `chat://<id>/<seq>:L<offset+1>-<offset+limit>`. Retain ordinary Chat/message attribution. Title-only rows carry their Chat locator without a fabricated message or excerpt. Timeline rows carry message locators for `firstSeq` and `lastSeq`; the model reads the bounded sequence interval or follows eligible neighbors and checks timestamps.

Remove the tool id from code-owned inventory, allowlists, description keys, packaged prompts, example config, and new executable paths. Invalid old config fails startup. A stale permission-group key remains inert under the existing exact-id policy rather than acquiring new authority. Gate search-to-read advice on `tools.read`.

Preserve historical tool calls/results in messages and Run events. Their rendering and replay use stored observations, never the removed executor. Do not rename historical tool ids or rewrite coordinates. Deployment drains old queued/live Runs before the declaration cutover. No sequence allocation changes or global-sequence migration occurs in this change.

### D5. Rail snapshots hold their own disclosure state

An enabled epoch starts with one `recency-digest` snapshot. Attach it to the triggering message in the same fenced dispatch transaction as other accepted-turn items. Persistence precedes model I/O. A failure after dispatch preserves the snapshot; a failure before commit establishes no disclosure. An empty eligible corpus still produces a snapshot with empty lists, so the producer can distinguish an empty baseline from no baseline.

Each snapshot carries the full announced set for that epoch. Notices carry their rendered additions/corrections and a cumulative validated comparison state. Each announced entry records its Chat id, last-disclosed pin state and title, and last-disclosed Workspace binding when known. The latest effective item supplies the comparison state, including in-Run items and a retry's already-persisted input. Ignore metadata-only historical items under the existing inert-part rule. Reject malformed known comparison data for production rather than inventing state from text. Replay still uses stored non-empty text independently.

New Chat additions come only from the existing capped 10-pinned plus 10-recent selection. Pin corrections use the already-announced ids and actual owner pin membership, not capped-list membership. Workspace corrections use already-announced, still-owned, non-archived sources and compare stored binding identities. Do not probe their Machines. A title or latest-message change alone does not produce an update. Existing rows remain point-in-time records until an ordinary event supplies a new row or compaction refreshes the baseline.

Batch at most 20 corrections in one preparation, in Chat-id order. Advance comparison state only for corrections actually included. Deferred corrections remain detectable on the next Run. New additions already have the 20-row selection bound. If the rendered item cannot fit the normal item/request bounds, split the batch at whole rows rather than claiming undisclosed entries. Do not introduce an accumulated-epoch event cap. Persist no Run status in either text or comparison state.

Delete the three producer columns and all staging, rebake, fork-copy, and prompt-disclosure accounting that depends on them. Do not keep a second boolean, generation, or schema object as replacement told state.

### D6. Compaction carries a separate snapshot atomically

A checkpoint row remains summary-only. Publish a separate host-authored user-role message containing only the digest snapshot immediately after the checkpoint in the same fenced transaction. The snapshot is a `data-context` part with producer `recency-digest`; it is not checkpoint payload or summary text. This explicit placement extends the rail's dedicated-message rule. No new table is needed.

Request assembly places this snapshot immediately after its checkpoint and before the retained triggering message, even when a pre-step checkpoint has a higher sequence than that message. Order this pair by its committed association with the checkpoint, not by sorting it among ordinary retained rows. Store that association in the digest item's payload as the checkpoint message id. Owner forks remap that association to the copied checkpoint. The ordinary user message sequence remains immutable. Exclude the snapshot-only host row from evidence reads, search, public projections, and public forks. Its persistence does not start a Run or create another owner request.

When sharing is enabled, resolve a fresh capped selection and publish its snapshot with the checkpoint. Recheck the setting and attempt fence in that transaction after candidate resolution. If sharing is off, reconstruct the prior effective digest state and carry only that already-disclosed state forward. Read no source Chats for that carry. Preserve historical literal items inside the new snapshot's carry text rather than regenerating their excerpts or inventing newer affinities. Mark them as already-disclosed, point-in-time context. The new item's payload retains the prior comparison state. An epoch with no prior digest produces no disabled snapshot.

A repeated compaction replaces the effective carry with one snapshot, not another live copy of the previous epoch. A model switch alone never creates a new baseline. A failure after checkpoint publication keeps both rows. Idempotent checkpoint publication also prevents duplicate companion rows. Summary instructions exclude the producer's snapshots, notices, and carry text by envelope plus producer. Model compliance enforces the semantic exclusion, not an automatic redactor.

An owner fork copies snapshot/notice text literally from the selected prefix. Its told state follows those copied parts, not post-anchor state from the source. A shared fork receives none of the digest parts or Workspace metadata.

### D7. Remove the prompt carrier completely

Delete `chats.*` paths, collections, gates, item fields, disclosure types, and the default prompt block. Update boot probes to vary independent `user` and `skills` gates with a representative temporal anchor. Preserve the rest of the strict Handlebars language and escaping rules. A reference to `chats` or `chats.*` fails startup with the model/tool identity and a migration instruction, without prompt contents.

The digest uses a packaged producer template. Its provenance and untrusted-content notice remain present regardless of an operator's system prompt override. New system-only receipts contain no digest. Owners inspect digest text through persisted context items under the existing owner-only inspection contract. Old receipts remain unchanged. Do not add a new UI in this change.

### D8. Preserve existing data through a one-time conversion

Drain API acceptance and workers before conversion. Take a recoverable database snapshot. Do not reset any database or change an applied migration.

Before dropping columns, convert each Chat's already-disclosed digest into a rail snapshot using only its stored baseline, told-set, existing literal digest parts, and the active old template's emission metadata. The conversion must not query source Chats. Copy only baseline fields that the old renderer actually disclosed. Do not infer source identity from duplicate titles, invent Workspace roots, add latest excerpts, or enrich old rows with locators. Preserve those historical row bytes as carry text. Retain known Chat ids and pin state in comparison metadata, with unknown affinity explicitly distinct from `unbound`.

The converter runs before the old rendering code is removed and writes ordinary final-text context items. Export field-level emission data under the old binary if the schema migration cannot load that renderer. Validate the export against owner and destination Chat identity before import. This is a one-time migration input, not a runtime reader or compatibility executor. Conversion is transactional and idempotent; abort before column deletion if a baseline cannot be safely accounted for. Keep original historical parts, receipts, and observations unchanged. A converted snapshot replaces their comparison state but not their records.

While sharing is off, the converted snapshot carries only those historical bytes. The first enabled comparison can disclose missing locators or affinity through ordinary bounded updates. A later enabled checkpoint produces the full new row shape. Delete the export after successful conversion verification under the operator's normal backup procedure. Rollback requires the matching old binaries and pre-conversion database snapshot, since the old binary requires the removed columns.

## Risks / Trade-offs

- R1. Shared rows expose canonical roots and latest assistant text to a configured model. Leo explicitly chose those disclosures. Keep the 200-code-point combined excerpt bound and owner RLS.
- R2. A dedicated snapshot row changes checkpoint assembly order. Cover pre-step, idle, mid-Run, failed-attempt, duplicate-publication, and anchored-fork paths before shipping the digest cutover.
- R3. Historical custom templates can make conversion ambiguous. The migration must fail before deletion rather than guess. Verify the old renderer/export path with stored-data fixtures before implementation reaches migration.
- R4. Cumulative comparison payloads and notices can grow within an epoch, as the existing told-set did. Do not confuse the model-facing item bound with metadata retention.
- R5. `idle` means no non-terminal durable Run. It does not prove that an executor process is healthy. Read annotations can become stale immediately.
- R6. The active `model-roles` proposal touches prompts and compaction. Reconcile by requirement name before publication and again before finalize; do not overwrite its scenarios.

## Verification

Use focused reader, selector, permission, search-shaping, digest, compaction, fork, config, and migration tests. Add negative cross-owner and public-projection cases. Exercise real `read` and `search_conversations` calls against two owner-scoped Chats in a throwaway scenario. For the digest cutover, exercise enabled baseline, Workspace-only change, disabled compaction, retry, and an anchored owner fork against a database.

Deterministic checks prove identity, bounds, order, persistence, and consent. A bounded live-model instruction-following probe checks that forged instructions in titles/excerpts do not become authority. It cannot prove model compliance universally. Do not claim cache-hit improvement without a separate measurement.

Two disposable probes exercised the actual old prompt renderer on 2026-11-23. The first showed that title-only and title-plus-excerpt templates both return entry index 0 in `chatsDisclosure`. Entry metadata alone therefore cannot authorize a migration to emit every field. The second instrumented the existing field-emission callbacks in memory, without editing source files. An excerpt used only as a conditional produced no field trace, while the emitted title did. Both assertions passed. The migration must use that field-level trace, not the old entry set. A trace of a newly changed template does not prove past disclosure. Compare its rendered output with the relevant stored prompt receipt, or abort before deleting state.

## Revision history

- v1, 2026-11-23. Initial design after Q1-Q9, dual-excerpt clarification, and read-only Run-status direction.
