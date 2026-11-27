# Design: unified-walk-policy

## Context

Three surfaces enumerate trees with disagreeing skip rules. The hub's shared
grep engine (`packages/native-file-tools/src/grep/walk.ts:194`) prunes exactly
`.git`, on every scheme it walks, silently. Its ignore machinery
(`src/grep/ignore-files.ts`, consumed through optional `GrepWalkPort` methods)
runs today only on the host leg: the Knowledge leg
(`apps/api/src/tools/grep-ports.ts:42`) supplies no ignore reader. The Machine
leg is served since the Rust daemon rewrite by `crates/machine-grep`, which
implements its own walk: a `.git` prune (`src/lib.rs:670`) and ignore files
through the `ignore` crate, with repository detection keyed on `.git`
(`collect_ignores`, `src/lib.rs:738-761`). The Knowledge search walk
(`apps/api/src/knowledge/knowledge-filesystem.ts:319`) prunes nothing and
throws on the first symbolic link. The shared directory listing
(`packages/native-file-tools/src/directory-listing.ts`) filters nothing and
reads a capped level of every child directory. See proposal.md for the
measured cost on the owner's colocated jj Space.

## Goals

- One policy module that answers "does enumeration enter this entry" for every
  surface, so the planned unified search tool binds to it instead of
  re-inventing a rule.
- The policy's behavior stays the grep engine's, so the move is an extraction
  with moved tests, not a redesign.

## Non-Goals

- No new configuration surface. No per-Space exclusion feature beyond ignore
  files. No change to link resolution on explicit paths. No Machine protocol
  work. See proposal.md Non-Goals.

## Decisions

### D1. The policy lives in `packages/native-file-tools`, mirrored in the Rust daemon

A `walk-policy` module in the shared package owns the fixed set, the ignore
evaluation, and the explicit-addressing rule. The hub's grep engine, the
shared `listDirectory`, and the API's Knowledge walk import it. The Rust
Machine daemon cannot link that package, so `crates/machine-grep` mirrors the
same policy natively; the `walk-policy` requirements are the shared contract
both implementations satisfy. Alternative: a new package. Rejected: two of
three hub-side consumers already live in this package, and a new package adds
a workspace for one module.

### D2. The fixed set is five names, silent, matched by leaf name

`.git`, `.jj`, `.hg`, `.svn`, `node_modules`, at any depth, directory or file.
The engine's `.git` check widens to a set membership test. The set reports
nothing, keeping `.git`'s precedent, so `ignored` stays reserved for
ignore-rule exclusions. Alternatives: all dot-directories (sweeps `.obsidian`
and dot-named note folders); honoring `.gitignore` only (misses
infrastructure where no ignore file exists). Both were rejected in grilling.

### D3. Ignore semantics move verbatim

The three `grep-tool` ignore requirements move to `walk-policy` with their
scenarios. Repository detection stays keyed on `.git`, and it governs only a
`.gitignore` above the requested root, as the engine implements it: both ignore
filenames are read inside the walked tree unconditionally, on every port. A
`.gitignore` inside the walked tree therefore applies with no repository at
all, so a pure-jj Space applies its own root `.gitignore`. Files cap at
256 KiB. A symlink, FIFO, or oversized file is never a policy source. A deeper
layer outranks a shallower one. Nothing changes in behavior; only the home
moves. Extending repository detection to `.jj` is a follow-up if a Space with
an ancestor `.gitignore` above it appears.

### D4. The Knowledge legs read ignore files through the Knowledge port

`createKnowledgeWalkPort` gains `ignoreFiles` and `ignoreAncestors`, reading
through `KnowledgeFilesystemAdapter`'s open-and-read path, with the same
refusal rules as the host reader. The search walk uses the same reader. An
ignore file is a listed entry and counts against the entry bound. Its read
consumes no Markdown file or byte bound, mirroring the grep engine, whose
ignore reads never touch content budgets.

### D5. Listings render by entry class, and the fixed set decides first

Fixed-set entries render with no children: they stay addressable, so
`read repo/.git/` stays discoverable. Ignore-ruled entries do not render and
do not count, matching git expectations. The fixed set is evaluated before
ignore rules, matching the engine's code order, so an entry both fixed and
ignore-ruled — `node_modules` under most `.gitignore` files — renders as a
fixed entry and is never reported as ignored. The requested directory is never
filtered, matching the engine's rule that no layer decides the scope directory.
The child-directory read is skipped for a fixed-set child, which also removes
its per-child metadata cost.

### D6. The Knowledge search walk skips links

`processSearchEntry` returns `none` for a link, matching `walkEntry`'s
`kind: 'link'` tolerance, instead of throwing `knowledge_path_invalid`. The
space-scoped warning keeps its other conditions. Explicit `kb://` reads keep
refusing links, as the Knowledge resolution rules require. This closes #1654
inside the policy change rather than beside it.

### D7. The Machine leg mirrors the policy in Rust, with no protocol change

The Rust daemon executes `fs.grep` locally and already implements the `.git`
prune and ignore files. The engine layer widens the fixed set twice: once in
the hub engine, once in `crates/machine-grep` (`src/lib.rs:670`), with the
`apps/machine/tests/search.rs` suite pinning the Rust side. Two
implementations can drift, so the `walk-policy` requirements are the one
contract both must satisfy, and each side carries its own regression tests for
the same scenarios. No `PROTOCOL_VERSION` increment: the widened set only
narrows a walk, and a lagging daemon keeps entering the extra names until the
operator updates it, which is harmless. Contrast `name-selector-units` D7,
where a lagging daemon would corrupt written locators. The changelog entry
tells operators to update every daemon with the release.

### D8. The unified search tool is a constraint, not a consumer

The module ships with exactly what grep, listings, and Knowledge search need.
Its shape (a pure decision over entries plus a per-surface file reader) is
what makes it reusable. No feature ships for the future tool.

## Risks / Trade-offs

- [Two implementations of one policy can drift] → The `walk-policy`
  requirements are the shared contract; each side carries regression tests for
  the same scenarios, and the finalize layer re-checks both before archive.
- [Owners who searched ignored trees lose those passages silently] →
  Explicit reads still work, and every exclusion is fixed or owner-authored.
  The changelog entry states the narrowing plainly.
- [A Space whose records all sit behind one link stops returning passages] →
  Same behavior as the host walk, which also never follows links. A warning
  type is an additive follow-up if the case appears.
- [A shared requirement with an archived sibling] → `name-selector-units`
  archived on 2026-11-23; this change is rebased onto its revision, and the
  knowledge-tools delta carries its `L` selector spelling, so the conflict is
  resolved at proposal time rather than left to the finalize layer.
- [Moving three requirements between capabilities] → One change owns both
  sides of the move, and the strict validator checks the REMOVED names against
  the canonical spec.

## Migration Plan

No durable data, no API surface, no protocol change. Deploy is a normal
release. The Machine daemon narrows its walk on its next rebuild. Rollback is
reverting the merged layers; no state requires repair.
