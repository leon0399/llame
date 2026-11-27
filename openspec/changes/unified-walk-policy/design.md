# Design: unified-walk-policy

## Context

Host tools run through the Machine daemon
([ADR](../../../docs/adr/2026-11-20-host-tools-run-through-the-machine-daemon.md)),
so every host and Machine `grep` walk and every host and Machine directory
read is served by the Rust daemon. `crates/machine-grep` walks the tree: it
prunes exactly `.git` (`src/lib.rs:670`), silently, and applies ignore files
through the `ignore` crate, with repository detection keyed on `.git`
(`collect_ignores`, `src/lib.rs:738-761`). `crates/machine-files` answers
`ListDirectory` (`src/read.rs:113`) with every entry of one directory and
applies no policy. The hub-side presentation
(`packages/native-file-tools/src/directory-listing.ts`) renders the listing and
asks the daemon for each child directory, so it reads a capped level below
`.git`, `.jj`, and `node_modules` on every read.

`kb://` file IO still runs in the API worker through the TypeScript half of
`@workspace/native-file-tools` and `apps/api/src/knowledge`.
[#1961](https://github.com/leon0399/llame/issues/1961) moves that IO to the
Machine daemon and deletes the in-process engine. This change does not touch
the in-process engine; `kb://` adopts the policy when #1961 routes it through
the daemon. See proposal.md for the measured cost on the owner's colocated jj
Space.

## Goals

- One policy module in the daemon that answers "does enumeration enter this
  entry" for its walk and its listing, so #1961 and the planned unified search
  tool bind to it instead of re-inventing a rule.
- The policy's ignore behavior stays the daemon walk's, so the move is an
  extraction with its tests, not a redesign.

## Non-Goals

- No change to the in-process TypeScript file engine, `knowledge_search`, or
  the `kb://` grep leg. #1961 deletes them.
- No new configuration surface, no change to link resolution on explicit
  paths, no Machine protocol change. See proposal.md Non-Goals.

## Decisions

### D1. The policy lives in `crates/machine-grep`

A `walk_policy` module in `crates/machine-grep` owns the fixed set, ignore-file
collection, and the ignore decision. The grep walk and `machine-files`'s
`list_directory` use it; `machine-files` already depends on `machine-grep`.
Alternative: `machine-core`. Rejected: it would add the `ignore` crate to the
crate every daemon service links, for two consumers that already share a
dependency edge. The `walk-policy` requirements are the contract; #1961 binds
the Knowledge walk to the same module.

### D2. The fixed set is five names, silent, matched by leaf name

`.git`, `.jj`, `.hg`, `.svn`, `node_modules`, at any depth, directory or file.
The walk's `.git` check widens to a set membership test. The set reports
nothing, keeping `.git`'s precedent, so `ignored` stays reserved for
ignore-rule exclusions. Alternatives: all dot-directories (sweeps `.obsidian`
and dot-named note folders); honoring `.gitignore` only (misses
infrastructure where no ignore file exists). Both were rejected in grilling.

### D3. Ignore semantics move verbatim

The three `grep-tool` ignore requirements move to `walk-policy` with their
scenarios. Repository detection stays keyed on `.git`, and it governs only a
`.gitignore` above the requested root, as the daemon implements it: both
ignore filenames are read inside the walked tree unconditionally. A
`.gitignore` inside the walked tree therefore applies with no repository at
all. A symlink or special file is never a policy source. A deeper layer
outranks a shallower one. Nothing changes in behavior; only the home moves.
Extending repository detection to `.jj` is a follow-up if a case appears.

### D4. Listings render by entry class, split across the daemon and the presentation

The daemon's `list_directory` collects ignore files from the registered root
down to the listed directory and omits each entry an ignore rule excludes,
unless the fixed set names it. The total counts only kept entries, so an
ignore-ruled entry neither renders nor counts. The listed directory itself is
never filtered: rules decide entries, never the directory the call names.

The fixed set renders an entry without children. The daemon cannot tell a
requested directory from a child read, because the presentation asks for each
child through the same `ListDirectory` call. So the presentation skips the
child read for a fixed-set name: the entry renders as `- .git/` with no block,
and `read repo/.git/` still lists it, because the requested directory is never
checked. Alternative: a protocol field marking fixed entries. Rejected: it
costs a protocol change to carry a five-name constant. The presentation check
also applies to `kb://` listings, which share the presentation; their ignore
omission arrives with #1961.

### D5. No protocol change, and the daemon updates with the release

The widened set and the listing filter only narrow results. A lagging daemon
keeps entering the extra names and listing ignore-ruled entries until the
operator updates it, which is harmless. No `PROTOCOL_VERSION` increment.
Contrast `name-selector-units` D7, where a lagging daemon would corrupt written
locators. The changeset entry tells operators to update every daemon with the
release.

### D6. The unified search tool is a constraint, not a consumer

The module ships with exactly what grep and listings need. Its shape, a pure
decision over entries plus ignore-file collection, is what makes it reusable.
No feature ships for the future tool.

## Risks / Trade-offs

- [`kb://` keeps its old rules until #1961 lands] → A `kb://` grep still
  prunes only `.git`, and `knowledge_search` still enters infrastructure trees
  and fails on a link. #1961 owns #1654 and #1655; the proposal records the
  handoff.
- [Owners who searched ignored trees lose those passages silently] → Explicit
  reads still work, and every exclusion is fixed or owner-authored. The
  changeset entry states the narrowing plainly.
- [Listing ignore evaluation adds reads per call] → At most two ignore files
  per ancestor up to the registered root, read once per `ListDirectory` call.
  The walk already pays this cost per call.
- [Moving three requirements between capabilities] → One change owns both
  sides of the move, and the strict validator checks the REMOVED names against
  the canonical spec.

## Migration Plan

No durable data, no API surface, no protocol change. Deploy is a normal
release; each Machine daemon narrows its walk and listing when it is updated.
Rollback is reverting the merged layers; no state requires repair.
