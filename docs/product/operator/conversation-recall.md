---
summary: "Enabling Chat discovery, digest consent and upgrades, and the search projection coverage gate"
read_when:
  - you are allowlisting Chat discovery and reads on an API or worker host
  - you are diagnosing search coverage, preparing the reader exporter, or upgrading to the rail-only digest release
behavior:
  - ../reference/tools/search-conversations.md
  - ../reference/locators/chat.md
  - ../reference/context-documents.md
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

## Digest consent and inspection

The owner setting `shareRecentChats` defaults off. Enabling it includes
existing eligible Chats immediately. It shares each selected row's title,
`chat://` locator, activity date, message count, canonical Workspace root or
`unbound`, and bounded opening and latest visible-text excerpts. The latest
excerpt can include assistant text. In a multi-user installation, the
configured model provider may be a third party.

Disabling stops new baselines, refreshes, and notices. Existing baseline items
continue to replay, including across disabled compaction. Deleting a source
Chat does not erase disclosure already stored in another Chat's context items
or historical receipts. The owner can inspect the exact persisted digest text
in their Chat. The system-only prompt receipt does not include digest items.
See [context documents](../reference/context-documents.md#recency-digest) for
the storage and compaction behavior.

## Upgrade from the reader release

The reader release keeps the old digest renderer, columns, and `chats.*`
template values. Before deploying the rail-only digest release, take a
recoverable database backup, stop new acceptance, and drain the reader
release's workers.

Run the exporter with the reader-layer binary:

```bash
pnpm --filter api recency-digest:export --out <private-export.json>
```

Store the output in private storage with mode `0600`. It is a version 1
`recency-digest-export/1` JSON object. It binds each destination Chat and owner
to the old-column fingerprint, proved fields, comparison state, provenance,
and omissions. It does not contain a full prompt, template, or transcript.

The exporter includes each baseline field only when its emission is proved
against the applicable system-only receipt and the owner and destination
binding. A missing receipt or proof means it omits and privately reports that
derived field, then continues with other records. A receipt match does not prove
complete prompt identity or historical tool-description text. Rebaked
baselines require an owned checkpoint and a later dispatch by the exact receipt
attempt. Before the first rebake, a recorded quota initializer tied to that
attempt can supply the input witness. Without either witness, the exporter can
omit all derived fields for a first-epoch Chat as `baseline_input_unproved`.
Titles that collide after prompt sanitization cannot prove comparison identity.

The first-epoch input witness must be the immutable version 1 quota initializer
recorded for the exact receipt attempt. A mutable told-set cannot replace it.
Pin state comes from proved baseline membership and the last proved pin
correction in the destination's effective stored notices. A notice without
model-visible text or an uncertain correction order cannot prove a pin. The
exporter omits that comparison field as `pin_unproved`, rather than suppress a
future announcement.

The packaged `project_default` template proves membership only for rows it
actually emitted. A custom template that emits titles proves only those exact
emitted title values; it does not prove list membership or other fields.

Before starting the new API or workers, remove all `chats.*` references from
system-prompt and tool-description overrides. The new release rejects that
retired namespace during configuration validation. Run the standalone
converter on the new release before starting a process that validates those
templates:

The mutable told-set is only an inventory of candidate comparison entries.
It does not prove that a Chat was disclosed. Import a told id only when a
destination-bound emission and its matching dispatched receipt prove the
identity. Ambiguous entries are omitted and privately reported, remaining
eligible for a future announcement. Stored messages and receipts are unchanged.

Set `POSTGRES_URL` to the target database in the command environment. Do not
print or log its credentials.

```bash
pnpm --filter api db:upgrade-recency-digest --export <private-export.json> --report <private-report.json>
```

The converter takes the existing migration advisory lock and uses one
connection and transaction for conversion, the completion witness, and pending
SQL migrations.
It accounts for every legacy destination, including Chats with total omission.
Under Q11, it omits only unprovable derived fields and continues with other
Chats. It exclusively creates and syncs the private report with mode `0600`
inside the locked transaction before committing. The report contains inventory
and import counts plus omission details, not content text. On failure, the
command removes its report and prints only a generic error.
Keep both files private and review the report before proceeding. The conversion preserves original messages, context
parts, and receipts. It does not reconstruct unproved disclosure, enrich old
rows from source Chats, or create a Run when provenance is missing.

The pending migration `20261124014016_retire_recency_digest_columns` requires
the converter's `v1` witness before it drops the legacy columns. A fresh
database can establish that witness through ordinary migration only when the
catalog has no `chats` table in the migration schema. A preexisting legacy table
requires the standalone converter even when the table is empty.

After the command succeeds, start the API and workers on the matching new
release. Keep the database backup, private export, and private report until the
upgrade is verified. Delete both private files only under the backup retention
procedure. Rollback requires restoring the matching database snapshot and old
binary; do not roll back by deploying the old binary against the upgraded
database.

## Deferred work

Vector discovery remains #197/#198. Other deferred work includes #611
retry/edit/branch semantics, #615 activity, #616 outlines, #617 latency, and
issue #618 for multi-region.
