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

The message index defaults to the newest 50 eligible messages, displayed in increasing sequence order. If the output bound cuts that default page, keep its newest whole rows and drop the oldest. Its earlier-history locator selects the previous at most 50 eligible messages: start at their earliest sequence and end just before the oldest shown sequence. For dense sequences 951-1000, this is `M901-950`. Resolve the start from eligible rows so gaps cannot stall paging. Render one bracketed earlier-history notice even when the current page fits completely. An explicit `M` range starts at its lower sequence and continues forward within its requested range. The Chat collection defaults to 20 rows, in owner pin order followed by non-pinned activity order, with Chat UUID ties. Keep untitled rows under an explicit untitled label. Collection ranges use current row positions. Both indexes fit whole rows and fail `representation_too_large` when their required first row cannot fit. Every successful Chat read carries the closed untrusted-history notice within its rendered bound.

Message text retains the existing `\n\n` text-part join and logical-line rules. Reuse source-line utilities, but do not enable filesystem context-line expansion or Markdown processors. Keep exact windows so search locators expand to the same message-local source. `raw` changes presentation only. Attachment placeholders come from stored parts without a media lookup, remain outside line coordinates, and appear only when the read reaches the text end. All Chat reads use the common 16,000-code-unit rendered bound and 2,000-line ceiling. Preserve whole-line fitting and fail on a first line that cannot fit. No generic clipping can replace a successful Chat page.

The message index reuses evidence eligibility rather than the owner's broader history DTO. Checkpoints, revised replies, running or otherwise mutable replies, system/tool rows, and digest-only host messages stay unavailable. Archived Chats remain directly readable, but discovery excludes them. No child lineage is introduced here. Existing and future owner-authorized child addresses remain readable; default search retains its separately settled child exclusion.

### D2. Shared rows, separate status

The shared row contains the canonical Chat locator, title, absolute activity date, message count, Workspace affinity, opening excerpt, and latest excerpt. Resolve one owner-scoped database snapshot for rows and their source messages. The opening source is the first stored user message. The latest source is the highest-sequence evidence-eligible message. Extract only visible text, collapse whitespace for these previews, then take at most 100 Unicode code points per excerpt. Do not reuse the web DTO's UTF-16 slicing. If both sources have the same sequence, emit one excerpt. If either has no visible text, omit it without substituting a different message.

Workspace affinity is the stored canonical `machine://` root, or `unbound`. Canonicalize legacy absolute roots using their stored executor identity, never the receiving Chat's current Machine. A stale binding remains an explicitly point-in-time description. No filesystem probe, Repository lookup, Project label, or extra path authority follows from this row.

Read results append status outside this formatter. In the same owner-scoped snapshot, read the single non-terminal Run and expose its exact durable status, or `idle`. Include it on every Chat collection row and on addressed Chat/message headers. Do not infer status from message timestamps or a process probe. Do not expose Run ids, errors, attempts, or provider diagnostics. The shared formatter and digest payload have no status field. Tests compare active and idle versions of the same digest input and require identical digest text and payload.

### D3. One read permission group

Project a valid Chat read to its canonical selector-free resource: collection, Chat, or exact message. Preserve the message sequence in its resource identity. A reject on a whole Chat can match both its root and messages. Evaluate permissions before any Chat lookup. An allow on `chat://` itself does not implicitly authorize every target unless the operator's clause matches them.

The example's whole-tool `read` allow already covers Chat locators. Delete its `conversation_read` group. The actual shipped map has eleven groups, including `wait` and `stop`, so the new map has ten groups. Correct the stale canonical count without changing any reject table cell. The domain-restricted alternative remains closed unless the operator adds a `^chat://` clause. `read-only` mode admits this read, `bypass` skips only the policy, and neither grants another owner's data.

Return the common `not_found` result for a missing, foreign, deleted, shared-only, or ineligible source. Keep strict malformed-address failures distinct. Return `unsupported_operation` for admitted `edit` or `write` Chat calls before any mutation or Run admission. A permission refusal can precede that result, as it does for other logical resources.

### D4. Search emits addresses and retires the executor

Keep retrieval, hydration, eligibility, ranking, excerpts, time ranges, and coverage gates unchanged. Replace content-result `offset`/`limit` navigation with one canonical locator `chat://<id>/<seq>:L<offset+1>-<offset+limit>`. Retain ordinary Chat/message attribution. Title-only rows carry their Chat locator without a fabricated message or excerpt. Timeline rows carry message locators for `firstSeq` and `lastSeq`; the model reads the bounded sequence interval or follows eligible neighbors and checks timestamps.

Remove the tool id from code-owned inventory, allowlists, description keys, packaged prompts, example config, and new executable paths. Invalid old config fails startup. A stale permission-group key remains inert under the existing exact-id policy rather than acquiring new authority. Gate search-to-read advice on `tools.read`.

Preserve historical tool calls/results in messages and Run events. Their rendering and replay use stored observations, never the removed executor. Do not rename historical tool ids or rewrite coordinates. Deployment drains old queued/live Runs before the declaration cutover. No sequence allocation changes or global-sequence migration occurs in this change.

### D5. Rail snapshots hold their own disclosure state

An enabled epoch starts with one `recency-digest` snapshot. Attach it to the triggering message in the same fenced dispatch transaction as other accepted-turn items. Persistence precedes model I/O. A failure after dispatch preserves the snapshot; a failure before commit establishes no disclosure. An empty eligible corpus still produces a snapshot with empty lists, so the producer can distinguish an empty baseline from no baseline.

Each snapshot carries the announced set for its baseline. Notices carry their rendered additions/corrections and cumulative validated comparison state. Entries record Chat id, disclosed pin state and title, and disclosed Workspace binding when known. The latest effective current-format item supplies comparison state, including retry input and in-Run items. Preserve historical text independently. Pre-cutover payloads with only `entries`/`pinChanges`, or an empty supersession payload, provide no current-format comparison state. They are not malformed new state. Do not add a legacy executor or infer ids from their titles. Reject a malformed explicit current-format state for production rather than inventing it from text.

New Chat additions come only from the existing capped 10-pinned plus 10-recent selection. Pin corrections use the already-announced ids and actual owner pin membership, not capped-list membership. Workspace corrections use already-announced, still-owned, non-archived sources and compare stored binding identities. Do not probe their Machines. A title or latest-message change alone does not produce an update. Existing rows remain point-in-time records until an ordinary event supplies a new row or compaction refreshes the baseline.

An unknown imported affinity is not a known `unbound` binding. Do not emit a correction for it until an enabled checkpoint refresh establishes a known binding. This prevents migration from turning a correction into first disclosure of historical roots.

Batch at most 20 corrections in one preparation, in Chat-id order. Advance comparison state only for corrections actually included. Deferred corrections remain detectable on the next Run. New additions already have the 20-row selection bound. If the rendered item cannot fit the normal item/request bounds, split the batch at whole rows rather than claiming undisclosed entries. Do not introduce an accumulated-epoch event cap. Persist no Run status in either text or comparison state.

Delete the three producer columns and all staging, rebake, fork-copy, and prompt-disclosure accounting that depends on them. Do not keep a second boolean, generation, or schema object as replacement told state.

### D6. Compaction carries the frozen baseline atomically

A checkpoint row remains summary-only. Publish a separate host-authored user-role message containing only the digest snapshot in the same fenced transaction. Its payload associates it with the checkpoint. Replay places the companion immediately after that checkpoint and before the retained triggering message, even when the checkpoint's storage sequence is higher. Owner forks copy the companion with its qualifying checkpoint and remap that association. Stored sequences remain immutable.

Digest-only host rows are transparent carriers, not turns. Exclude them from evidence, search, public projections, and shared forks. They do not start Runs, satisfy a later-user-message guard, become the latest turn, or alone make another compaction eligible. Keep those checks unchanged for real owner messages and job-delivery host messages. Existing refusals after an idle compaction Run or an absorbed latest turn remain in force.

With sharing enabled, resolve a fresh capped baseline. Recheck consent and the attempt fence inside checkpoint publication after candidate resolution. If that recheck finds sharing off, discard the fresh candidate and use the disabled carry path instead. A withdrawal race must not erase the old baseline.

With sharing off, carry only the frozen baseline of the prior epoch. Do not carry its accumulated notices or their expanded told-set. Derive the new epoch's comparison state from the carried baseline alone. Read no source Chat. An absent prior baseline produces no companion. This matches the shipped off behavior and bounds carry to the baseline's 20 rows.

The new companion has one canonical envelope, not nested copies of old envelopes. Its producer extracts only the code-owned outer envelope and provenance line from the prior baseline's valid stored text. It preserves the enclosed baseline body verbatim and authors a fresh canonical envelope around that body. This is an explicit author-time carry transform, not a replay transform or a rewrite of the source item. Validate the exact outer prefix and suffix before the extraction. Do not parse titles or excerpts as control text. Repeated disabled compaction strips one envelope and adds one, so it neither duplicates notices nor grows wrapper text.

Publication remains fenced and idempotent. A later attempt failure preserves the checkpoint and companion. Summary instructions exclude all digest snapshots and notices by envelope plus producer. An owner fork derives state from copied effective parts, not a source state beyond its anchor. Shared forks receive neither parts nor metadata.

### D7. Remove the prompt carrier completely

Delete `chats.*` paths, collections, gates, item fields, disclosure types, and the default prompt block. Preserve `webSearch` and `webSearch.engines` under `tool-prompt-templates`. Boot probes continue to vary every declared optional gate, including `user`, `skills`, and `webSearch`, with a representative temporal anchor. Preserve strict Handlebars validation and escaping. References to `chats` or `chats.*` fail startup with the model/tool identity and a migration instruction, without prompt contents.

The digest uses a packaged producer template. Its provenance and untrusted-content notice remain present regardless of an operator's system prompt override. New system-only receipts contain no digest. Owners inspect digest text through persisted context items under the existing owner-only inspection contract. Old receipts remain unchanged. Do not add a new UI in this change.

### D8. Convert provable historical disclosure before column deletion

The reader layer ships a one-time exporter while the old digest renderer and `chats.*` templates still exist. It records field-level emissions under owner scope, binds the result to the destination Chat, and compares the reconstructed system text with the relevant stored receipt. It cannot prove runtime-only tool-description wording, a missing old receipt, or a fork's absent receipt. A stored baseline or told-set is not proof that every text field reached the model.

Before the digest upgrade, drain acceptance and workers and take a recoverable database snapshot. Run that exporter under the reader-layer binary. Protect its output as private owner data. It contains only proven digest field bytes, destination/owner binding, and safe comparison metadata, not a full system prompt or credentials. If no proof exists, record the affected Chat and omitted fields privately. Per Q11, omit only those unprovable derived fields and continue. Do not reset Chats, enrich rows from sources, or treat absent evidence as consent.

The digest layer runs a standalone TypeScript upgrade entry point over that export before the new configuration boot check. It acquires the migration advisory lock and uses one database transaction for conversion, its completion witness, and the SQL migration runner. The SQL runner executes no renderer. Conversion needs no new digest-layer schema and runs before pending SQL migrations. Set the trusted owner identity transaction-locally for each owner-scoped import. Retire the exporter and all old renderer code after conversion. Keep no runtime old-column reader or template alias.

Imported items retain an original stored Run linkage from their supporting receipt or context part. Conversion creates no Run or fabricated Run id. If that provenance is unavailable, omit and privately report the unprovable derived item under Q11.

For each Chat with imported baseline fields, append a digest-only host row that holds their final-text baseline snapshot. Associate it with the active checkpoint, or the Chat origin if there is no checkpoint. Replay that imported baseline at its epoch start, before existing effective notices. Its storage sequence is new; no old message moves or changes. The baseline comparison state contains only safely attributable baseline disclosures. Unknown identity or affinity does not become a guessed id or `unbound`.

Append a second, latest digest-only host notice when trusted prior comparison state needs to survive. It records known old told-set ids and pin state, with unknown text/affinity explicitly absent. Its model text reports conversion without source content or a list restatement. Record the latest pre-conversion turn and the last original sequence as its logical cutoff. Retry and follow-up preparation of that latest turn loads both imported carriers regardless of their higher storage sequences. Later ordinary history includes the notice once. A fork copies the origin baseline with any selected prefix, or a checkpoint baseline with that checkpoint. It copies the comparison notice only when its anchor includes the original logical cutoff. Remap these associations. Do not move the comparison notice to epoch start or supersede earlier literal notices.

Every imported comparison id and pin state needs destination-bound proof of actual row emission, with the matched receipt where required. The old told-set alone is insufficient. Omit and privately report unproved entries so they do not suppress future ordinary additions. A proved emitted row can identify its source through trusted exporter accounting without inventing an id from display text.

Old digest payloads remain text-replayable but inert for current comparison. A fork whose prefix has no associated imported baseline follows ordinary initialization rules when sharing is enabled. While disabled, it produces no new disclosure. Q11 permits omission of unprovable derived state, not loss of source messages.

Bind the private export to an old-column fingerprint for each destination Chat. Before writes, compare that fingerprint and trusted owner/Chat identity. A mismatch imports no text for that Chat; privately report the omitted derived fields and continue other Chats. The converter accounts for every old Chat, including total omissions with no carrier or Run. It then sets a transaction-local completion witness. SQL checks that witness before dropping populated columns; a fresh empty database needs no derived import. The witness is not a persistent table or column. Any database failure rolls back conversion, witness, and column deletion together. Repeated execution after rollback is safe. Preserve historical parts, receipts, and observations. Keep titles, excerpts, and roots out of ordinary logs. Rollback after commit restores matching old binaries and the pre-upgrade snapshot. Delete the private export after verification under the backup procedure.

## Risks / Trade-offs

- R1. Shared rows expose canonical roots and latest assistant text to a configured model. Leo explicitly chose those disclosures. Keep the 200-code-point combined excerpt bound and owner RLS.
- R2. A dedicated snapshot row changes checkpoint assembly order. Cover pre-step, idle, mid-Run, failed-attempt, duplicate-publication, and anchored-fork paths before shipping the digest cutover.
- R3. Some old disclosure has no recoverable receipt or historical tool-description text. Q11 permits omission of only unprovable derived fields, with a private operator report. Test this boundary explicitly rather than block the whole installation upgrade.
- R4. Cumulative comparison payloads and notices can grow within an epoch, as the existing told-set did. Do not confuse the model-facing item bound with metadata retention.
- R5. `idle` means no non-terminal durable Run. It does not prove that an executor process is healthy. Read annotations can become stale immediately.
- R6. Active changes overlap by exact requirement name. `tool-search` shares the portable-policy and frozen-fork requirements. `model-roles` shares rail placement. Serialize canonical synchronization with those changes. If either remains active, block this finalize step until its canonical outcome can be reconciled. Rebase and merge every scenario and current field before synchronization. Do not import unapproved sibling features into today's canonical delta or let a later archive overwrite them.

## Verification

Use focused reader, selector, permission, search-shaping, digest, compaction, fork, config, and migration tests. Add negative cross-owner and public-projection cases. Exercise real `read` and `search_conversations` calls against two owner-scoped Chats in a throwaway scenario. For the digest cutover, exercise enabled baseline, Workspace-only change, disabled compaction, retry, and an anchored owner fork against a database.

Deterministic checks prove identity, bounds, order, persistence, and consent. A bounded live-model instruction-following probe checks that forged instructions in titles/excerpts do not become authority. It cannot prove model compliance universally. Do not claim cache-hit improvement without a separate measurement.

Two disposable probes exercised the actual old prompt renderer on 2026-11-23. Title-only and title-plus-excerpt templates both return entry index 0 in `chatsDisclosure`, so entry metadata cannot authorize all fields. In-memory instrumentation of field-emission callbacks captured an emitted title but not an excerpt used only as a condition. Both assertions passed. The reader-layer exporter uses that seam, but a trace of a changed template cannot prove past disclosure. Match the stored system receipt where possible and apply Q11's field omission otherwise.

A disposable sequence model also exercised a pre-step checkpoint at sequence 4, its companion at 5, and the retained triggering message at 3. Pair-first assembly produced checkpoint, companion, then triggering message without changing storage sequences. The anchored-copy model included the companion by checkpoint association and remapped that association. These are executable design checks, not proof of the future repository implementation.

A disposable probe carried a frozen baseline through four calls to the actual context-item renderer. Removing only the validated code-owned outer envelope before re-enveloping preserved the baseline body bytes and one envelope. No accumulated notices were carried.

The final review's disposable design model also checked sparse backward paging, migrated latest-turn preparation, earlier fork exclusion of comparison state, and completion accounting for total omissions. It returned 50 eligible earlier rows, two latest-turn carriers, and only the baseline for an earlier fork. These assertions do not replace implementation tests or a PostgreSQL migration exercise.

## Revision history

- v1, 2026-11-23. Initial design after Q1-Q9, dual-excerpt clarification, and read-only Run-status direction.
- v2, 2026-11-23. Verified both independent reviews. Added rendering-unit/status contracts, transparent-carrier turn admission, bounded baseline-only carry, consent-race fallback, and a runnable two-layer conversion path with Q11 omissions. Restored web-search projection, portable wait/stop groups, remaining retired-tool references, active-change serialization, default-index backward paging, literal-file precedence, and lost search bounds.
- v3, 2026-11-23. Combined the final local review with GitHub feedback. Closed prompt-import, media, consent, discovery-framing, and earlier-page rendering gaps. Defined migrated retry/fork inclusion, original comparison cutoffs, transaction-local conversion proof, unknown-affinity behavior, and exact bounded carry framing.
