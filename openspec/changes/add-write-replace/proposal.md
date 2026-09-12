## Why

The native `write` tool is create-only, so a model that legitimately needs to
regenerate an existing file's full contents must either spend an `edit` whose
`oldText` is the entire current file (context-expensive and brittle the moment
its copy drifts) or reach for allowlisted `bash`. Worse, a write aimed at a
hallucinated or moved path silently creates a new file instead of surfacing the
mistake. The tool needs one explicit replace path with a two-sided intent
guard: clobbering an existing file must be opt-in, and asserting a file exists
must fail when it does not.

## What Changes

- `write` gains a boolean `replace` argument. Absent or `false` keeps today's
  create-only behavior byte-for-byte; `replace: true` selects replace mode.
- Replace mode requires an existing regular-file target and swaps its entire
  contents atomically, preserving the target's permission bits. The four
  flag-by-existence outcomes are:

  | Target | `replace`    | Result                                      |
  | ------ | ------------ | ------------------------------------------- |
  | absent | absent/false | file created                                |
  | exists | absent/false | `file_exists`, bytes untouched              |
  | exists | `true`       | contents replaced, result marked `replaced` |
  | absent | `true`       | `not_found`, nothing created                |

- Replace resolves targets exactly as `edit` does: an absolute path resolves
  through symbolic links to the real entry; a `kb://` locator requires an
  existing regular-file leaf and never creates intermediate directories.
- Replace rides the existing durable pre-effect fence unchanged: the attempt
  is recorded before any byte changes, an open attempt recovers as
  `outcome_unknown`, and a settled result replays without re-execution.
- The `file_exists` message names `replace` as the explicit overwrite path, and
  the replace-mode `not_found` message states that omitting the flag creates a
  new file. The tool description describes both modes.
- Classification stays `write_low_risk`; no new filesystem authority is
  granted (`edit` with whole-file `oldText` already reaches full replacement).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `native-file-tools`: the write requirement changes from create-only to
  create-or-explicitly-replace, with the flag's two-sided precondition table,
  atomic mode-preserving publication, `edit`-consistent target resolution on
  both schemes, and result/error wording for all four outcomes.

## Impact

Contained and additive. Code: `packages/native-file-tools` (one mutation mode
beside `createFile`, reusing the existing atomic publish path), and
`apps/api/src/tools/native-files.ts` (schema, dispatch, and `kb://` leaf
resolution). Tests at the package, tool-integration, and fence-acceptance
seams. Docs: `docs/native-files.md`, the root `AGENTS.md` capability line, and
a `CHANGELOG.md` entry. No database, tenancy, client, or UI change (no surface
consumes the write result's `created` marker today). Not breaking: existing
callers that omit the flag behave identically.

Delivery needs a tracking issue (`feat(native-files): explicit replace mode
for write`) created before the stack is published; the implementation layer
owns its closure.
