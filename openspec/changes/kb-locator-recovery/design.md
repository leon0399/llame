## Context

See proposal.md — Why. Decisions were settled with the owner in the design
session that produced #736 and #737; this document records them and the
evidence.

Parsing today: `parseKnowledgeLocator`
(`apps/api/src/knowledge/knowledge-locator.ts:35-66`) splits on the first
`/`, then on the first `:` after it, and passes the path through verbatim.
Nothing anywhere calls `decodeURIComponent`. `validatePath`
(`knowledge-filesystem-validation.ts:51-79`) rejects absolute, empty, `.`,
`..`, backslash, and control-character components on the split segments.
`isLocatorAddressablePath` (`:87`) is `!relativePath.includes(':')` and is
consulted once, at `knowledge-filesystem.ts:276`, to skip a file from search.
`passageLocator` (`knowledge-tools.ts:474`) emits raw paths.

Misses today: a `kb://` read resolves with `allowMissing=false`
(`apps/api/src/tools/native-files.ts:76`); the adapter lstats every component
and throws `knowledge_not_found`, which `mapResolutionFailure` renders as the
same `File not found.` the native reader would, before `readResolvedFile`
runs. An absolute-path miss surfaces as `ENOENT` in `readFailure`
(`packages/native-file-tools/src/read.ts:151-167`). `isInsideSpace`
(`knowledge-filesystem.ts:332-349`) already handles a missing path by walking
up to the nearest existing ancestor and checking its `realpath`.

Prior art, verified on fresh clones on 2026-09-07/08 (cites unpinned; see the
issues):

- oh-my-pi decodes on parse for 9 of its 13 internal schemes, builds the raw
  pathname with a regex over the original input so a literal space survives,
  and instructs the model only about `:`, `?`, `#`
  (`internal-urls/parse.ts`, `prompts/tools/read.md`). The archived
  `kb-locator` design D6 misread this as "OMP requires percent-encoding for
  `ssh://`"; it decodes, and it accepts both spellings.
- openclaw splits before decoding so `%2F` cannot cross a boundary
  (`agent-tools.read.ts`).
- gemini-cli ships the `%25` cost undocumented across `read_file`,
  `write_file`, and `edit` (`utils/paths.ts`).
- hermes `_suggest_similar_files` lists the directory on `ENOENT`, scores
  (same stem 90, prefix 70, substring 60, ratio ≥ 0.8 → 50), returns five, and
  advertises it in the tool description. gemini-cli BFS-searches by basename
  across workspace roots, capped at 50 directories. oh-my-pi probes a
  five-variant ladder silently. deepseek-harness and llame return a flat
  error.
- No harness instructs a model about spaces.

A representative vault (232 entries): 123 names with spaces, 15 with
parentheses, 11 with `@`, 9 with `+`, 5 with `&`, none with `:`, `%`, `#`, or
`?`.

## Goals / Non-Goals

Goals:

- Both spellings of a path resolve, so the model's URI instinct stops costing
  a round trip.
- Every regular file in a Space is addressable and searchable, including one
  with `:` in its name.
- A miss carries the names that would have hit, on both schemes, from one
  implementation.

Non-goals:

- A slug alias for Space UUIDs (#332). Any change to the selector grammar.
- A silent probe ladder that resolves a wrong path without telling the model
  (oh-my-pi's shape). The model is told what exists; it chooses.
- Suggestions on `edit` or `write`. A mutation that misses must miss.
- Recursive or cross-directory search for the name (gemini-cli's shape). One
  `opendir` on the parent, on the error path only.

## Decisions

### D1: Decode on parse, after splitting

The raw locator is split on `/` and on the first `:` after the identifier,
exactly as today; then each path segment is `decodeURIComponent`-ed. Because
the split precedes decoding, `%2F` decodes into a segment that contains `/`
and is refused, and `%3A` decodes into a segment that contains `:` and is
accepted: the selector colon was already consumed on the raw string. A
`URIError` from a malformed sequence maps to `invalid_path`. The existing
`validatePath` then runs on the decoded segments, so `%2E%2E` is `..` and is
refused there; one added check refuses a decoded segment containing `/`.

Alternatives: instruct the model to always encode (rejected: no peer does;
123 of 232 vault names would carry `%20`); instruct it never to encode
(rejected: the URI shape invites encoding and the seven-miss transcript shows
the instruction loses); accept literal only and add `:` as an escape
(rejected: still leaves `%`-containing names ambiguous and invents a grammar).

### D2: Emission encodes only what the grammar needs

`passageLocator` encodes a segment only when it contains `:`, `?`, `#`, or
`%`, replacing exactly those characters. The `:` is the one this parser needs;
`?` and `#` are the two a URI-minded model may strip as query or fragment;
`%` must be encoded once encoding exists at all, or a name containing `%20`
on disk becomes ambiguous. Everything else stays literal so the common case
reads as a path. `isLocatorAddressablePath` is deleted along with its call.

A `kb://` listing renders entry names, not locators, so nothing there
encodes; the header stays the locator as given.

### D3: One sentence for the model, in two places

The `read` description gains: "In a `kb://` path, write a literal `:`, `?`,
`#`, or `%` as `%3A`, `%3F`, `%23`, or `%25`; spaces and other characters may
be literal or encoded." `chat-default.md` gains the same rule in its
Knowledge sentence. This mirrors oh-my-pi's three-character instruction plus
the `%` cost gemini-cli leaves undocumented.

### D4: Suggestions live in the native package, on the `ENOENT` path

`readFailure` in `packages/native-file-tools/src/read.ts` is the one place
both schemes reach a miss once D5 lands. On `ENOENT` for a file target it
opens the parent once, reads names under the existing traversal budget,
scores each against the requested basename, and appends up to five names to
the `not_found` message: `File not found. Similar names in the same
directory: a, b, c.` If the parent itself is missing, the message says so and
lists nothing. Names only; the message is composed once here, because a bare
name carries no path and therefore nothing a `kb://` result must hide.
(#737 proposed per-caller composition for that reason; with names only it
buys nothing, so it is dropped.)

Scoring, simplest that separates the cases: case-insensitive; same stem with
a different extension, then prefix, then substring, then a bigram Dice
coefficient of at least 0.5; ties by name. No dependency; no `difflib`
port. A miss with nothing above the threshold returns the bare error, per the
issue.

The tool description says suggestions may appear, following hermes.

### D5: A `kb://` read tolerates a missing leaf

`executeKnowledge` passes `allowMissing: true` for reads as well as writes.
`resolveKnowledgeHostPath` already walks every existing component with the
symlink refusal and joins the remainder unchecked below the first missing
one; `assertInsideSpace` then proves the nearest existing ancestor is inside
the Space by `realpath`; only then does the native reader open the path and
raise `ENOENT`. The parent directory the suggestion reads is therefore
either that proven ancestor or a directory beneath it that also failed to
exist, in which case D4 reports the parent missing and reads nothing.

Space-level failures are unchanged and precede all of this: an absent,
removed, or other-owner identifier returns `knowledge_space_not_found` before
any path is resolved, so no suggestion can act as an existence oracle across
owners. Inside the owner's own Space the names listed are the owner's own.

### D6: Errors

Malformed encoding and a decoded `/` are `invalid_path` with the existing
message. A literal `:` in a raw path stays `invalid_path` when its suffix is
not a selector, as shipped, so the "colon rejected" scenario keeps its name
and gains the `%3A` answer.

## Threats

- `%2F` or `%2E%2E` used to leave the Space → split precedes decoding and
  validation follows it; a decoded segment containing `/` is refused; `..`
  is refused by the existing rule; a negative test covers both spellings.
- Suggestions used to enumerate another owner's Space → Space resolution
  fails closed before any path work; suggestions exist only after
  containment of the parent is proven by `realpath`.
- Suggestions revealing a resolved host path → names only, composed in the
  package from `Dirent.name`; an assertion in the `kb://` test checks the
  message against the configured root.
- A huge parent directory on the error path → one `opendir` bounded by the
  existing `DIRECTORY_TRAVERSAL_BUDGET`; over budget, no suggestions.
- Decoding applied to an absolute path by mistake → decoding lives in
  `parseKnowledgeLocator` only; absolute paths are untouched.

## Migration Plan

1. `encoding` layer: D1, D2, D3, D6. `suggestions` layer: D4, D5. `finalize`.
2. No database change. Persisted locators from before this change are literal
   and still parse.
3. The `read` description changes, so the deploy follows the declaration
   cutover (quiesce, drain, deploy API and worker together, resume). Rollback
   is the reverse; a locator emitted with `%3A` by the new search is refused
   by the old parser, which is the pre-change behavior for that file.

## Risks / Trade-offs

- [A filename containing a literal `%` needs `%25`] → documented in the
  description; no such file in the sample vault; the alternative, no
  decoding, costs a round trip on every space.
- [A literal `%20` on disk is now unreachable by its literal spelling] →
  reachable as `%2520`; same trade every decoding parser makes.
- [Suggestions add a directory read to every miss] → error path only, one
  `opendir`, budget-bounded; a successful read is untouched.
- [`allowMissing` on reads widens what a read attempts] → it attempts one
  `lstat`/open on a path whose ancestor is proven inside the Space; the
  write path has run this way since `kb-locator`.
- [This change and #738 both edit `native-file-tools/spec.md`] → different
  requirement blocks; whichever lands second rebases and re-diffs.

## Open Questions

None.
