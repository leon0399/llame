## Context

`read` resolves the target, stats it, and throws `not_regular_file` for any
non-file; the reader package has no directory code path. The Knowledge
filesystem already walks directories through an injected `opendir` port with
entry budgets and symlink rejection, but it is coupled to Space authorization.
Peer harnesses split two ways: OMP and OpenCode fold listings into `read`;
Gemini CLI and Zed ship a separate list tool; Codex, goose, DeepSeek, and Hermes
rely on shell `ls`. OMP's tree is recency-sorted with mtime and size per entry,
which is tuned for coding sessions and non-deterministic across calls. See
proposal.md for motivation and the delta spec for the contract.

## Goals / Non-Goals

**Goals:**

- One `path` string surface: no new tool declaration.
- Requested level always visible; children summarized; output deterministic.
- Walker reusable later by the `kb://` resolver (#702) through the same port
  shape; wiring `kb://` is a non-goal here.

**Non-Goals:**

- Recency and other ordering selectors (#711), per-entry metadata (#712),
  hidden or ignore filtering (#713), following symlinked directories (#714),
  deeper trees, glob or grep. The first four are tracked children of #701.
- Integrating the walker with `kb://` (#702).
- Any change to `edit`, `write`, the mutation fence, or tool admission.

## Decisions

### D1: Fold into `read` rather than add a `list` tool

A separate tool would need its own declaration, classification, and prompt
guidance, and would break the one-path-string contract that #701 exists to
protect. Selectors already give `read` a place for future listing options.

### D2: Depth 2, requested level unbounded, children capped at 20

The requested directory answers "what is here"; children answer "how is it
organised". A flat listing forces the model to walk, which it skips. OMP's 12
per directory is too small for a notes folder; 20 keeps one vault subfolder
readable without letting a `node_modules` child dominate. Entries below the
second level are counted for `… N more` only.

### D3: Directories first, `localeCompare` on name, no metadata

Name order matches how the owner sees the vault and is stable across calls.
`localeCompare` is OpenCode's comparator and OMP's tiebreak under its recency
sort; only the comparator is borrowed. Determinism is declared relative to the
host collation. mtime and size are excluded so unchanged directories
render identically and prompt caches survive; metadata is tracked in #712 and
ordering selectors in #711.

### D4: Symbolic links are listed with `@` and never descended

Node dirents report `isSymbolicLink` for free. Following would need realpath
plus a visited set and would escape the requested subtree, which the Knowledge
walker forbids; it is tracked in #714. The root target itself still resolves through `open()` as files
do today; the spec carries that as a scenario. A trailing separator is optional
on a directory path and fails as `not_found` on a file: `lstat` and `open`
return `ENOTDIR` for `file/`, which the reader currently maps to
`executor_unavailable`, so the implementation adds an `ENOTDIR` to `not_found`
branch beside the existing `ENOENT` one. OpenCode stats the link and renders `name/`; we prefer the explicit
marker because it tells the model why nothing appears beneath it.

### D5: Bounds apply in a fixed order

1. Assemble: root unbounded, each child keeps 20 entries plus `… N more`.
2. Render lines.
3. If over the common cap, replace whole child blocks last-first with one
   `… N entries` line each. This is OMP's `applyLineCap` protected-depth rule
   made block-granular, so a child never looks like it has fewer entries than
   it does, and an elided child is distinguishable from an empty one, which
   renders as a bare `- name/` line.
4. If the requested level plus its `… N entries` markers still overflows,
   reuse the existing whole-line prefix truncation over the requested-level
   entries, each marker travelling with its entry. Markers count toward size,
   never toward index positions, so `nextOffset` and `:N-M` always name real
   entries and no state falls between steps 3 and 4.

A range selector is a mode switch, not a slice of the tree: it returns the
header plus the selected requested-level entries and nothing beneath them,
even when the tree would fit. Paging a tree whose elision depends on total size
is not stable across pages; paging a flat entry list is. The header is printed
on every page and never counted, so `nextOffset` and `:N-M` index entries only.
`:raw` has no meaning for a listing and fails as a selector error rather than
silently rendering the same text. Context expansion stays a regular-file rule;
the delta narrows that requirement so the two do not collide.

### D6: Native package owns the walker behind an `opendir` port

The walker takes a `{ lstat, opendir }`-shaped port, the same seam the Knowledge
filesystem uses, so #702 can bind it under owner authorization without a second
implementation. The Knowledge walker is not refactored now. Recorded option
for issue #702: a scheme parser reads `kb://`, extracts the Space ID, verifies access, and
maps to this native call.

### D8: Bound traversal with a 10,000-entry budget per directory

Deterministic ordering needs every name of a level in memory before rendering,
so an output cap alone leaves I/O and memory unbounded for a model-facing tool.
Each directory read keeps at most 10,000 names and keeps counting past that.
The requested directory fails closed with `directory_too_large` because a
deterministic first page of an unsorted overflow does not exist; a child over
budget degrades to its elided `… N entries` form since the count is exact and
nothing else about it is. The Knowledge walker already applies the same idea
with `KNOWLEDGE_MAX_ENTRIES`; this value is per directory rather than per walk
because the listing is shallow.

### D7: Narrow `not_regular_file` instead of adding a type

Directories move from the error branch to a success branch; the remaining error
population is sockets, devices, and FIFOs. `edit` and `write` are untouched.

## Risks / Trade-offs

- [Coding checkout roots list thousands of entries] → requested level has no
  display cap by design; the common cap plus `nextOffset` paging keeps the
  result bounded and the model can page or read a child directly. Past 10,000
  entries the read fails closed (D8).
- [Collation differs between hosts] → determinism is specified per host; a
  future ordering selector, tracked under #701, can offer a locale-free order.
- [Verbatim listing exposes dotfiles and secrets by name] → names only, never
  contents; filtering is the tracked follow-up, and the alpha already grants
  full OS-user read authority.
- [Elision hides a child directory's entries] → the child keeps its own line
  plus an `… N entries` marker, so the model knows which child to read
  directly for its full requested level.

## Migration Plan

Additive. Ship the reader change, tool description, and docs in one layer; no
data, config, or migration impact. Rollback is reverting the layer.

## Revision history

- **v5 (2026-09-07):** CodeRabbit round. Traversal budget (D8, new error);
  special entries render `- name?`; markers never occupy index positions; depth
  wording aligned; finalize gains `git diff --check`.
- **v4 (2026-09-07):** Leo's Plannotator notes. Follow-up issues #711-#714
  named in Non-Goals, D3, D4; `kb://` integration stated as a non-goal.
- **v3 (2026-09-07):** Round-2 review. Elided child blocks render as
  `… N entries` so they differ from empty children; `ENOTDIR` mapping named.
- **v2 (2026-09-07):** Round-1 review. Range selectors now a flat requested-level
  mode (resolved selector vs two-level contradiction); context expansion scoped
  to regular files via a second MODIFIED requirement; header never counted;
  symlinked root promoted to a spec scenario; elision is whole child blocks;
  optional trailing separator; task 1.6 retargeted to real tests; D3 wording.
- **v1 (2026-09-07):** Initial draft after the #704 grilling session.
