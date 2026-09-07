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
- Walker reusable by the `kb://` resolver (#702) through the same port shape.

**Non-Goals:**

- Hidden or ignore filtering, entry metadata, recency ordering, following
  symlinked directories, deeper trees, glob or grep. Each is a child of #701.
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
readable without letting a `node_modules` child dominate. Grandchildren are
counted for `… N more` only.

### D3: Directories first, `localeCompare` on name, no metadata

Name order matches how the owner sees the vault and is stable across calls.
`localeCompare` is OpenCode's comparator and OMP's tiebreak under its recency
sort; only the comparator is borrowed. Determinism is declared relative to the
host collation. mtime and size are excluded so unchanged directories
render identically and prompt caches survive.

### D4: Symbolic links are listed with `@` and never descended

Node dirents report `isSymbolicLink` for free. Following would need realpath
plus a visited set and would escape the requested subtree, which the Knowledge
walker forbids. The root target itself still resolves through `open()` as files
do today; the spec carries that as a scenario. A trailing separator is optional
on a directory path and fails as `not_found` on a file, which is what `lstat`
returns for `file/`. OpenCode stats the link and renders `name/`; we prefer the explicit
marker because it tells the model why nothing appears beneath it.

### D5: Bounds apply in a fixed order

1. Assemble: root unbounded, each child keeps 20 entries plus `… N more`.
2. Render lines.
3. If over the common cap, drop whole child blocks last-first and append an
   elided-block count. This is OMP's `applyLineCap` protected-depth rule made
   block-granular, so a child never looks like it has fewer entries than it
   does.
4. If the requested level alone still overflows, reuse the existing whole-line
   prefix truncation with `nextOffset` over entries.

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

### D7: Narrow `not_regular_file` instead of adding a type

Directories move from the error branch to a success branch; the remaining error
population is sockets, devices, and FIFOs. `edit` and `write` are untouched.

## Risks / Trade-offs

- [Coding checkout roots list thousands of entries] → requested level is
  unbounded by design; the common cap plus `nextOffset` paging keeps the result
  bounded and the model can page or read a child directly.
- [Collation differs between hosts] → determinism is specified per host; a
  future ordering selector, tracked under #701, can offer a locale-free order.
- [Verbatim listing exposes dotfiles and secrets by name] → names only, never
  contents; filtering is the tracked follow-up, and the alpha already grants
  full OS-user read authority.
- [Elision hides a child directory entirely] → the elided-line marker names the
  count, and a direct read of the child returns its full requested level.

## Migration Plan

Additive. Ship the reader change, tool description, and docs in one layer; no
data, config, or migration impact. Rollback is reverting the layer.

## Revision history

- **v2 (2026-09-07):** Round-1 review. Range selectors now a flat requested-level
  mode (resolved selector vs two-level contradiction); context expansion scoped
  to regular files via a second MODIFIED requirement; header never counted;
  symlinked root promoted to a spec scenario; elision is whole child blocks;
  optional trailing separator; task 1.6 retargeted to real tests; D3 wording.
- **v1 (2026-09-07):** Initial draft after the #704 grilling session.
