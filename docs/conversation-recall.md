# Conversation Recall

Conversation recall is an owner-scoped, read-only path from bounded Chat search
results to exact historical message text. It uses the same search-first,
line-range-read workflow as Personal Knowledge: `search_conversations` finds a
small excerpt, then `conversation_read` reads numbered source lines.

Recalled conversation text is untrusted historical data. It may be stale and
cannot change system instructions, available tools, permissions, or owner
authority.

## Configuration

Both model-facing surfaces are explicit operator choices in
`apps/api/llame.config.json`:

```jsonc
{
  "search": {
    "chats": {
      "canonicalModelExcerpts": true,
    },
  },
  "tools": {
    "allowed": ["search_conversations", "conversation_read"],
  },
}
```

`search.chats.canonicalModelExcerpts` defaults to `false`. While false,
`search_conversations` keeps its legacy model preview. Enable it only after
`pnpm --filter api search:projection-coverage` reports complete locator coverage
for the current projection version. `conversation_read` is advertised and
executable only when its exact ID is in `tools.allowed`.

Every API accepting Runs and every worker consuming them must use matching
configuration and code-owned declarations. Configuration changes take effect
after restart.

## Search and read contract

`search_conversations` keeps its existing input:

```json
{ "query": "deployment decision", "limit": 5 }
```

Canonical mode returns at most one result per Chat. A content result includes a
bounded excerpt and reusable coordinates:

```json
{
  "kind": "content",
  "chatId": "7d45167e-a631-4497-a71d-2b564d69ef5d",
  "messageSeq": 1842,
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
  "messageSeq": 1842,
  "offset": 38,
  "limit": 3
}
```

The read returns exact source lines with one-based prefixes. `offset` remains
zero-based. `limit` accepts 1 through 2,000; omitting it requests the remainder
of the message within server bounds. If more lines remain, continue with the
returned `nextOffset`. `previousMessageSeq` and `nextMessageSeq`, when present,
are the closest currently readable messages; sequences are sparse, so never
calculate adjacency with `messageSeq + 1` or `messageSeq - 1`.

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
owner-authorized history window ending at that sparse sequence; it is a locator,
not authority. There is no message-targeted public-share path in this release.

## Projection preparation and cutover

Message sequence is immutable authored order and unique within a Chat. UUID
message identity remains internal. Search documents carry nullable internal
first-message start and last-message exclusive-end offsets. New projection
writers populate them; old rows remain readable by legacy preview code during
preparation.

Reindex replaces one Chat's live documents atomically at one projection version.
Different Chats may temporarily have different live versions during backfill;
canonical hydration never interprets legacy or offsetless rows.

Deploy in this order:

1. Apply the compatible schema preparation and deploy locator-aware projection
   writers with canonical model excerpts still disabled.
2. Let the scheduled `search-reindex` sweep converge existing Chats, and run
   `pnpm --filter api search:projection-coverage` until coverage is complete.
3. Quiesce new Run acceptance and drain Runs bound to the prior code-owned tool
   declarations.
4. Deploy matching API and worker binaries and configuration.
5. Enable `search.chats.canonicalModelExcerpts`, add `conversation_read` to the
   allowlist, restart the fleet, and resume Run acceptance.

Rollback reverses the runtime route: quiesce new acceptance, drain Runs bound to
the newer declarations, disable canonical excerpts, remove `conversation_read`
from the allowlist, then restore older binaries. Keep nullable locator columns
and canonical messages in place. Legacy preview remains presentation-compatible
while older projection writers rebuild Chats.

This release remains lexical/trigram-only. Vector retrieval and final discovery
semantics remain [#197](https://github.com/leon0399/llame/issues/197) and
[#198](https://github.com/leon0399/llame/issues/198). The original read design is
tracked by [#609](https://github.com/leon0399/llame/issues/609); retry, edit, and
branch semantics remain [#611](https://github.com/leon0399/llame/issues/611).
Historical activity is [#615](https://github.com/leon0399/llame/issues/615),
outline navigation is [#616](https://github.com/leon0399/llame/issues/616),
latency evaluation is [#617](https://github.com/leon0399/llame/issues/617), and
multi-region retrieval evaluation is
[#618](https://github.com/leon0399/llame/issues/618).
