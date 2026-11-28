## Why

Tree walks share one job and disagree on it. `knowledge_search` descends into
`.git`, `.jj`, and vendored trees, so one colocated jj Space spends 85% of its
entry budget on infrastructure before a single record is read
([#1655](https://github.com/leon0399/llame/issues/1655)). The Machine daemon's
`grep` walk prunes `.git` but nothing prunes `.jj`, `.hg`, `.svn`, or
`node_modules`. Directory listings render `.git` and `.jj` with a capped level
of their children on every read, and they show every ignore-ruled entry. Each
surface invents its own rule for the same question: what does a walk skip.

The fix is one policy, not one patch per surface. Host and Machine file IO
already runs in the Rust Machine daemon, and
[#1961](https://github.com/leon0399/llame/issues/1961) moves `kb://` IO there
too, deleting the in-process TypeScript engine. The policy therefore lives in
the daemon, where every surface converges, and it prepares the planned unified
search tool, which must not re-invent this rule.

## What Changes

- **One walk policy, three clauses.** A new `walk-policy` capability defines
  what the daemon's enumeration skips: a fixed set of infrastructure
  directories, the ignore files of the walked tree, and explicit-addressing
  precedence. The fixed set is `.git`, `.jj`, `.hg`, `.svn`, and
  `node_modules`, skipped by leaf name at any depth. The skip is silent.
- **Ignore semantics move, unchanged.** The three ignore requirements of
  `grep-tool` move to `walk-policy` with their scenarios. The semantics stay
  as the daemon implements them today: `.ignore` applies everywhere,
  `.gitignore` above the requested root only inside a repository detected by
  `.git`, a deeper layer outranks a shallower one, and no rule decides the
  requested root or anything above it.
- **Explicit addressing always wins.** A `read`, a `grep` scope, or a listing
  that names one exact path reaches it, even when the policy excludes it. The
  policy binds enumeration, never the path a caller names.
- **The daemon `grep` walk skips the fixed set.** `crates/machine-grep` widens
  its `.git` prune to the five names, through a shared `walk_policy` module.
  No protocol change and no protocol version increment: the widened set only
  narrows a walk. An operator updates each daemon with the release.
- **Directory listings adopt the policy.** The daemon's `ListDirectory` omits
  ignore-ruled entries. The shared listing presentation renders a fixed-set
  entry without reading below it. The requested directory is never filtered.
- **Owner-authored ignore files become the exclusion mechanism.** An owner who
  writes `.agents/` into a `.ignore` removes those vendored trees from host and
  Machine grep and listings, without a new configuration surface. The matcher
  reads ignore text without knowing the git index: a tracked tree stays
  tracked while walks skip it.

Corpus narrowing: files under the fixed set, and files an ignore rule
excludes, stop being searched and listed by the daemon's enumeration. Explicit
reads keep working, and every exclusion is either fixed or owner-authored.

## Assumptions, confirmed with Leo

From the grilling rounds of 2026-11-22, recorded on
[#1655](https://github.com/leon0399/llame/issues/1655):

- The fixed set is the issue's five names. No `.bzr`, `_darcs`, or other
  speculative names.
- Ignore semantics are the existing walk's, replicated verbatim. Repository
  detection stays keyed on `.git` and governs only a `.gitignore` above the
  requested root; a `.gitignore` inside the walked tree always applies.
- The skip is silent. Grep's `ignored` report stays reserved for ignore-rule
  exclusions; the fixed set reports nothing, as `.git` does today.
- Listings render fixed-set entries without children; ignore-ruled entries
  disappear. Walks skip both.
- The planned unified search tool is a design constraint, not a consumer.

From the 2026-11-28 scope revision:

- The policy is implemented only in the Rust Machine daemon. The in-process
  TypeScript file engine is not changed, because #1961 deletes it.
- `knowledge_search`, the `kb://` grep leg, and the link failure of
  [#1654](https://github.com/leon0399/llame/issues/1654) move to #1961, which
  closes #1654 and #1655 by routing `kb://` through this policy.
- The fixed-set child skip lives in the listing presentation, which #1961
  keeps; the ignore omission lives in the daemon. No protocol field.

Assumptions that follow but were not asked:

- The glossary gains the term "Walk policy" in the first implementation layer.
- A listing counts an ignore-ruled entry nowhere: it does not render and does
  not count in the requested level's entry count. A fixed-set entry counts and
  renders.
- The `kb://` listing gains the fixed-set child skip through the shared
  presentation; its ignore omission waits for #1961.

## Constraints against parallel changes

`name-selector-units` and the Rust Machine daemon rewrite archived before this
revision; this change touches none of their requirements. #1961 has no
OpenSpec change yet. When it proposes one, it binds the Knowledge walk to
`walk-policy` and owns the `knowledge-tools` corpus requirement, which this
change no longer modifies.

## Capabilities

### New Capabilities

- `walk-policy`: one enumeration policy for the Machine daemon, consumed by
  `grep` walks and directory listings. Fixed infrastructure set, ignore-file
  semantics moved from `grep-tool`, and explicit-addressing precedence.

### Modified Capabilities

- `grep-tool`: MODIFIED `Walk order and links are defined per scheme`. A host
  or Machine walk skips the fixed set and applies the walk policy's ignore
  rules; a Knowledge walk keeps its rules. MODIFIED `Excluded directories are
  reported` and `A reported directory locator is a valid scope`, so no
  fixed-set directory is reported. REMOVED `Ignore files from the scope and
  above it apply`, `A gitignore above the scope applies only in its
  repository`, and `An ignore rule decides an entry by its own path`, moved to
  `walk-policy`.
- `native-file-tools`: MODIFIED `Directory reads return a deterministic
  bounded listing`. Listings render fixed-set entries without children, omit
  ignore-ruled entries on the host and a Machine, and never filter the
  requested directory.
- `tool-call-permissions`: MODIFIED `Grep evaluates excluded directories
  against the read group`. The bypass exception covers only ignore-ruled
  directories; a fixed-set directory is evaluated nowhere and named nowhere.

## Impact

- `crates/machine-grep`: a `walk_policy` module holds the fixed set and the
  ignore machinery; the walk widens its prune, verified by
  `apps/machine/tests/search.rs`.
- `crates/machine-files`: `list_directory` omits ignore-ruled entries through
  `walk_policy`, verified by `apps/machine/tests/files.rs`.
- `packages/native-file-tools` (`walk-policy.ts`, `directory-listing.ts`) and
  `apps/api/src/machines/wire/files-read-directory.ts`: both listing
  presentations skip the child read for a fixed-set name. No TypeScript walk or
  Knowledge code changes.
- Docs: `docs/product/reference/tools/grep.md` and `read.md`;
  `docs/product/glossary.md` gains "Walk policy"; one
  `.changeset/unified-walk-policy.md` entry.
- Serves [#1655](https://github.com/leon0399/llame/issues/1655) without closing
  it; closes the cutovers [#1893](https://github.com/leon0399/llame/issues/1893)
  and [#1894](https://github.com/leon0399/llame/issues/1894).

## Non-Goals

- Any change to `knowledge_search`, the `kb://` grep leg, or the in-process
  TypeScript file engine. #1961 replaces them.
- The unified search tool itself.
- Honoring ignore files when an explicit path is resolved. `read`, `edit`, and
  `write` never consulted them and keep that behavior.
- Any Machine daemon protocol change.
- Extending repository detection to `.jj`, and adding further fixed names.
- An exclusion mechanism beyond ignore files.
- Changing link handling on any walk or listing.

## Acceptance

- `grep` over a host or Machine directory that holds `.jj`, `.hg`, `.svn`, or
  `node_modules` returns no passage from them and reports none in `ignored`.
- A host read of a repository root lists `- .git/` and `- node_modules/` with
  no children beneath them, and lists no `dist/` that a `.gitignore` excludes.
- `read /home/u/repo/.git/` still lists that directory, and a grep scope of
  `/home/u/repo/node_modules/react` still searches it.
