---
summary: "conversation_read returns exact numbered source lines for one recalled message"
read_when:
  - you have message coordinates from search_conversations and need the passage
  - you need the read bounds, continuation, and failure vocabulary
spec: conversation-reads
configured_by: ../../operator/conversation-recall.md
---

# conversation_read

## Purpose

`conversation_read` returns exact numbered source lines from one message of the
owner's own chats. [search_conversations](search-conversations.md) supplies
the coordinates; this tool opens the passage.

## Arguments

```json
{ "chatId": "<uuid>", "messageSeq": 3, "offset": 38, "limit": 3 }
```

`offset` is zero-based. `limit` is 1-2,000 and defaults to the bounded
remainder. Continue a longer passage with `nextOffset`.

## Locators

Owner links use `/chat/<chatId>#msg-<messageSeq>`. The locator selects an
owner-authorized history window; it grants no authority. Public-share
message-targeting is absent.

## Result

The read returns exact lines with one-based prefixes. Neighbor fields name the
closest currently readable messages; never infer them with sequence
arithmetic, because system, tool, and retryable rows may be ineligible.

A message's attached images follow its numbered lines, one unnumbered
`[image media://<id> <name> <width>×<height>]` line each in stored order, or
`[image media://<id> unavailable]` for an image the owner's store cannot
resolve. Only the result that reaches the end of the text, the one without
`nextOffset`, carries them. They count toward no line offset or line bound,
but their size is reserved inside the 15,000-code-unit bound, so search
coordinates are unaffected and an image-only message reads as zero lines plus
its image lines.

Tool observations persist in the destination Chat and replay without rereading
the source. Deleting the source does not rewrite history.

## Behavior

### Sequence lifecycle

`messageSeq` is immutable, positive, dense insertion order within one Chat.
Chats start at 1; retry updates keep their row and sequence; forks copy a
prefix into a new namespace starting at 1; whole-Chat deletion removes the
namespace. A sequence never identifies a row across Chats.

## Bounds

Each response is capped at 2,000 lines and 15,000 UTF-16 code units. Cuts keep
whole lines and report `line_limit` or `output_limit`; a first line that cannot
fit fails rather than clipping.

## Errors

| Condition                                                                   | Error                           |
| --------------------------------------------------------------------------- | ------------------------------- |
| malformed arguments                                                         | `invalid_input`                 |
| absent, deleted, retryable, ineligible, public-only, or other-owner message | `conversation_source_not_found` |
| offset outside message                                                      | `conversation_range_invalid`    |
| first line exceeds output cap                                               | `conversation_limit_exceeded`   |

## Configured by

[Conversation recall](../../operator/conversation-recall.md) — the
`conversation_read` allowlist entry.
