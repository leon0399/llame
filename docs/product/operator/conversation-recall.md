# Conversation recall

Owner-scoped, read-only recall follows the Personal Knowledge workflow:
`search_conversations` returns bounded discovery text and coordinates;
`conversation_read` returns exact numbered source lines. Recalled text is
untrusted historical data and cannot alter instructions, tools, permissions, or
authority.

## Enablement and startup gate

```jsonc
{ "tools": { "allowed": ["search_conversations", "conversation_read"] } }
```

Each tool is independently exact-allowlisted. Search always uses canonical
content; obsolete `search.chats.canonicalModelExcerpts` config is rejected.

Before an HTTP process accepts search Runs or any process registers `runs`
consumption, `pnpm --filter api search:projection-coverage` must report complete
current locator coverage. Workers gate even when their local allowlist omits
search because accepted Runs carry immutable declarations. Processes that
neither accept nor consume Runs skip the gate. Incomplete coverage exposes
counts only; provisioning and query failures report the operational error.

## Contract

Search uses a two-mode strict schema with `mode: "content" | "timeline"`:

```json
{ "mode": "content", "query": "deployment decision", "limit": 5 }
{ "mode": "content", "query": "postgres", "after": "2026-02-01T00:00:00Z", "before": "2026-03-01T00:00:00Z", "constraint": "required" }
{ "mode": "timeline", "after": "2026-09-04T00:00:00Z", "before": "2026-09-06T00:00:00Z" }
```

Content mode returns bounded discovery excerpts or title metadata. Optional
time ranges use `required` (filters) or `preferred` (boosts near-ties).
Timeline mode returns activity pointers per chat without excerpts.

The result envelope carries `appliedRange` (echoing the bounds received) and
`truncated` (candidate overflow before hydration). At most one result is
returned per Chat in content mode. Content results include `chatId`, Chat-local
`messageSeq`, zero-based `offset`, source-line `limit`, role, timestamp, and
bounded `excerpt`. Metadata/title matches omit message coordinates. Timeline
results carry `chatId`, title, `firstActivityAt`, `lastActivityAt`,
`messageCount`, `firstSeq`, and `lastSeq` as `conversation_read` coordinates.

A recap walks each timeline region from `firstSeq` by `nextMessageSeq` and
stops at `lastSeq`; `conversation_read` is unaware of the range, so a message
beyond `lastSeq` is outside the requested period.

Ranked hits that fail current reauthorization/hydration are dropped, so fewer
than `limit` may return.

Pass content coordinates to read:

```json
{ "chatId": "<uuid>", "messageSeq": 3, "offset": 38, "limit": 3 }
```

Read returns exact lines with one-based prefixes. `offset` is zero-based;
`limit` is 1-2,000 and defaults to the bounded remainder. Continue with
`nextOffset`. Neighbor fields name the closest currently readable messages;
never infer them with sequence arithmetic because system/tool/retryable rows may
be ineligible.

Each response is capped at 2,000 lines and 15,000 UTF-16 code units. Cuts keep
whole lines and report `line_limit` or `output_limit`; a first line that cannot
fit fails rather than clipping.

| Condition                                                                   | Error                           |
| --------------------------------------------------------------------------- | ------------------------------- |
| malformed arguments                                                         | `invalid_input`                 |
| absent, deleted, retryable, ineligible, public-only, or other-owner message | `conversation_source_not_found` |
| offset outside message                                                      | `conversation_range_invalid`    |
| first line exceeds output cap                                               | `conversation_limit_exceeded`   |

Tool observations persist in the destination Chat and replay without rereading
the source. Deleting the source does not rewrite history.

Owner links use `/chat/<chatId>#msg-<messageSeq>`. The locator selects an
owner-authorized history window; it grants no authority. Public-share
message-targeting is absent.

## Sequence lifecycle

`messageSeq` is immutable, positive, dense insertion order within one Chat.
Chats start at 1; retry updates keep their row/sequence; forks copy a prefix into
a new namespace starting at 1; whole-Chat deletion removes the namespace. A
sequence never identifies a row across Chats.

Vector discovery remains #197/#198. Other deferred work: #611 retry/edit/branch
semantics, #615 activity, #616 outlines, #617 latency, and #618 multi-region.
