## Why

Instruction files and skills cannot share text today. A repository that wants one
style guide in `AGENTS.md`, `apps/api/AGENTS.md`, and a skill copies it three times,
because [#975](https://github.com/leon0399/llame/issues/975) shipped instruction files
without imports and recorded them as [#1029](https://github.com/leon0399/llame/issues/1029).
Claude Code, Gemini CLI, and oh-my-pi all expand `@path` in instruction files, so files
written for those harnesses lose their imported text in llame.

The owner's prompt has the opposite gap. An owner who writes "compare `@apps/api/AGENTS.md`
with the issue" gets a model that must spend a step reading what the owner already pointed
at, and the owner cannot point at a line range, an outline, a Knowledge file, or a URL with
the precision `read` already supports. Every reference harness with prompt references
(Claude Code, Gemini CLI, oh-my-pi, OpenCode) expands them once at submit and keeps the
owner's text as typed. That half is tracked as
[#1142](https://github.com/leon0399/llame/issues/1142).

Both halves share one marker grammar and one authority (`read` admission), so they ship as
one change with separate implementation layers.

## What Changes

- **Import marker grammar** (new `import-markers`). Three shapes are recognized in Markdown
  text outside fenced code and inline code: `@target`, `@[label](target)`, and
  `[label](target "import")`. A bare `@target` starts at the start of a line or block, after
  whitespace, or after one of `(`, `[`, `{`, `<`, `"`, and `'`, and runs to the next
  whitespace, with trailing sentence punctuation removed. A marker is never removed or
  rewritten: the text that carries it is stored, rendered, and replayed exactly as written, and the
  imported content is injected beside it.
- **Instruction-file imports** (`instruction-files`, closes #1029). A marker in a loaded
  instruction file names a file in the same store: a host instruction file imports host
  files, resolved against the importing file's directory, with absolute paths allowed;
  `~/` targets stay literal; a Knowledge instruction file imports files of its own Space.
  Web, `skill://`, and cross-store targets stay literal. Each loaded import is a separate
  `<file>` block in the same `instructions` item, placed directly after its importer, depth-first in marker order,
  recording which file imported it. Imports recurse to 5 hops, skip cycles and files already
  in the seen set, and leave admitted missing targets literal. Each import gets the existing 32 KiB
  per-file cap and truncation line. An import inherits its importer's scope and precedence.
  Each import is a system-origin `read` with origin `instructions`, admitted by the `read`
  group on both its resolved path and, when different, its canonical path. A loaded import
  is also a trigger for its own directory's instruction chain, sharing the realpath seen
  set, so `AGENTS.md` importing `@foo/doc.md` loads `foo/AGENTS.md` once, and neither
  `foo/doc.md` importing `@AGENTS.md` nor a direct `@foo/AGENTS.md` injects it twice.
- **Skill imports** (`context-injection`, `agent-skills`). An explicit `$skill` activation
  expands markers in the activated `SKILL.md` body against its package directory, as
  `skill://<name>/<relative path>` reads with exactly the admission a proactive read of
  that locator gets, within the activation's existing output and work bounds.
  Package-escaping and non-package targets stay literal. Skill imports do not trigger
  instruction chains, as `skill://` reads do not today.
- **Prompt imports** (new `prompt-imports`, closes #1142). The same three shapes in an
  owner's prompt accept every native `read` locator with its selectors: absolute host
  paths, `file:` aliases, Workspace-relative paths when a Workspace is bound, `kb://`,
  `skill://`, and `http(s)://`. `@FILE:30-35` imports what `read` returns for that range,
  context lines and Markdown ancestor headings included;
  `@https://github.com/leon0399/llame/issues/1029:outline` imports the outline. After the
  attempt's Workspace binding re-check and explicit skill activation, and before the Run's
  first model request, each distinct marker is read once through the native `read` tool
  with system origin `prompt-import`, admitted by the `read` group under the Run's
  permission mode, and the results persist as one `prompt-imports` item on the triggering
  user message; retries and recovery reuse completed results. The `read` group silently
  pre-evaluates each host or Knowledge target before probing; a denied target is audited and
  reported as not imported without probing, whether or not it exists, while only admitted
  targets are probed and an admitted missing target remains prose with no audit. A denied or failed
  read is reported to the owner and named to the model as not imported. Imported files are
  data: their own markers are not followed. A host or Knowledge prompt import that was
  admitted triggers that directory's instruction chain on the same accepted turn, with or
  without a Workspace binding. A detaching attempt performs no prompt imports.
- **Owner disclosure.** The instructions chip marks imported files and their importer; a new
  chip on the user message lists imported, truncated, denied, failed, and omitted prompt
  imports. Non-owners, shares, exports, and search projections see none of it.

Nothing here is **BREAKING**: no configuration key, API field, or stored shape is removed,
and text without markers behaves exactly as before.

## Assumptions, confirmed with Leo

Decided in design review on 2026-10-08 (recorded on
[#1029](https://github.com/leon0399/llame/issues/1029#issuecomment-6059418697) and #1142):
three shapes rather than one; relative instruction imports resolve against the importing
file; same-store targets only for instruction files; symlinks and targets outside the
Workspace allowed under `read` admission of both paths; import-loaded files are chain
triggers sharing one seen set; separate blocks, depth-first after the importer, inheriting
its scope; 5 hops and per-file caps only, with an aggregate cap deferred to
[#1144](https://github.com/leon0399/llame/issues/1144); prompt imports expanded once per
accepted turn into a separate rail item, markers kept literal, admitted missing host or Knowledge targets stay as
prose, no recursion from prompt imports; `@skill://name` is a data read and `$skill` remains
activation; a paste-time confirmation is [#1143](https://github.com/leon0399/llame/issues/1143).

The following follow from those decisions but were not asked separately, and are open for
review: prompt imports reuse the explicit-activation bounds (8 targets, 128 KiB aggregate
output, 30 seconds) as a separate budget, and at most 64 distinct markers per message are
probed at all; the canonical-path admission applies to instruction imports only, recorded as a
derived `canonical` decision on the import's first page read, while prompt and skill imports
keep exact parity with a `read` of the same locator; `~/` in a host instruction
import stays literal, so no server-resolved home path reaches labels or metadata;
the `prompt-imports` item precedes the user text in the same message, as every attached
rail item does; the delivery stack has seven implementation layers rather than the four
first sketched, because #975 measured 4,600 authored lines against a 1,700-line estimate
and round-1 review found the turn-load and admission work larger than first estimated.

## Capabilities

### New Capabilities

- `import-markers`: the three marker shapes, where they are recognized, the bare-marker
  boundary and token rules, distinct-target order, and the rule that marker text is never
  rewritten.
- `prompt-imports`: recognition in the owner's prompt, locator resolution against the
  bound Workspace, silent read-group pre-evaluation before probing and admission,
  system-origin `prompt-import` reads and audit, bounds, the persisted item and its
  recovery, instruction-chain triggering, and owner disclosure.

### Modified Capabilities

- `instruction-files`: _A host-path trigger loads the chain from the filesystem
  root down to the touched directory_ (loaded instruction imports and admitted
  host-path prompt imports are additional triggers); _A Knowledge locator loads
  the chain within its Space_ (admitted Knowledge prompt imports load its Space
  chain on the accepted turn); _Entry, native file tools, and accepted turns are
  the only triggers_ (loaded instruction imports and admitted local or Knowledge
  prompt imports become triggers); _A file is loaded once per compaction epoch,
  derived from effective history_ (imports share the seen set); _Each candidate is
  read with system origin under the read permission group_ (imports are read the
  same way, with canonical-path admission); _A bundle is one persisted-literal
  notice with bounded file bodies_ (import blocks, order, importer, inherited
  scope); _Owners see which files were loaded, truncated, or denied_ (imports are
  marked with their importers). Added requirements: _Instruction bodies expand
  import markers_; _Instruction import targets are admitted before probing_;
  _Instruction imports are bounded and cycle-safe_. Chain selection is unchanged;
  the walks gain the two import trigger kinds (loaded instruction imports and
  admitted host or Knowledge prompt imports), and the Knowledge walk gains the
  accepted-turn exception for prompt imports.
- `context-injection`: _Co-occurring items have a total author-time order_ adds
  `prompt-imports` after `skill-activation`; _Explicit activations are rail items carrying
  current instructions_ carries imported package files after the instruction body;
  _Workspace binding changes are rail-resident context items_ orders prompt imports after
  the binding re-check and skips them on a detaching attempt.
- `agent-skills`: _Explicit activation work is bounded before model preparation_ counts
  imported package files against the existing output and work bounds.
- `tool-call-permissions`: the canonical-path evaluation of an instruction import becomes a
  named exception to submitted-argument matching, bypassed and recorded like the other
  named evaluations.
- `workspace-entry`: prompt imports wait for the per-attempt binding re-check, and a
  detaching attempt performs none.

`native-file-tools` is unchanged: prompt imports call `read` exactly as the model does.

## Impact

- `apps/api/src/instructions`: import expansion in the bundle collector, a canonical
  admission port recorded as a derived decision on the import's first page read,
  import-triggered chain loads; `apps/api/src/chats/instructions-item.ts`: `importedBy` in
  the payload and template wording; `apps/api/src/prompts/instructions.md`.
- `apps/api/src/skills/skill-activation.ts`, `apps/api/src/chats/skill-activation-item.ts`:
  package-local imports in the activation item.
- New marker parser module in `apps/api`, built on `mdast-util-from-markdown` promoted from
  a `packages/native-file-tools` development dependency to an `apps/api` runtime dependency.
- New `prompt-imports` producer, item, and template; `apps/api/src/runs/tool-activity-origin.ts`
  gains origin `prompt-import`; `apps/api/src/chats/context-item.ts` producer order;
  accepted-turn preparation in `apps/api/src/runs/run-execution.service.ts`, including a
  derived-decision sink on the system read path and an accepted-turn instruction load that
  works without a Workspace binding and with a Knowledge world
  (`apps/api/src/runs/in-run-context-items.ts`).
- `apps/web`: the instructions chip shows importers; a new prompt-imports chip; the history
  payload validator.
- Tests pinning current behavior: the instruction-files reference doc's "Imports are not
  supported" statement; producer-order tests in `context-item`; instructions payload and
  chip validation tests.
- Docs: `docs/product/reference/instruction-files.md`, `docs/product/reference/tools/read.md`,
  a new `docs/product/reference/prompt-imports.md`, `docs/product/reference/index.md`,
  `docs/product/operator/skills.md`, `docs/product/reference/locators/skill.md`,
  `docs/product/reference/permission-modes.md`, `docs/product/operator/tool-call-permissions.md`, `SPEC.md`'s
  context-rail lines, `CHANGELOG.md`.
- No schema change, no migration, no OpenAPI change: tool-event origins live in JSONB
  payloads, and context-item payloads are already open `data-context` parts.

## Non-Goals

- A confirmation step when pasted text contains markers ([#1143](https://github.com/leon0399/llame/issues/1143)).
- Prompt-injection hardening beyond the existing envelope, neutralization, and precedence
  statements; `read` admission is the only authority.
- An aggregate byte cap across instruction files and imports ([#1144](https://github.com/leon0399/llame/issues/1144)).
- Composer autocomplete for markers.
- Selectors in instruction or skill imports: those name whole files.
- Following markers inside a prompt-imported file; skill activation from a prompt marker.
- Re-reading a prompt import on retry, regenerate, or after an edit on disk.

## Acceptance

- In a Workspace bound to `/repo`, `/repo/AGENTS.md` containing `@foo/doc.md` produces one
  `instructions` item carrying `/repo/AGENTS.md`, then `/repo/foo/doc.md` marked as imported
  by it, then `/repo/foo/AGENTS.md`; `foo/doc.md` containing `@AGENTS.md` adds nothing more.
- An import chain six hops deep loads five imports and leaves the sixth marker literal; a
  cycle loads each file once; a missing target leaves its marker literal with no audit event.
- A `read` reject matching an import's canonical path denies it even when its resolved path
  is allowed, audited with origin `instructions` and shown to the owner as denied.
- An activated `SKILL.md` containing `@references/checklist.md` carries the checklist after
  the instruction body in the same activation item.
- The prompt `compare @README.md:30-35 and @https://github.com/leon0399/llame/issues/1029:outline`
  in a bound Workspace persists one `prompt-imports` item before the first model request
  with the same content two model `read` calls would return, keeps the user text unchanged,
  and audits two reads with origin `prompt-import`.
- `ping @leo` and `` `@README.md` `` import nothing and record no audit event.
- A retry after a failed attempt reuses the persisted prompt imports without reading again.
