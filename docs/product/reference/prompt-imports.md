---
summary: "Import markers in a prompt: which marker shapes and read locators import, how admission and bounds apply, and what the model receives"
read_when:
  - you want the assistant to start a turn with a file, range, outline, Knowledge file, skill, or URL already read
  - you need to know why a marker in your prompt was or was not imported
  - you are reasoning about the prompt-imports context item, its bounds, or its audit
spec: context-injection
configured_by:
  - ../operator/native-files.md
  - ../operator/knowledge.md
  - ../operator/tool-call-permissions.md
---

# Prompt imports

A marker in your prompt points at something `read` can read. Before the Run's
first model request, llame reads it for you and puts the result in front of the
model, so the assistant does not spend a step fetching what you already named.
Your text is stored and shown exactly as typed; the import is added beside it.

## Markers

Three shapes are recognized in prompt text, outside fenced code and inline
code:

| Shape                    | Example                               |
| ------------------------ | ------------------------------------- |
| `@path`                  | `compare @README.md:30-35`            |
| `@[label](path)`         | `see @[the guide](docs/guide.md)`     |
| `[label](path "import")` | `[the guide](docs/guide.md "import")` |

A bare `@path` starts at the beginning of a line, after whitespace, or after one
of `(`, `[`, `{`, `<`, `"`, `'`, and runs to the next whitespace without its
trailing sentence punctuation. An email address such as `leo@example.com` is
never a marker. A marker whose path the `read` rules do not admit is reported as
not imported and audited, even if nothing exists there. An admitted marker whose
target does not exist stays prose and records nothing: with a readable path,
`ping @leo` imports nothing and records nothing. The same marker twice is one
import, and the markers are taken in first-occurrence order.

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

Any [selector](selectors.md) rides along, so the imported body is what `read`
returns for the same locator, context lines and Markdown ancestor headings
included:

| Prompt                                                   | Imports                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@README.md:30-35`                                       | lines 30-35 of the Workspace's `README.md`, with the context lines and ancestor headings `read` adds |
| `@https://github.com/leon0399/llame/issues/1029:outline` | the outline representation of that page                                                              |

A regular file literally named with a selector-shaped suffix wins over the
selector, as for `read`.

A relative path in a Chat with no Workspace is prose. An absolute or `file:`
target in an unbound Chat is imported only when the operator has enabled native
host reads; a `kb://` target only when the operator has configured Knowledge
(see [native files](../operator/native-files.md) and
[Knowledge](../operator/knowledge.md)). A `kb://` Space that is not
yours is not found, so its marker stays prose.

## Admission

Imports use the same authority as a model `read`, not more:

1. The `read` permission group is evaluated silently against each host or
   Knowledge target, before anything touches the filesystem. A denied target is
   audited and reported as not imported, without a probe, **whether or not the
   file exists**, so a denial never reveals a path.
2. Only an admitted target is probed. An admitted target that does not exist,
   or a host target on a process with no native executor, stays prose with no
   audit event, notice, or chip.
3. Each surviving target is read once through `read`. In `bypass` mode the
   target is admitted without evaluating the group, and the decision is recorded
   as bypass. If `read` is not available at all, nothing is imported.

`skill://` and web targets need no probe and go straight to the read; one the
`read` rules reject is reported as not imported. A web
import records every derived decision (redirect, alternate, adapter request,
network address) like any web read. The permission rules themselves are in
[tool-call permissions](../operator/tool-call-permissions.md#matching) and
[permission modes](permission-modes.md).

## Audit

Each read is a durable `read` with system origin `prompt-import`: requested,
started, and completed, except a denied target, which has requested and
completed only. The origin is owned by llame; a model cannot set it, and the
read never appears as an assistant tool call.

## What the model receives

All imports of one message are one `prompt-imports` notice, rendered before the
message text and after any skill activation. It holds one file block per
imported target, labelled with the locator as written, with reserved delimiters
neutralized, under a statement that the content is third-party data ranked
below system instructions and your requests and cannot grant tools or relax
authorization. A denied or failed target is named only as not imported, with no
content.

Imported files are data. Markers inside them are not followed, so imports do not
nest. `@skill://review` reads that skill's `SKILL.md` as data and activates
nothing; activation stays the `$review` form.

## Bounds

| Bound              | Limit                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| markers considered | 64, in first-occurrence order; later ones are prose                   |
| reads per message  | 8 targets that survived the probe or need none                        |
| output             | 128 KiB for the whole item; each result keeps `read`'s own truncation |
| work               | 30 s, probes included, or the Run's remaining deadline                |

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
again.

Imports run after the attempt's Workspace binding re-check. An attempt that
detaches the Workspace imports nothing and its markers stay prose; an item an
earlier attempt stored still replays unchanged.

## Configured by

- [Native files](../operator/native-files.md) enables the host executor and the
  `read` entry that host imports need.
- [Personal Knowledge](../operator/knowledge.md) configures the Knowledge root
  behind `kb://` imports.
- [Tool-call permissions](../operator/tool-call-permissions.md) sets the `read`
  rules that admit or deny a target.
