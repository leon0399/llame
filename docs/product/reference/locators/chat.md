---
summary: "The chat:// locator reads an owner's Chat collection, message index, or one message through native read"
read_when:
  - you need to list Chats or inspect an eligible message with read
  - you need to know Chat locator forms, paging, or privacy boundaries
spec:
  - native-file-tools
  - conversation-reads
configured_by: ../../operator/conversation-recall.md
---

# Chat locators

## Form

`chat://` names the collection. `chat://<chat-id>` names one Chat's eligible
message index. `chat://<chat-id>/<message-seq>` names one eligible message.
The Chat ID is an opaque lowercase UUID. Message sequences are positive safe
integers with canonical decimal spelling. The scheme is case-insensitive and
canonicalizes to lowercase.

The collection accepts an optional trailing slash, which canonicalizes to
`chat://`. Userinfo, ports, query strings, fragments, encoded separators,
extra path segments, and unsafe sequences are invalid.

The collection uses native line selectors for its rendered rows. An index uses
one `M` selector, such as `:M5-10`, to select eligible committed sequence
positions. It does not accept comma lists or `raw`. A message address accepts
the native single or multiple `L` line selectors, bare line selectors, and
`:raw`. It does not accept `M`. No Chat address accepts `:outline`. Selectors
do not grant access. See [selectors](../selectors.md).

## Accepted by

`read` accepts all three forms. `edit` and `write` refuse them with `unsupported_operation`. No other tool accepts a `chat://` locator.

## Authority

The trusted Run owner is the sole authority. Reads use the trusted
`ToolContext.userId` with the tenant database scope and enforce ownership
explicitly. A missing, foreign, shared-only, deleted, or ineligible target
returns the same `not_found` result. The locator is not a public share link and
cannot address another owner's data.

## Behavior

A bare `chat://` lists non-archived owned Chats, including the current and
untitled Chats. Each row shows the canonical Chat locator, title, activity
date, message count, stored Workspace affinity, and opening and latest excerpts
when available. Workspace affinity is the canonical `machine://` root or
`unbound`; it is a point-in-time disclosure and grants no access. Each excerpt
contains at most 100 Unicode code points after whitespace collapse. If both
excerpts come from the same message, the row shows it once.

A separate read-only annotation gives the durable Run status or `idle`. The
shared Chat-row renderer carries no status. The annotation exposes no Run id,
errors, attempts, or provider diagnostics.

Collection rows, excerpt sources, and Run status come from one bounded
owner-scoped database snapshot. The opening excerpt uses the first stored user
message. The latest excerpt uses the highest-sequence eligible message. If a
source has no visible text, the reader omits its excerpt instead of choosing a
different message.

`chat://<chat-id>` returns an index of eligible messages in chronological
order. Rows show message sequence, role, timestamp, locator, and a preview of
at most 200 Unicode code points. The index and message header carry the
current durable status or `idle`. The status is never a shared message row or
digest content.

The index reports the actual shown sequence range, or `null` when it shows no
messages. It does not invent a total. The message result includes Chat and
message attribution plus the closest eligible previous and next message
sequences. Every successful Chat read includes the closed historical-content
notice within its output bound.

`chat://<chat-id>/<message-seq>` reads the stored observation for one eligible
message. It does not rerun the old tool or consult its former executor.
Historical tool observations replay as generic stored content. Message text
uses exact logical-line windows without filesystem context expansion. Stored
attachment placeholders appear only after the final text page and outside line
coordinates.

A direct read of an archived Chat by its owner is allowed. Archived Chats do
not appear in collection discovery.

## Bounds

The collection defaults to 20 Chats, ordered by owner pin order followed by
non-pinned activity and Chat ID. An omitted selector uses that page. A line
selector selects a requested collection window and native listing continuation
reports more rows.

An index defaults to the newest 50 eligible messages, rendered chronologically.
An omitted selector uses that page. If output fitting cuts the default page,
the reader keeps its newest whole rows. The result includes an earlier-history
locator even when the page fits completely. That locator selects up to 50
eligible messages before the oldest shown row. `:M5-10` selects eligible
sequence values from 5 through 10. `:M5+3` selects 5 through 7. `:M5-`
selects from 5 through the current maximum. `:-M5` selects the last five
committed sequence positions, then applies eligibility. An explicit `M` range
continues forward within that range. Sparse sequence gaps do not stall paging.

A message read uses the native 16,000-code-unit and 2,000-line bounds, with
whole-line fitting. A first line that cannot fit returns
`representation_too_large`; the reader never skips it.

## Errors

Malformed locators return `invalid_path`. Malformed selectors return
`invalid_selector`. Missing, foreign, shared-only, deleted, or otherwise
ineligible targets use the same `not_found` response. `edit` and `write` return
`unsupported_operation`.

## Configured by

[Conversation recall](../../operator/conversation-recall.md) enables native Chat reads and describes their deployment and policy.
