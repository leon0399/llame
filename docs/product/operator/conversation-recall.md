---
summary: "Enabling Chat discovery and native chat:// reads, and the search projection coverage gate"
read_when:
  - you are allowlisting Chat discovery and reads on an API or worker host
  - you are diagnosing the search projection coverage gate or preparing the reader exporter
behavior:
  - ../reference/tools/search-conversations.md
  - ../reference/locators/chat.md
---

# Conversation recall

`search_conversations` discovers owned Chats. Native `read` opens their
`chat://` collection, indexes, and eligible messages. Both are read-only and
owner-scoped. Historical text is untrusted data and cannot alter instructions,
tools, permissions, or authority.

## Enablement and startup gate

```jsonc
{ "tools": { "allowed": ["search_conversations", "read"] } }
```

Add `search_conversations` and `read` to `tools.allowed` in the instance
configuration named in the [operator index](index.md#operator). The `read`
permission group must also admit the desired `chat://` locator. Search retains
the canonical projection coverage gate. The old `conversation_read` tool is
removed. An old `tools.allowed` entry or prompt override for that id fails
startup; remove both before upgrading. A stale
`tools.permissions.conversation_read` key is inert because permission groups
match exact tool ids. Search uses canonical content; obsolete
`search.chats.canonicalModelExcerpts` configuration is rejected.

Before an HTTP process accepts search Runs or any process registers `runs`
consumption, it requires complete current locator coverage, as reported by
`pnpm --filter api search:projection-coverage`. When coverage is incomplete,
such as after a process stop interrupted a Run, the check enqueues up to 500
stale Chats on the reindex queue and waits up to 2 minutes for reindex workers
to complete coverage. Startup fails at once if an enqueue fails or no stale
Chat could be queued, and otherwise if coverage is still incomplete at that
deadline. A process whose worker profile omits `search-reindex` therefore
needs a reindex worker running elsewhere. Workers gate even when their local
allowlist omits search because accepted Runs carry immutable declarations.
Processes that neither accept nor consume Runs skip the gate. Incomplete
coverage exposes counts only; provisioning, query, and enqueue failures report
the operational error.

`search_conversations` advice to open results is gated on the exact advertised
`read` tool. Content evidence uses `chat://<id>/<seq>:L<start>-<end>`.
Metadata or title matches use `chat://<id>`. Timeline results use
`firstLocator` and `lastLocator`, each naming an eligible message with a
`chat://<id>/<seq>` locator. Read
[search_conversations](../reference/tools/search-conversations.md) and
[Chat locators](../reference/locators/chat.md) for behavior and paging.

## Reader exporter before the digest upgrade

The reader release keeps the old digest renderer, columns, and `chats.*`
templates. Before upgrading to the later digest release, take a recoverable
database backup, stop new acceptance, and drain the reader release's workers.
Then run the exporter with the reader-layer binary:

```bash
pnpm --filter api recency-digest:export --out <path>
```

Choose a path in private storage. Keep the exported file private and ensure its
mode is `0600`. The exporter writes one version 1 JSON object identified as
`recency-digest-export/1`. Its records bind each destination Chat and owner to
the old-column fingerprint, proved emitted fields, comparison state,
provenance, and omissions. It contains no full prompt, template, or transcript.

The exporter includes a baseline field only when its emission is proved against
the applicable stored system receipt and the owner and destination binding. The
proof compares the reconstructed system text with that exact receipt. A missing
receipt, a receipt mismatch, or any other missing proof means the exporter
omits that derived field and privately reports the affected Chat and field. It
continues with other records. It does not claim unproved content reached the
model.

An identical receipt alone does not bind the historical digest inputs. A
rebaked baseline needs an owned checkpoint and a later dispatch by the exact
receipt attempt. Before the first rebake, a recorded quota initializer tied to
that attempt can supply the input witness. Without one, even an ordinary
first-epoch Chat can have all derived digest fields omitted with
`baseline_input_unproved`. The exporter leaves stored messages and receipts
unchanged. Titles that collide after prompt sanitization cannot prove a
comparison identity.

Comparison pin state comes from proved baseline list membership and the last
proved pin correction in the destination's effective stored notices. It never
comes from the mutable told-set's pin flag. A notice without model-visible
text or an uncertain correction order cannot prove the pin; affected entries
are omitted with `pin_unproved` rather than suppress a future announcement.

Preserve the export with the database backup. The later digest upgrade's
converter consumes this file before removing legacy columns. That converter
has not shipped with the reader layer.

Run the exporter with the reader-layer binary before deploying the digest
upgrade. Do not run it against the pre-reader binary or after the digest
upgrade.

## Deferred work

Vector discovery remains #197/#198. Other deferred work includes #611
retry/edit/branch semantics, #615 activity, #616 outlines, #617 latency, and
issue #618 for multi-region.
