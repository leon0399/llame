## Context

See proposal.md for motivation. Inspected at `eced7f35`.

- **Instruction loading** is a stateless producer. `loadBundle` resolves trigger groups and
  calls `loadGroup` per world, which walks `walkOrder(group)` broadest-first and passes each
  selected candidate to `collectCandidate`
  (`apps/api/src/instructions/instructions-producer.ts:396-441`). `collectCandidate` skips
  seen and self-disclosed candidates, calls the paged reader, records denials, and pushes the
  loaded file (`:405-438` region). The paged reader `readInstructionFile` issues
  `:raw:<from>-<to>` reads through the attempt's `readPage` with origin `instructions` and
  enforces the 32 KiB cut (`apps/api/src/instructions/instruction-files.ts:179-269`).
  Payload files are `{ path, canonicalPath, truncated }` plus bundle-level `denied`
  (`apps/api/src/chats/instructions-item.ts:53-94`); `instructionsSeenPaths` rebuilds seen
  keys from effective history (`:162-181`). Accepted-turn loading is `loadTurnInstructions`
  (`apps/api/src/runs/run-execution.service.ts:2358-2448`, called at `:3503`).
- **Explicit skill activation** is the precedent for a pre-request, user-triggered,
  system-origin read. `activateMentionedSkills` parses `partsToText` of the stored, already
  neutralized user parts (`run-execution.service.ts:2219-2289`), reads
  `skill://<name>:raw` through `nativeReadTool`, persists items on the user message before
  context assembly, and recovers completed results through `ActivationPartsRepository`
  (`apps/api/src/chats/activation-parts.repository.ts:35-133`). Its bounds are 8 selections,
  128 KiB aggregate output, and 30 s of work (`apps/api/src/skills/skill-activation.ts:42-48`).
  Its `$skill` scanner is hand-written and skips fences, inline code, and escapes
  (`apps/api/src/skills/skill-mention.ts:55-258`).
- **System origins** are a TypeScript union `'skill-activation' | 'instructions'` validated by
  `isSystemOriginPayload` (`apps/api/src/runs/tool-activity-origin.ts:21-38`) and stored in the
  JSONB `run_events.payload`; there is no database enum.
- **Producer order** is the tuple `CONTEXT_ITEM_PRODUCERS`
  (`apps/api/src/chats/context-item.ts:48-65`).
- **Native `read`** already implements every locator and selector a prompt import needs,
  including context lines on bounded ranges, Markdown ancestor headings, outline
  representation, and web admission of every derived request
  (`openspec/specs/native-file-tools/spec.md`, selector and web requirements). It evaluates
  the submitted host path only; it records `realPath` for a symlinked file but does not
  evaluate the `read` group against it.
- **Markdown parsing**: `mdast-util-from-markdown@2.0.2` is a development dependency of
  `packages/native-file-tools`, used only by a conformance test. `apps/api` has no Markdown
  parser.

### Prior art

| Harness              | Instruction imports                                                                             | Prompt references                                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code 2.1.291  | `@path`, 4 hops (docs), no byte cap, approval for external imports                              | separate `attachment` record replayed as `Called the Read tool with the following input: {file_path}` plus the Read result; 2,000-line cut with a note; directories as a synthetic `ls`; mentioned files load their `CLAUDE.md` (`nested_memory`) |
| Gemini CLI `44d764e` | `@path`, 5 hops, project-root confinement, no byte cap                                          | expanded client-side into the outgoing user parts; history keeps the literal text                                                                                                                                                                 |
| oh-my-pi `111e305`   | `@path`, 5 hops, inline at marker, cycles cut, missing left literal (`discovery/at-imports.ts`) | separate `fileMention` message of `<file path>` blocks; exact existing paths only, everything else is prose (`utils/file-mentions.ts`); no permission check                                                                                       |
| OpenCode             | none                                                                                            | synthetic `Called the Read tool…` text saved at prompt admission                                                                                                                                                                                  |
| Codex CLI            | none (open request #17401)                                                                      | file picker only                                                                                                                                                                                                                                  |

No harness uses a Markdown-link import shape, and none caps the bytes of an import tree.

## Goals / Non-Goals

**Goals:** one parser for both surfaces; every read the feature performs goes through the
existing `read` tool and its admission; no new storage shape, migration, or API field.

**Non-Goals:** see proposal.md. Additionally, the hand-written `$skill` scanner is not
migrated to the new parser.

## Decisions

### D1: Parse markers with `mdast-util-from-markdown`

The marker module parses text into a CommonMark tree once and uses it for two things only:
link markers and excluded ranges. `[label](target "import")` is a `link` whose `title` is
exactly `import`; `@[label](target)` is a `link` whose source is immediately preceded by an
`@` that sits at a marker boundary in the source. The source ranges of `code`, `inlineCode`,
`html`, `link`, `image`, `imageReference`, `linkReference`, and `definition` nodes are
excluded from the bare scan, so `![x](@a.md)`, `[@a.md][r]`, and `[r]: @a.md` are not markers.

Bare `@target` markers are scanned over the raw source outside the excluded ranges, with
the boundary and token rules from the `import-markers` spec applied to source characters.
Scanning parsed `text` values does not work: round-1 review ran the parser and found that
CommonMark emphasis splits `@pkg/__init__.py` into `@pkg/` + strong(`init`) + `.py`, and
that `\@notes.md` and `&#64;notes.md` both decode to the text `@notes.md`. On the raw source,
the target runs to the next whitespace whatever emphasis the parser sees, and an escaped or
entity `@` is not an `@` character, so neither is a marker. Each marker yields its target
string and source offsets; the source text is never modified.

Promote `mdast-util-from-markdown@2.0.2` to an `apps/api` runtime dependency. It is already
vetted in the workspace, has no native code, and gives CommonMark-exact link destinations,
titles, angle-bracket destinations with spaces, and code-span boundaries.

Rejected: extending the `$skill` scanner. It already needs about 200 lines for code-span and
fence detection; adding CommonMark link destinations, titles, and escapes by hand is how
Codex and OpenCode accumulated mid-word and edge-case parsing bugs. Rejected: a regex over
raw text, which cannot tell a code span from a marker reliably.

### D2: Expand instruction imports inside the bundle collector, depth-first

After `collectCandidate` loads a body, it parses the body's markers and, in marker order,
resolves each target in the importer's store:

- host importer: `~/` against the native executor's home directory, absolute as written,
  otherwise against the importer's directory with POSIX lexical resolution; any target
  carrying a URL scheme, `kb://`, or `skill://` stays literal;
- Knowledge importer: relative targets inside the importer's own Space, as a logical
  `kb://<space>/<path>` locator; absolute, `~/`, `..` escaping the Space, and schemed
  targets stay literal.

Each resolved target is probed exactly as a chain candidate is (no decision, no audit).
A missing target, a directory, a non-regular file, a target whose canonical key is already
in the attempt's seen keys, or a target at hop 6 is skipped and its marker stays literal.
Otherwise the target is admitted (D3), read with the existing paged reader, and pushed to the
collector after its importer and after everything loaded through the importer's earlier
markers, with `importedBy` set to the importer's selected path. The seen key is added before
anything else happens, so cycles terminate.

An import is then a host or Knowledge trigger for its own directory (D4): that chain is
walked next, and only after it are the import's own markers expanded at hop + 1. The
emitted order is therefore: importer, its first import, the chain files that import's
directory newly loads, that import's own imports, the next import, and so on; the original
walk then resumes its broad-to-specific order and skips everything already seen.

Walking the chain before the import's own markers decides which role a shared file plays.
When `foo/doc.md` imports `@AGENTS.md`, `foo/AGENTS.md` has already loaded as the chain file
of `foo/` with its own directory scope, so the marker finds it seen and stays literal. When
`AGENTS.md` imports `@foo/AGENTS.md` directly, the author asked for it in the root file, so
it loads as an import with the root's scope, and the later `foo/` trigger finds it seen.

`importedBy` is recorded in the payload (non-rendering metadata) and rendered in the block
header attribute `imported-by="…"`, so the model can see why the file is present. The
template's scope sentence gains one clause: an imported file applies wherever its importer
applies. Hop counting restarts at zero for chain files loaded by an import trigger, because
they are chain files, not imports; termination is guaranteed by the seen set.

Rejected: inline expansion at the marker (Claude, Gemini, oh-my-pi). It duplicates text when
two files import the same file, and it would need a second seen-key type for partial bodies.

### D3: Canonical-path admission for instruction imports only

When the probe's canonical path differs from the resolved path, the import's first page
read carries one extra evaluation: the `read` group against the canonical path, recorded as
a derived `canonical` decision on that call, the decision kind `enter_workspace` already
records. A rejection denies that call (requested and completed, no started) and therefore
the import. The page reads use the resolved path, so the ordinary submitted-path evaluation
still runs. `bypass` admits both and records both, as for every other named evaluation.
`tool-call-permissions` names this as an exception to submitted-argument matching.

The collector holds only a page reader today, so the attempt and turn contexts gain an
`admitCanonical` capability that attaches the derived decision to the next page call. The
decision follows the ordinary derived-decision rule: it is recorded beside the call decision
in the completion payload when the call settles. In-Run pages already settle through the
model-call path that carries derived decisions (`run-execution.service.ts:1218-1282`); the
accepted-turn page reader and `recordSystemReadCompletion` (`:2537-2553`) carry none today,
so the `import-admission` layer adds a per-call derived-decision sink to the system read
path, which the `prompt-imports` layer then reuses for web hops.

Until that layer lands, `instruction-imports` fails closed: an import whose probed canonical
path differs from its resolved path is skipped as denied, so no layer ever injects a
symlinked target without the canonical evaluation.

Prompt imports and skill imports skip this evaluation and keep exact parity with a `read`
of the same locator. For skill imports this also keeps `agent-skills`' rule that skill
reads neither resolve nor contain symbolic links. Chain candidates keep their current
behavior.

### D4: Import-loaded files and prompt imports are chain triggers

A loaded instruction import becomes a pending trigger with the same semantics as a native
`read` of that path, resolved within the same bundle (D2 ordering). A prompt import whose
target is a host path or a `kb://` locator, and whose read was admitted, becomes an
accepted-turn trigger passed to `loadTurnInstructions` together with the existing root
trigger. Its read outcome after admission does not matter, as for a model read. A denied
read, a missing local target (never read), and `skill://` or web targets do not trigger.

Prompt-import triggers do not need a Workspace binding; they are gated like in-Run
triggers (a native executor for a host path, a Knowledge root for `kb://`). Today
`refreshTurnInstructions` returns early without a root or a page reader, and the turn
context has no Knowledge world (`run-execution.service.ts:2420-2436`,
`in-run-context-items.ts:183-196`); the `prompt-import-triggers` layer makes the root
optional, adds the Knowledge world, and keeps the root load conditional on a binding.

The trigger set is derived from the persisted `prompt-imports` item payload, which records
for each attempted target whether it was admitted and its resolved absolute host path or
canonical `kb://` locator. A retry therefore stages the same instruction load without
re-projecting relative locators against a binding that may have changed. A prompt import
of an instruction file does not by itself load or mark that file seen; another trigger on
the same turn, such as the root load, still selects it.

### D5: Skill imports expand in the activation item

After `skillInstructionBody` strips frontmatter, markers in the body resolve against the
package directory and are read as `skill://<name>/<relative path>:raw` through the same
activation read path and admission as a proactive read of that locator, with origin
`skill-activation`. Absolute, `~/`, schemed, and package-escaping targets stay literal.
Imported bodies render as `<file path="skill://…">` blocks after the instruction body in
the same activation item, depth-first, 5 hops, cycles and repeats within one activation
skipped. They count against the activation's 128 KiB output and 30 s work bounds but not
its selection count; an import that would exceed a bound is omitted and named in the
item's existing bounded notice. Skill imports never trigger instruction chains.

### D6: Prompt imports run after the binding re-check and explicit activation

`run-execution.service.ts` gains a `resolvePromptImports` step immediately after
`activateMentionedSkills` (`:881`), which already runs after the attempt's Workspace
binding re-check, with the same inputs: the stored user text from `partsToText`, the system
read context, the Workspace root cell, the effective permission mode, and the native
delivery sequence. A detaching attempt skips the step. `prepareWorkspace` returns no
detaching signal today (`:2121-2173`), and the persisted detach reason outlives the attempt,
so `WorkspacePreparation` gains a `detaching` flag set only on the detach branch. A
`prompt-imports` item persisted by an earlier attempt still replays as stored text on a
detaching retry, but that attempt stages none of its instruction triggers, consistent with
the detaching attempt staging no accepted-turn `instructions` item. For the
first 64 distinct marker targets in first-occurrence order (later markers stay prose and
are not probed):

1. Local and Knowledge targets are resolved like a model `read` argument (Workspace
   projection for relative paths; relative targets on an unbound Chat are prose) and probed
   without a decision or audit, using `read`'s own literal-path-first selector split, so a
   file literally named `x.md:10-12` is probed as itself. A missing target, or a host target
   on a process with no native executor, is prose: no read, no event, no notice.
2. The target, selectors included, is read once through `nativeReadTool` with origin
   `prompt-import` and call id `prompt-import-<runId>-<attemptId>-<n>`, admitted by the
   `read` group under the Run's permission mode. Web targets go through the web admission of
   every derived request; the system read path gains a derived-decision sink so those
   decisions are recorded in the completion audit, as they are for model-origin reads
   (`run-execution.service.ts:1417-1418` sets the sink for model calls only today).
3. Results persist as one `prompt-imports` item on the triggering user message before context
   assembly, through a repository mirroring `ActivationPartsRepository`: completed results
   replay on recovery, and unfinished targets, including one whose read started but did not
   complete, get a fresh admission and read.

The item renders one `<file path="…">` block per imported target carrying `read`'s
model-facing output verbatim, after reserved-delimiter neutralization, plus one line per
denied or failed target naming its locator as not imported, and the precedence statement
for third-party content. Payload fields: `imports: [{ locator, resolved, admitted,
truncated }]`, `denied`, `failed`, `omitted`; private permission metadata mirrors
activation's.

Placement: rail items attached to a user turn precede the user text in the same message
(`context-injection`, _Server-authored context is injected as discrete items on one rail_),
so the item sits before the owner's text, after `skill-activation` in producer order.

### D7: Bounds mirror explicit activation, as a separate budget

At most 64 distinct markers are probed. Of the targets that survive the probe, or have no
probe (`skill://`, web), at most 8 are read; the item's serialized output is capped at
128 KiB; total work, probes included, is capped at 30 s and by the Run deadline. Targets
beyond the 8-target, output, or work bound are listed once as omitted, not read, but only
when they survived the probe or need none; a host or Knowledge target still unprobed when
the work bound fires is dropped silently, because it may be prose, and prose tokens that
fail the probe are never listed. Each individual result keeps `read`'s own
truncation.

Rejected: no bounds, as in every reference harness. A pasted log with hundreds of `@`
tokens would issue hundreds of probes and reads before the first request; llame already
chose these bounds for the same shape of work.

### D8: `prompt-import` is a new system origin

Add `'prompt-import'` to `ToolActivityOrigin`. System-origin activity is already excluded
from assistant tool parts, live translation, and recovery settlement by the shared
validator, so the new origin inherits that exclusion. No migration: origins live in JSONB.

### D9: Owner chips

The instructions chip renders an imported file indented under its importer. A new
`PromptImportsPart` on the user message lists imported, truncated, denied, failed, and
omitted locators from private metadata. Both are owner-only through the existing history
access path; shares, exports, and search projections already exclude `data-context`
payloads.

## Risks / Trade-offs

- [The D4 cascade loads more instruction text per step than before, with no aggregate cap]
  → per-file caps hold; the seen set bounds the total to each file once per epoch;
  #1144 tracks an aggregate cap.
- [`~/` depends on a home directory] → the collector expands it with the worker's home
  directory before probing, because the native executor runs in-process with the worker and
  `read` itself does not expand `~`; a Knowledge importer never accepts `~/`.
- [An `@token` that happens to name an existing file in the Workspace imports it]
  → the owner sees the chip; the read is admitted like any model read; #1143 adds paste
  confirmation. A code span keeps a token literal.
- [Prompt imports of web targets fetch on every accepted turn that carries them] → each
  turn reads once and persists; retries reuse the result; web bounds apply per request.
- [mdast parses CommonMark, not GitHub Flavored Markdown] → it is used only for link
  markers and excluded ranges (D1); bare markers are scanned on source characters, so
  emphasis and entity decoding cannot split or invent a target. Tests pin `__init__.py`,
  `__tests__`, escaped `\@`, entity `&#64;`, code-span, fence, and link cases.
- [A canonical-path reject is stricter for imports than for a model read of the same file]
  → intended (D3); documented in the reference page.

## Migration Plan

No data migration. Rollback is a revert: existing `instructions` items without `importedBy`
and user messages without `prompt-imports` items render as before, and stored items with the
new fields still replay from their stored text. One consequence is visible: the API's exact
payload validator (`instructions-item.ts:86-94`) rejects a bundle whose files carry
`importedBy`, so after a revert every file in such a bundle drops out of the seen set and
reloads on its next trigger within the same epoch, a one-time duplicate injection.

## Open Questions

None that change the specs or task breakdown. The proposal lists five assumptions that
follow from confirmed decisions but were not asked separately; approval of the proposal
revision confirms them.
