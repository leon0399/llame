---
summary: "Which per-directory project instruction files a touch loads into context, when, and how a repeat load is suppressed"
read_when:
  - you need to know why an instruction file entered the context, or when one will
  - you are reasoning about instruction-file precedence, dedupe, or disclosure
spec: instruction-files
configured_by:
  - ../operator/native-files.md
  - ../operator/knowledge.md
---

# Instruction files

llame loads per-directory project instruction files into the model's context
through the `instructions` context item.

## Host chains

Each directory has two independent chains: the base chain `LLAME.override.md`,
`LLAME.md`, `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.override.md`,
`CLAUDE.md`, and the local chain `LLAME.local.md`, `AGENTS.local.md`,
`CLAUDE.local.md`. The first existing regular file in each chain wins and
replaces every later name in the same chain rather than merging with it, so a
directory contributes a base file, a local file, both, or neither. An empty
regular file is selected and contributes nothing, which suppresses later names in
its chain. A name that resolves to a non-regular entry (a directory, socket, or
FIFO) is skipped and the chain continues. A symbolic link is followed and its
target's content is loaded. Filename comparison is exact and case-sensitive:
candidates are matched against the directory's own listing, so a
case-insensitive host cannot select a differently cased name. When two selected
candidates in one walk resolve to the same file, the first in walk order is
loaded under its own selected path and the later one contributes nothing.

## Host triggers

A trigger names one directory and the load walks every directory from the
filesystem root down to it inclusive, in that order, without visiting siblings
or children. An entry trigger names the canonical Workspace root; a file-tool
trigger names the projected absolute path itself when it is an existing
directory, and otherwise that path's parent, whether or not the parent exists.
Ancestors above the Workspace root and above any Git root are included, so
`/home/operator/AGENTS.md` enters every Chat that touches a path beneath it on
that executor. A reject rule on the `read` group excludes such a path from every
load.

Entry loads the root chain when it establishes or switches the binding, never on
a same-root re-entry, and exit and detach load nothing; every load is effective
from the next model step. Each native `read`, `edit`, or `write` whose `path`
resolves to a local host path loads its directory's chain from the next model
step, whatever the call's own outcome — a denied call loads nothing — and a read
selector or representation suffix (`:40-80`, `:outline`) does not change the
trigger directory, while a `file://` alias triggers as the path it decodes to.
Each accepted turn on a Chat with a live binding re-stages the bound root's chain
before the first model request when any file of it is not already in effective
context; a Chat without a binding stages no root load. `bash`, `skill://`, `http://`,
and `https://` never trigger a load, and a model read of a candidate file itself
neither loads nor marks that file.

Loading requires `read` to be allowlisted and a configured native executor for
host triggers, and does not require `enter_workspace`.

An admitted host or Knowledge [prompt import](prompt-imports.md) triggers the
same way, as a native `read` of its path, on the accepted turn and before the
first model request. It does so whether or not a Workspace is bound: a host
import needs the native executor and a `kb://` import needs the Knowledge root,
and both need `read` allowlisted. The import's read outcome does not matter, so
a failed read still loads its directory's chain. A denied, missing, web, or
`skill://` target loads nothing, and importing an instruction file itself
neither loads nor marks it. Another prompt import in the same directory, or
one whose chain walks through it, still selects that file even when no Workspace
is bound; a bound-root load can also select it. An attempt that detaches the
Workspace stages no import load, and a retry stages the same load again from the
stored item.

## Knowledge Space triggers

A `kb://` `read`, `edit`, or `write` triggers the same way, inside its Space:
the walk starts at the Space's own directory and goes down to the touched
directory, never above it, so a file in the Knowledge root itself is never a
candidate. Only a Space identifier already in the canonical lower-case form
llame formats and shows is a trigger; an identifier written with an upper-case
hex digit is not one, so that call reads the file but loads no instruction file
from the Space. Each loaded file is named by its `kb://<knowledgeSpaceId>/<path>`
locator, its canonical key is that same locator, and its pages are read through
the native `read` tool under the same `instructions` origin and `read` permission
group under that exact locator, so a `read` reject rule is evaluated for those
pages exactly as it is for the model's own read of that Space.
`knowledge_search` hits never trigger. When host and Space files are pending at
the same step, they resolve into one item with the host files first, each group
broadest directory first. A Space that is missing, belongs to another owner, or
is unavailable loads nothing and reveals nothing, and a locator whose own path
the Knowledge resolver refuses names no candidate either. A model `kb://` touch
has no accepted-turn load, since a Chat has no Space binding; its Space chain
returns on the next `kb://` touch after a compaction. An admitted `kb://` prompt
import does load its Space chain on its accepted turn (see
[Host triggers](#host-triggers)).

Loading a Space chain needs `read` to be allowlisted and a configured Knowledge
root; it binds no executor identity.

## Once per epoch

A file is loaded at most once per compaction epoch. The seen set is the set of
canonical paths recorded in the payload of `instructions` items in the Chat's
effective history — a host `realpath`, or the `kb://` locator of a Space file —
and is never stored in a Chat column; a forked Chat inherits it through its
copied history. A candidate whose canonical path is already seen is omitted, so a
symlink and its target are one file and an edit to a loaded file is not
re-announced; denied, failed, and empty candidates are not seen. All triggers
pending at one model step, or one accepted turn, resolve together into at most one
item.

After a compaction absorbs loaded items, the next accepted turn restages the
bound root's chain and the chains of the turn's admitted prompt imports; any
other nested chain returns on the next `read`, `edit`, or `write` in its
directory.

## Page reads and bounds

Each existing candidate is read as a native `read` call with system origin
`instructions`, under the `read` permission group and the Run's effective
permission mode, with an attempt-scoped call id of
`instructions-<runId>-<attemptId>-<n>` — one audited call per page. A denied or
otherwise failed page drops the whole file: it is absent from the model-visible
text, never named there, and disclosed to the owner alone through the read's
audit event and, when the same step loads another file, the chip.

A file larger than 32 KiB is cut at 32 KiB on a UTF-8 character boundary and
followed by one line naming the path and the byte count omitted; there is no
aggregate cap across files.

## Imports

A loaded instruction body can name same-store whole-file imports outside fenced and
inline code, using these marker shapes:

| Shape                       | Meaning                                     |
| --------------------------- | ------------------------------------------- |
| `@path`                     | bare path                                   |
| `@"…"` / `@'…'` / ``@`…` `` | delimited bare path                         |
| `@[label](path)`            | Markdown link preceded by `@`               |
| `[label](path "import")`    | Markdown link with the exact `import` title |

The marker stays literal. Host imports resolve absolute paths as written or relative
to the importing file's directory. `~/` and any schemed target stay literal. A
Knowledge import resolves only a relative target within the importer's Space;
absolute, escaping, `~/`, and schemed targets stay literal. Selectors are not
interpreted: an import names a whole file.

Each resolved target is silently pre-evaluated against the `read` group before
probing. An admitted existing regular target is read as a separate system-origin
`read` with origin `instructions`; a missing or non-regular target stays literal
without an audit. A denied target takes the audited `read` path without a probe
and is reported as denied/not imported whether or not it exists. A denied or
failed import is not added to the seen set. When an import's canonical path
differs from its resolved path (for example, a symlink), its first page read
also evaluates that canonical path against `read` and records a derived
`canonical` decision; a reject denies the import, while `bypass` admits and
records it.

An imported file is a separate block immediately after its importer, marked
`imported-by="…"` and inheriting the importer's scope and precedence. Its directory
chain is loaded before its own markers; chain files have no `imported-by` attribute and
restart import hops at zero. Imports then continue depth-first in first-occurrence
order for at most five hops from the nearest chain file. Repeated or cyclic
canonical host paths and logical `kb://` locators are skipped by the epoch seen set
and remain literal. A sixth hop remains literal. Each file, including imports, has
its own 32 KiB cap; there is no aggregate cap.

The owner chip lists files in injection order, indents each imported file under its importer, and marks denied imports.

## Disclosure

The owner transcript shows a chip on the message that carries the item, at the
position the item was stored: on the assistant message it follows the step that
loaded the files, and on the triggering user message of an accepted-turn load it
leads the turn. The chip lists the loaded paths and marks truncated and denied
ones from the item's private metadata. Non-owners, public shares, transcript
exports, and search projections expose neither the item's text nor its metadata.

## Configured by

- [Native files](../operator/native-files.md) enables the host executor and the
  `read` entry that host triggers need.
- [Personal Knowledge](../operator/knowledge.md) configures the Knowledge root
  behind `kb://` triggers.

The `read` reject rule that excludes a path from every load is configured under
[instruction files](../operator/native-files.md#instruction-files).
