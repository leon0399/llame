---
summary: "Enabling search_conversations and conversation_read, and the startup coverage gate"
read_when:
  - you are allowlisting recall tools on an API or worker host
  - you are diagnosing the search projection coverage gate
behavior:
  - ../reference/tools/search-conversations.md
  - ../reference/tools/conversation-read.md
---

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

Each tool goes in `tools.allowed` in the instance configuration named in the
[operator index](index.md#operator). Search always uses canonical content;
obsolete `search.chats.canonicalModelExcerpts` config is rejected.

Before an HTTP process accepts search Runs or any process registers `runs`
consumption, `pnpm --filter api search:projection-coverage` must report complete
current locator coverage. Workers gate even when their local allowlist omits
search because accepted Runs carry immutable declarations. Processes that
neither accept nor consume Runs skip the gate. Incomplete coverage exposes
counts only; provisioning and query failures report the operational error.

The behavior of each tool is documented in
[search_conversations](../reference/tools/search-conversations.md) and
[conversation_read](../reference/tools/conversation-read.md).

## Deferred work

Vector discovery remains #197/#198. Other deferred work: #611 retry/edit/branch
semantics, #615 activity, #616 outlines, #617 latency, and #618 multi-region.
