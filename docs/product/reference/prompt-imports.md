---
summary: "Import markers in a prompt: which marker shapes and read locators import, how admission and bounds apply, and what the model receives"
read_when:
  - you want the assistant to start a turn with a file, range, outline, Knowledge file, skill, URL, image, or PDF already read
  - you need to know why a marker in your prompt was or was not imported, and where the result is injected
  - you are reasoning about the prompt-imports context item, its bounds, or its audit
spec: prompt-imports
configured_by:
  - ../operator/native-files.md
  - ../operator/knowledge.md
  - ../operator/tool-call-permissions.md
---

# Prompt imports

A marker in your prompt points at something `read` can read. Before the Run's
first model request, llame reads it for you and puts the result in front of the
model, so the assistant does not spend a step fetching what you already named.
Your text is stored and shown exactly as typed; the import is a separate
context item beside it.

The same marker shapes also appear in project instruction files and in skill
files, where they resolve differently. Which document expands a marker, and
which item receives the bytes, is the [context documents](context-documents.md#the-same-marker-three-importers)
map.

## Markers

These shapes are recognized in prompt text. Markers inside fenced code or inline
code stay literal; the backtick form below is an `@` before a code span, not a
marker inside one.

| Shape                       | Example                               |
| --------------------------- | ------------------------------------- |
| `@path`                     | `compare @README.md:30-35`            |
| `@"…"` / `@'…'` / ``@`…` `` | `compare @"my notes/a b.md:30-35"`    |
| `@[label](path)`            | `see @[the guide](docs/guide.md)`     |
| `[label](path "import")`    | `[the guide](docs/guide.md "import")` |

A bare `@path` starts at the beginning of a line, after whitespace, or after one
of `(`, `[`, `{`, `<`, `"`, `'`, and runs to the next whitespace without its
trailing sentence punctuation. An email address such as `leo@example.com` is
never a marker. A marker whose path the `read` rules do not admit is reported as
not imported and audited, even if nothing exists there. An admitted marker whose
target does not exist stays prose and records nothing: with a readable path,
`ping @leo` imports nothing and records nothing. The same marker twice is one
import, and the markers are taken in first-occurrence order.

Delimited bare forms are `@"…"`, `@'…'`, and ``@`…` ``. Their non-empty,
single-line content is the whole locator passed to `read`, including any
selector. They use the same `@` boundary as a bare marker and have no escapes:
use another delimiter when the locator contains one, or a double-backtick span
when it contains a backtick. The closing delimiter must be followed by
whitespace, the end, or trailing punctuation; anything glued to it is not a
marker. An `@` inside inline code, such as `` `@a.md` ``, remains literal.

## Targets

A target resolves exactly as the `path` of a [`read`](tools/read.md) call, with
its selector attached. Every `read` locator is accepted:

| Target                       | Resolves as                                        |
| ---------------------------- | -------------------------------------------------- |
| absolute path, `file:` alias | the [host path](locators/host-path.md)             |
| relative path                | against the Chat's entered Workspace root          |
| `kb://<space>/<path>`        | the [Knowledge Space](locators/kb.md) file         |
| `skill://<name>/<path>`      | a [skill package](locators/skill.md) file, as data |
| `http://…`, `https://…`      | the [web](locators/web.md) read                    |
| `ssh://<host>/<path>`        | an [ssh locator](locators/ssh.md) read             |
| `machine://<name>/<path>`    | a [Machine](locators/machine.md) file              |
| `media://<id>`               | an image or PDF you [stored](locators/media.md)    |

An `ssh://` target imports only when the operator has enabled the `ssh` section
(see [ssh](../operator/ssh.md)); without it the marker stays prose and no SSH
process starts.

A `machine://` target imports only when the operator has configured Machines
and allows `read` (see [Machines](../operator/machines.md)); otherwise the
marker stays prose. The listing forms `machine://` and `machine://<name>` read
directly, like web targets.

Prompt imports accept every locator scheme `read` accepts. A scheme `read` does
not accept, such as `@foo://host/doc.md`, stays prose with no read and no audit
event. Only your prompt gets this: markers in instruction files and skill files
import local files only, and markers in imported content are not followed.

On a text target any [selector](selectors.md) rides along, so the imported body
is what `read` returns for the same locator, context lines and Markdown ancestor
headings included:

| Prompt                                                   | Imports                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@README.md:30-35`                                       | lines 30-35 of the Workspace's `README.md`, with the context lines and ancestor headings `read` adds |
| `@https://github.com/leon0399/llame/issues/1029:outline` | the outline representation of that page                                                              |

An image or PDF target, `media://<id>` or another locator that reads as either
kind, accepts no selector: `read` refuses it with `invalid_selector`
([read errors](tools/read.md#errors)), so `@media://<id>:1-5`, `@shot.png:raw`,
or `@paper.pdf:1-20` is reported as failed, not imported.

A regular file literally named with a selector-shaped suffix wins over the
selector, as for `read`.

A relative path in a Chat with no Workspace is prose. An absolute or `file:`
target in an unbound Chat is imported only when the operator has enabled native
host reads; a `kb://` target only when the operator has configured Knowledge
(see [native files](../operator/native-files.md) and
[Knowledge](../operator/knowledge.md)). A `kb://` Space that is not
yours is not found, so its marker stays prose. A `media://` id that is unknown
or names another owner's media is not found either, so its marker stays prose
and nothing about that media is recorded.

## Admission

Imports use the same authority as a model `read`, not more:

1. The `read` permission group is evaluated silently against each host,
   Knowledge, or `media://` target, before anything touches the filesystem or
   the media store. A denied target is audited and reported as not imported,
   without a probe, **whether or not the file exists**, so a denial never
   reveals a path.
2. Only an admitted target is probed; a `media://` probe looks the id up among
   your own media. An admitted target that does not exist, or a host target
   on a process with no native executor, stays prose with no audit event,
   notice, or chip.
3. Each surviving target is read once through `read`. In `bypass` mode the
   target is admitted without evaluating the group, and the decision is recorded
   as bypass. If `read` is not available at all, nothing is imported.

`skill://`, web, and `ssh://` targets need no probe and go straight to the
read; one the `read` rules reject is reported as not imported. An `ssh://`
target is admitted twice by the read itself: first on the submitted locator,
then on the destination it resolves to, so a rule that names the resolved
address decides too, and a target the SSH section does not enable stays prose.
A web import records every derived decision (redirect, alternate, adapter
request, network address) like any web read. The permission rules themselves
are in [tool-call permissions](../operator/tool-call-permissions.md#matching)
and [permission modes](permission-modes.md).

## Audit

Each read is a durable `read` with system origin `prompt-import`: requested,
started, and completed, except a denied target, which has requested and
completed only. The origin is owned by llame; a model cannot set it, and the
read never appears as an assistant tool call.

## What the model receives

All imports of one message are one `prompt-imports` context item with form
`notice`, stored on your message. On the first dispatch it follows any
`instructions`, `skill-catalog`, and `skill-activation` items and precedes your
text. A retry keeps a stored item in place. The first model request carries the
stored item. It holds one file block per imported
target, labelled with the locator as written, with reserved delimiters
neutralized, under a statement that the content is third-party data ranked
below system instructions and your requests and cannot grant tools or relax
authorization. A denied or failed target is named only as not imported, with no
content.

```text
<system-reminder producer="prompt-imports" form="notice">
Inserted by llame; not written by the user.
…one labelled block per imported target…
</system-reminder>
```

The reminder above is the rail envelope every context item uses. The block
inside it is the import.

A target whose `read` returns an image, such as `@shot.png` or
`@media://<id>`, becomes an image entry. Its file block holds exactly the
[image result](tools/read.md#image-result) `read` returns, format, dimensions,
and path, never the image bytes or its thumbnail. An image `read` refuses,
such as one over 40 megapixels, is reported as not imported.

An image read from a file, Knowledge, a skill, or a URL creates no media
object. The worker decodes it and keeps the model variant with the import entry
in the stored message. Right after the notice's text, a
[vision model](../operator/media.md#model-input) receives it as an image
part in this attempt's requests and in every later request of the epoch — a
later turn, a retry or resume, a compaction, or an owner fork — if the epoch
image window admits it; otherwise it gets the `not attached` placeholder naming
the locator as you wrote it as a JSON string literal. A text-only model always
gets `[image "shot.png" W×H, omitted: this model has no image input]`.

An `@media://<id>` import names an image you
[stored](locators/media.md) and creates no media object. A vision model receives
it from the store in that turn and every later one, under the same window; a
text-only model, or an image outside the window, gets the matching
`[image media://<id> …]` placeholder.

A PDF target, including `@paper.pdf`, `@https://example.com/paper.pdf`, or
`@media://<id>`, becomes a PDF entry. Its file block holds exactly the
[PDF result](tools/read.md#pdf-result) from `read`, without PDF bytes. The
private entry records its page count and byte size. An encrypted, unopenable,
or oversized PDF that `read` refuses is reported only as not imported.

For a PDF imported from a host file, Knowledge, a skill, or the web, a model
declaring `pdf` input receives the original as a native file part immediately
after the notice's text, if the shared media window admits it. The original
stays with the entry in the stored message, and no media object is created, so
every later request of the epoch replays it under the same window. Outside the
window the model gets
`[pdf "paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`.
A model without PDF input always gets
`[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]`.
The quoted locator is the marker's locator encoded as a JSON string.

A PDF imported from `@media://<id>` records that stored locator privately and
replays its original from the owner-scoped store on later requests under the
same media window, without creating another media object.

Imported files are data. Markers inside them are not followed, so imports do not
nest. `@skill://review` reads that skill's `SKILL.md` as data and activates
nothing; activation stays the `$review` form.

## Bounds

| Bound              | Limit                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| markers considered | 64, in first-occurrence order; later ones are prose                                                                                                                                                      |
| reads per message  | 8 admitted targets that survive the probe or need none, images and PDFs included; a denied host, Knowledge, or `media://` target (within the 64-marker cap) is audited without a read and does not count |
| output             | 128 KiB for the whole item; each text result keeps `read`'s own truncation; an image or PDF counts only as its result text, never its bytes or an image thumbnail                                        |
| work               | 30 s, probes included, or the Run's remaining deadline                                                                                                                                                   |

A target past the count or output bound, or one that survived probing when the
time bound fires, is listed once as omitted and not read. A host or Knowledge
target the time bound reaches before it is probed is dropped silently and stays
prose. Prose tokens that fail the probe are never listed as omitted. The time
bound also cuts off a read in flight, and a Run abort stops the pass with no
further read: a target cut off that way is omitted, never reported as failed.

## Retries and detaching

A retry or worker resumption reuses the stored item and reads nothing that
completed, in the original order; a target whose read started but did not
complete is admitted and read afresh. A file edited after the turn is not read
again. Image and PDF entries are reused as stored, so a new attempt replays
their retained bytes under the same window, and a `media://` entry still replays
from the store.

Imports run after the attempt's Workspace binding re-check. An attempt that
detaches the Workspace imports nothing and its markers stay prose; an item an
earlier attempt stored still replays unchanged.

An admitted host or Knowledge import also loads its directory's
[instruction files](instruction-files.md#host-triggers) on the same turn, before
the first model request, whether or not a Workspace is bound, and whatever its
read outcome; denied, missing, web, skill, and `media://` targets load none, and a detaching
attempt loads none. Importing an instruction file itself does not load it. A
retry keeps the bundle an earlier attempt stored and loads only unseen files.

## Disclosure

Your message shows a chip listing each import locator as imported, truncated,
denied, failed, or omitted, an image entry among them as imported; hovering
shows the resolved path when it differs. The chip reads the item's private
metadata, which also records an image entry's original width, height, and
format with its display-only thumbnail, left out when it would exceed its cap,
or its `media://<id>` locator; the thumbnail never reaches a model. PDF entries
record their kind, media type, page count, byte size, and optional stored
locator, with no thumbnail. Other owners, public shares, transcript exports,
and search see neither the item's text nor its metadata.

## Configured by

- [Native files](../operator/native-files.md) enables the host executor and the
  `read` entry that host imports need.
- [Personal Knowledge](../operator/knowledge.md) configures the Knowledge root
  behind `kb://` imports.
- [Tool-call permissions](../operator/tool-call-permissions.md) sets the `read`
  rules that admit or deny a target.
