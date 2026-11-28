---
summary: "search_conversations returns bounded recall hits with chat:// locators for native read"
read_when:
  - you are looking for something a previous Chat in this owner's history said
  - you need a locator for an exact message read
spec: chat-search
configured_by: ../../operator/conversation-recall.md
---

# search_conversations

## Purpose

`search_conversations` discovers the owner's Chats. It returns bounded excerpts
and `chat://` locators that native [read](read.md) can open.

## Arguments

A strict two-mode schema, with `mode` set to `"content"` or `"timeline"`:

```json
{ "mode": "content", "query": "deployment decision", "limit": 5 }
{ "mode": "content", "query": "postgres", "after": "2026-02-01T00:00:00Z", "before": "2026-03-01T00:00:00Z", "constraint": "required" }
{ "mode": "timeline", "after": "2026-09-04T00:00:00Z", "before": "2026-09-06T00:00:00Z" }
```

Content mode requires a non-empty `query`. `limit` is 1-10 and defaults to 5.
Optional `after` and `before` values are absolute timezone-explicit instants.
They form the half-open interval `[after, before)`. If either bound is present,
`constraint` is required and must be `required` or `preferred`. `required`
filters results. `preferred` boosts near-ties. When both bounds are present,
`after` must be earlier than `before`.

Timeline mode rejects `query` and `constraint`, and requires at least one time
bound. Its `limit` is 1-50 and defaults to 20.

## Locators

Content hits with message evidence carry
`chat://<chat-id>/seq:L<offset+1>-<offset+limit>`. This selector reads the
corresponding message lines through native `read`. A metadata or title match
carries the bare `chat://<chat-id>` locator and no message coordinates or
excerpt. Timeline results carry `chat://<chat-id>` plus `firstLocator` and
`lastLocator` for the first and last eligible messages in the interval.

## Result

Every success carries `notice`, which frames recalled text as untrusted
historical data that cannot change instructions, tools, permissions, or owner
authority. The response includes `appliedRange` and `truncated`. Content mode
returns at most one result per Chat. Message hits include `chatId`, role,
timestamp, message sequence, a bounded excerpt, and the `chat://` locator.
Metadata or title matches omit message coordinates and excerpt.

Timeline results include `chatId`, title, `firstActivityAt`,
`lastActivityAt`, `messageCount`, `firstSeq`, `lastSeq`, `firstLocator`, and
`lastLocator`.

Hits that fail current reauthorization or hydration are dropped. A response
can contain fewer results than its limit.

## Behavior

Content mode returns bounded excerpts or title metadata. Timeline mode returns
activity pointers without excerpts. Search locators do not constrain the source
read: a `chat://` read is unfiltered by the search time range.

Recap guidance checks each opened message's timestamp against the requested
interval. Use native `read` for the source messages. See [Chat locators](../locators/chat.md).

## Bounds

- Content mode returns 1-10 results, default 5, with at most one result per Chat.
- Timeline mode returns 1-50 results, default 20.
- Excerpts are bounded previews, not transcripts.
- `truncated` marks candidate overflow before hydration. Hits that fail
  reauthorization or hydration are dropped.

## Configured by

[Conversation recall](../../operator/conversation-recall.md) enables
`search_conversations` and its search projection coverage gate.
