---
summary: "Which documents reach the model, whether a marker inside them is expanded, and which surface carries the result"
read_when:
  - you need to know where a project instruction, Project context, a prompt marker, or a skill file shows up in the model's context
  - you are deciding whether to write a marker in a message, in an instruction file, or in a skill
  - you need to know when automatic Project guidance is fixed for a Run
spec:
  - context-injection
  - projects
  - project-context
  - instruction-files
  - prompt-imports
  - import-markers
  - agent-skills
  - personalization
  - model-system-prompts
configured_by:
  - ../operator/native-files.md
  - ../operator/knowledge.md
  - ../operator/skills.md
  - ../operator/tool-prompts.md
  - ../operator/tool-call-permissions.md
  - ../operator/repositories.md
---

# Context documents

A document reaches the model on one of two surfaces. The system prompt is
re-sent on every request. A context item is stored in the conversation, inside
one `system-reminder` block that begins "Inserted by llame; not written by the
user.", and is replayed until a compaction absorbs it. The page linked from
each row owns the rule.

## Where each document lands

| Document                 | How it is chosen                                                                                                           | Marker inside it                                                   | Where the model reads it                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| System instructions      | the packaged prompt, or the operator's replacement for that model                                                          | none                                                               | system prompt, every request                                                                                  |
| Personalization          | the owner's preferred name, about text, response preferences, and shared account identity, when the prompt references them | none                                                               | system prompt, inside a delimited block framed as data                                                        |
| Project context          | the Chat's Project when the Run starts executing, frozen for that Run                                                      | none                                                               | one `project` item before your text, after `tool-availability` and before `workspace`                         |
| Skill catalog            | proactively eligible skills, frozen for the compaction epoch                                                               | none; the model reads `skill://<name>` to load a body              | system prompt, as names and descriptions; an add or remove on a later accepted turn is a `skill-catalog` item |
| Project instruction file | first existing name in a directory's base chain, and first existing name in its local chain                                | expanded, whole file, same store                                   | one `instructions` item                                                                                       |
| Instruction import       | a marker in a loaded instruction file                                                                                      | expanded the same way, up to five hops from the nearest chain file | another file block in that same `instructions` item, with `imported-by`                                       |
| Prompt import            | a marker in your message                                                                                                   | left as text in the imported body                                  | one `prompt-imports` item before your text                                                                    |
| Skill instructions       | you write `$name` in the message                                                                                           | expanded, package-local only                                       | one `skill-activation` item: the `SKILL.md` body, then imported file blocks                                   |
| Skill import             | a marker in that frontmatter-free body                                                                                     | expanded the same way, package-local, up to five hops              | a file block after the skill body in that `skill-activation` item                                             |

On the first dispatch of an accepted turn, the document items that apply are
stored on your message in this order, each in its own block, and your text
follows them: `instructions`, then `skill-catalog`, then `skill-activation`,
then `prompt-imports`. A retry keeps stored items in place. A newly derived
`instructions` or `skill-catalog` item is appended after the last stored
context item, so a stored `prompt-imports` item can precede an instruction
bundle found on the retry. A `skill-activation` item first resolved on a retry
is inserted at its own rank, and can precede that stored `prompt-imports`
item. `prompt-imports` is stored once. An instruction load caused by
`enter_workspace`, `read`, `edit`, or `write` during a Run is stored on the
assistant message after that step's last tool result, and the next model step
reads it there.

Every item that carries text llame did not author says, in the item, that the
text ranks below the system instructions and below your request, and that it
cannot grant tools or relax authorization.

## Project context

A Run applies the Project that its Chat belongs to when it starts executing.
The worker reads the current owner Project before the first model request and
freezes that choice for the Run. The first dispatch stores the choice in a
versioned `run.project_bound` Run event. Later steps, segments, quota wakes,
recovery, and compaction reuse it, so edits, moves, unfiling, and deletion
affect later Runs only. A Run with no Project and no earlier Project context
emits nothing.

The `project` item sits after `tool-availability` and before `workspace`. A
bound item carries the Project ID, name, description, literal instructions, and
`projects://<id>` locator. It labels identity and description as data. It
labels instructions as owner guidance additive to personalization, with no
relative override. Both stay below the system instructions and the current
request. The item grants no tool, permission, or Workspace navigation, and it
does not need native `read`.

Told state is reconstructed, not stored in a column. Before emitting, the
producer compares its canonical rendering with its own latest text-bearing
`project` item in the active compaction epoch, including an in-Run item that
survives. Equal text emits no duplicate. A changed selection emits a snapshot
that retires all earlier Project guidance without naming a predecessor. A null
selection with durable earlier Project context emits an absence snapshot after
a checkpoint. A null never-filed Chat emits none. The compaction summary
excludes Project snapshots, and the first request after a checkpoint
re-establishes the frozen selection.

An explicit `projects://` read is separate. It returns current rows and needs
ordinary `read` admission and a Run identity. Automatic context never calls
that reader and does not depend on its eligibility. See
[projects://](locators/projects.md) and
[repositories](../operator/repositories.md#project-instructions).

A Project item is owner-only. Authored delimiters are neutralized before
persistence, and the item's text replays exactly as stored. The owner's context
display shows the exact persisted text, while the system-only prompt receipt
contains no Project context. Public shares, shared forks, exports, and search
omit Project items and selection-event payloads. Instructions and metadata are
shared with the configured provider. An edit or deletion does not erase earlier
messages, items, events, or provider copies. Do not store secrets in Project
instructions.

## The same marker, three importers

These shapes are recognized outside fenced code, inline code, and raw HTML.
The backtick form is an `@` before a code span.

| Shape                       | Example                               |
| --------------------------- | ------------------------------------- |
| `@path`                     | `@docs/style.md`                      |
| `@"…"` / `@'…'` / ``@`…` `` | `@"my notes/a b.md"`                  |
| `@[label](path)`            | `@[the guide](docs/guide.md)`         |
| `[label](path "import")`    | `[the guide](docs/guide.md "import")` |

What the marker does depends on the file that contains it. The grammar is
shared; resolution, admission, and the item that receives the bytes are not.
An email address such as `leo@example.com` is never a marker. An instruction
import does not apply a selector: `@foo.md:30-35` stays literal and loads
nothing, including when a file has that exact name.

| Written in                 | Resolves                                                                                  | Selectors                                                          | Injected as                                 |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| A project instruction file | a whole file in the same store: host path, or a relative path inside that Knowledge Space | not applied; a selector-bearing target stays literal               | a file block in the `instructions` item     |
| Your message               | any [`read`](tools/read.md) locator, including a range, `:raw`, or `:outline`             | honored; the body is what `read` returns                           | a file block in the `prompt-imports` item   |
| A skill's `SKILL.md`       | a file inside that package                                                                | selector-bearing, absolute, `~/`, and schemed targets stay literal | a file block in the `skill-activation` item |

A prompt import of a host or Knowledge file also loads that path's
[instruction chain](instruction-files.md#host-triggers) on the same turn.
Importing an instruction file itself does not. A skill import never loads an
instruction chain.

## Project instruction files

Put standing rules in `AGENTS.md`, or in `LLAME.md` when that directory should
prefer llame's own name. A local file such as `AGENTS.local.md` loads beside
the base file. Names, the walk from the filesystem root, the once-per-epoch
rule, and the 32 KiB cap are in [instruction files](instruction-files.md).

```text
/home/operator/AGENTS.md                         ancestor of a touch beneath it
/home/operator/projects/repo/AGENTS.md           repository
/home/operator/projects/repo/apps/api/LLAME.md   this directory's base file
/home/operator/projects/repo/apps/api/AGENTS.md  not selected; LLAME.md won the base chain
/home/operator/projects/repo/apps/api/AGENTS.local.md
```

A trigger whose walk includes `apps/api` loads one `instructions` item when any
file of that chain is not already in effective context. Blocks run from the
filesystem root down: `/home/operator/AGENTS.md`, then the repository
`AGENTS.md`, then `apps/api/LLAME.md`, then `apps/api/AGENTS.local.md`.
`apps/api/AGENTS.md` contributes nothing, because `LLAME.md` won that
directory's base chain. A deeper file takes precedence where two files
conflict. A marker `@docs/style.md` in the repository `AGENTS.md` resolves
from that file's directory and becomes a following block for
`/home/operator/projects/repo/docs/style.md`, with `imported-by` naming the
repository `AGENTS.md`.

A Knowledge Space uses the same names. The walk starts at the Space root, and
each file is named by its `kb://` locator. See
[Knowledge Space triggers](instruction-files.md#knowledge-space-triggers).

## Prompt markers

Write the marker in the message. The message is stored as typed. Before the
first model request, each admitted target is read and placed in one
`prompt-imports` item ahead of your text.

```text
Compare @README.md:30-35 with @"docs/style guide.md".
```

That imports lines 30-35 of the Workspace `README.md`, with the context lines
and ancestor headings `read` adds, and the whole style guide. Bounds, images,
denied targets, and the owner chip are in [prompt imports](prompt-imports.md).

## Skill files

`$review` activates that package. The `skill-activation` item carries the
current `SKILL.md` body with its frontmatter removed, then each package file a
marker in that body names. The catalog in the system prompt lists names and
descriptions only. Package form, invocation controls, and import bounds are in
[skill locators](locators/skill.md#behavior) and
[skills](../operator/skills.md).

## What you can check

The transcript shows a chip on the message that carries the item. An
instruction chip lists loaded paths, nests each loaded import under its
importer, and marks a truncated or denied file. A denied path is listed flat. A prompt-import chip lists each locator as
imported, truncated, denied, failed, or omitted. Other owners, public shares,
transcript exports, and search see neither the item text nor that metadata.

## Configured by

- [Native files](../operator/native-files.md) enables the host executor and the
  `read` entry that host instruction files and host prompt imports need.
- [Personal Knowledge](../operator/knowledge.md) configures the Knowledge root
  behind `kb://` instruction files and imports.
- [Skills](../operator/skills.md) installs packages and sets which of them the
  catalog advertises.
- [Tool prompt templates](../operator/tool-prompts.md) replaces the system
  prompt that carries personalization and the skill catalog.
- [Tool-call permissions](../operator/tool-call-permissions.md) sets the `read`
  rules that admit or deny a target.
