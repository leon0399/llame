# Conversation Recall

Conversation recall is an owner-scoped, read-only path from bounded Chat search
results to exact historical message text. It uses the same search-first,
line-range-read workflow as Personal Knowledge: `search_conversations` finds a
small excerpt, then `conversation_read` reads numbered source lines.

Recalled conversation text is untrusted historical data. It may be stale and
cannot change system instructions, available tools, permissions, or owner
authority.

## Configuration

Both model-facing surfaces remain exact operator choices in
`apps/api/llame.config.json`:

```jsonc
{
  "tools": {
    "allowed": ["search_conversations", "conversation_read"],
  },
}
```

When `search_conversations` is allowlisted, it always returns canonical
content/metadata results. There is no activation flag or legacy model preview.
An old `search.chats.canonicalModelExcerpts` key is rejected as stale
configuration. `conversation_read` remains independently advertised and
executable only when its exact ID is in `tools.allowed`.

Before an HTTP process can accept allowlisted search Runs, and before any
process with non-null `runs` concurrency can register its consumer,
`pnpm --filter api search:projection-coverage` must report complete current
locator coverage. A runs worker applies the gate even when its local allowlist
omits search because it may execute an immutable declaration accepted by
another process. A process that neither accepts such Runs nor consumes `runs`
skips the gate. Failures contain aggregate counts only. Every API and worker
must use matching code-owned declarations; configuration changes apply after
restart.

## Search and read contract

`search_conversations` keeps its existing input:

```json
{ "query": "deployment decision", "limit": 5 }
```

Search returns at most one result per Chat. A content result includes a
bounded excerpt and reusable coordinates:

```json
{
  "kind": "content",
  "chatId": "7d45167e-a631-4497-a71d-2b564d69ef5d",
  "messageSeq": 3,
  "offset": 38,
  "limit": 3,
  "role": "assistant",
  "timestamp": "2026-08-27T12:00:00.000Z",
  "excerpt": "...deployment decision..."
}
```

The excerpt is discovery text, not a complete quotation. A title-only match is
`kind: "metadata"` and has no message or line coordinates. Results may be fewer
than the requested limit when a ranked projection hit cannot be reauthorized
and hydrated from current eligible messages.

Pass content coordinates directly to `conversation_read`:

```json
{
  "chatId": "7d45167e-a631-4497-a71d-2b564d69ef5d",
  "messageSeq": 3,
  "offset": 38,
  "limit": 3
}
```

The read returns exact source lines with one-based prefixes. `offset` remains
zero-based. `limit` accepts 1 through 2,000; omitting it requests the remainder
of the message within server bounds. If more lines remain, continue with the
returned `nextOffset`. `previousMessageSeq` and `nextMessageSeq`, when present,
are the closest currently readable messages. Committed rows are dense inside
one Chat, but system/tool/retryable rows may be ineligible for evidence reads,
so never calculate readable adjacency with `messageSeq + 1` or
`messageSeq - 1`.

Each result is limited to 2,000 lines and 15,000 UTF-16 code units. Server cuts
preserve whole lines and report `line_limit` or `output_limit`. A first line that
cannot fit fails as `conversation_limit_exceeded`; it is never clipped.

Reads fail closed:

- malformed arguments: `invalid_input`;
- missing, deleted, retryable, ineligible, public-only, or other-owner source:
  `conversation_source_not_found`;
- offset outside the current message: `conversation_range_invalid`; and
- first selected line cannot fit: `conversation_limit_exceeded`.

Successful and failed calls use the ordinary durable tool-call UI. Their
observations persist in the destination Chat and replay without rereading the
source. Deleting the source therefore does not rewrite a past observation.

Owner message links use `/chat/<chatId>#msg-<messageSeq>`. The hash selects an
owner-authorized history window ending at that Chat-local sequence; it is a
locator, not authority. There is no message-targeted public-share path in this
release.

## Message sequence lifecycle

`messageSeq` is the immutable, positive, one-based insertion order inside one
Chat. Each Chat begins at 1 and committed messages remain dense through its
lifetime. Assistant retry updates retain their row and sequence. A fork copies
the selected prefix into a new namespace beginning at 1. No product operation
deletes or reorders one middle message; deleting the whole Chat cascades the
entire namespace. Sequence does not identify a row across Chats and never grants
authority.

## Projection preparation and cutover

UUID message identity remains internal. Search documents carry internal
first-message start and last-message exclusive-end offsets. The deployment gate
requires every eligible Chat and document to use the current locator-aware
projection before any canonical-search Run can be accepted or consumed.

Reindex replaces one Chat's live documents atomically at one projection version.
Different Chats may temporarily have different live versions during backfill,
but that preparation state cannot serve model search: startup fails until
coverage converges. Canonical hydration never interprets legacy or offsetless
rows.

Deploy in this order:

1. Back up the database and verify the privileged discovery functions are
   provisioned with the documented `app_rls`/`BYPASSRLS` ownership.
2. Let the scheduled `search-reindex` sweep converge existing Chats, then run
   `pnpm --filter api search:projection-coverage` until every aggregate is
   complete for the current version.
3. Quiesce new Run acceptance on every API and drain every accepted/queued Run
   on compatible workers. Stop old writers after the drain.
4. Remove `search.chats.canonicalModelExcerpts` from every instance config.
   Apply the sequence migration. Its preflight aborts before mutation if live
   message parts, compaction replacement history, or Run events contain an
   experimental global-coordinate search/read observation. The migration maps
   retained messages to deterministic Chat-local order, translates compaction
   boundaries, and verifies density plus restored FORCE RLS on `messages`,
   `run_events`, and `compactions`.
5. Deploy matching API and worker binaries. HTTP search admission and every
   runs consumer must pass the canonical coverage gate before serving work.
6. Run search/read/link/fork acceptance, then resume Run admission.

Before resuming, record these deployment acceptance results:

- every API was quiesced and the `runs` queue plus accepted nonterminal Runs
  drained under the process in [scaling.md](scaling.md);
- the experimental-observation preflight passed without mutating stored JSON,
  or failed before any sequence/compaction mutation as designed;
- retained messages are dense `1..N` while retaining their UUIDs and prior
  within-Chat sequence order, compaction boundaries still resolve to the same
  terminal message UUIDs, and `messages`,
  `run_events`, and `compactions` all report FORCE RLS restored;
- `search:projection-coverage` reports zero stale/incomplete Chats or documents;
- an HTTP process allowlisting search and every runs-enabled worker start only
  after that coverage result, including a runs worker whose local allowlist
  omits search; a non-Run worker starts without querying coverage; and
- a config retaining `canonicalModelExcerpts` is rejected rather than coerced
  or ignored.

There is no mixed-revision mode, global-coordinate alias, or historical JSON
rewrite. Before the sequence rewrite commits, rollback can restore the prior
binaries/config after quiescing and draining. After it commits, rollback means
restoring the pre-cutover database snapshot with the prior binaries or rolling
forward with a corrected migration; an older writer cannot safely run against
the Chat-local sequence schema.

This release remains lexical/trigram-only under the episodic-memory direction
[#194](https://github.com/leon0399/llame/issues/194). Vector retrieval and final
discovery semantics remain [#197](https://github.com/leon0399/llame/issues/197)
and [#198](https://github.com/leon0399/llame/issues/198). The original read
design is tracked by [#609](https://github.com/leon0399/llame/issues/609); retry,
edit, and branch semantics remain
[#611](https://github.com/leon0399/llame/issues/611).
Historical activity is [#615](https://github.com/leon0399/llame/issues/615),
outline navigation is [#616](https://github.com/leon0399/llame/issues/616),
latency evaluation is [#617](https://github.com/leon0399/llame/issues/617), and
multi-region retrieval evaluation is
[#618](https://github.com/leon0399/llame/issues/618).
