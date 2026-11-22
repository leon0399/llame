# Design: unified-walk-policy

## Context

Four surfaces enumerate trees with four different skip rules. The shared grep
engine (`packages/native-file-tools/src/grep/walk.ts:194`) prunes exactly
`.git`, on every scheme, silently. Its ignore machinery
(`src/grep/ignore-files.ts`, consumed through optional `GrepWalkPort` methods)
runs today only on the host and Machine legs: the Machine daemon wires it in
`apps/machine/src/grep-port.ts:83-91`, while the Knowledge leg
(`apps/api/src/tools/grep-ports.ts:259`) supplies no ignore reader. The
Knowledge search walk (`apps/api/src/knowledge/knowledge-filesystem.ts:319`)
prunes nothing and throws on the first symbolic link. The shared directory
listing (`packages/native-file-tools/src/directory-listing.ts`) filters
nothing and reads a capped level of every child directory. See proposal.md for
the measured cost on the owner's colocated jj Space.

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

### D1. The policy lives in `packages/native-file-tools`, beside its consumers

A `walk-policy` module in the shared package owns the fixed set, the ignore
evaluation, and the explicit-addressing rule. The grep engine, the shared
`listDirectory`, and the API's Knowledge walk import it. The daemon imports it
through the same package link. Alternative: a new package. Rejected: three of
four consumers already live in this package, and a new package adds a
workspace for one module.

### D2. The fixed set is five names, silent, matched by leaf name

`.git`, `.jj`, `.hg`, `.svn`, `node_modules`, at any depth, directory or file.
The engine's `.git` check widens to a set membership test. The set reports
nothing, keeping `.git`'s precedent, so `ignored` stays reserved for
ignore-rule exclusions. Alternatives: all dot-directories (sweeps `.obsidian`
and dot-named note folders); honoring `.gitignore` only (misses
infrastructure where no ignore file exists). Both were rejected in grilling.

### D3. Ignore semantics move verbatim

The three `grep-tool` ignore requirements move to `walk-policy` with their
scenarios. Repository detection stays keyed on `.git`. `.ignore` applies
everywhere. Files cap at 256 KiB. A symlink, FIFO, or oversized file is never a
policy source. A deeper layer outranks a shallower one. Nothing changes in
behavior; only the home moves. A pure-jj tree without `.git` gets `.ignore`
only; extending detection is a follow-up if such a Space appears.

### D4. The Knowledge legs read ignore files through the Knowledge port

`createKnowledgeWalkPort` gains `ignoreFiles` and `ignoreAncestors`, reading
through `KnowledgeFilesystemAdapter`'s open-and-read path, with the same
refusal rules as the host reader. The search walk uses the same reader. An
ignore file is a listed entry and counts against the entry bound. Its read
consumes no Markdown file or byte bound, mirroring the grep engine, whose
ignore reads never touch content budgets.

### D5. Listings render by entry class

Fixed-set entries render with no children: they stay addressable, so
`read repo/.git/` stays discoverable. Ignore-ruled entries do not render and
do not count, matching git expectations. The requested directory is never
filtered, matching the engine's rule that no layer decides the scope directory.
The child-directory read is skipped for a fixed-set child, which also removes
its per-child metadata cost.

### D6. The Knowledge search walk skips links

`processSearchEntry` returns `none` for a link, matching `walkEntry`'s
`kind: 'link'` tolerance, instead of throwing `knowledge_path_invalid`. The
space-scoped warning keeps its other conditions. Explicit `kb://` reads keep
refusing links, as the Knowledge resolution rules require. This closes #1654
inside the policy change rather than beside it.

### D7. The Machine leg needs no protocol work

The daemon executes `fs.grep` locally and runs the hub engine with full ignore
support today. The widened fixed set reaches a Machine when its daemon is
rebuilt, because both processes link the shared package. A lagging daemon keeps
entering `.jj` until rebuilt; that is a silent narrowing lag, not a wire skew,
so `PROTOCOL_VERSION` stays. Contrast `name-selector-units` D7, where a lagging
daemon would corrupt written locators.

### D8. The unified search tool is a constraint, not a consumer

The module ships with exactly what grep, listings, and Knowledge search need.
Its shape (a pure decision over entries plus a per-surface file reader) is
what makes it reusable. No feature ships for the future tool.

## Risks / Trade-offs

- [The corpus narrows silently for owners who searched ignored trees] →
  Explicit reads still work, and every exclusion is fixed or owner-authored.
  The changelog entry states the narrowing plainly.
- [A Space whose records all sit behind one link stops returning passages] →
  Same behavior as the host walk, which also never follows links. A warning
  type is an additive follow-up if the case appears.
- [Two active changes modify the `knowledge-tools` corpus requirement] →
  Whichever archives second reconciles the merged text; the finalize layer
  re-reads the shipped requirement before spec sync.
- [Moving three requirements between capabilities] → One change owns both
  sides of the move, and the strict validator checks the REMOVED names against
  the canonical spec.

## Migration Plan

No durable data, no API surface, no protocol change. Deploy is a normal
release. The Machine daemon narrows its walk on its next rebuild. Rollback is
reverting the merged layers; no state requires repair.
