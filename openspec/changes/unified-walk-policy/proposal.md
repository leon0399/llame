## Why

Three tree walks share one job and disagree on it. `knowledge_search` descends
into `.git`, `.jj`, and vendored trees, so one colocated jj Space spends 85% of
its entry budget on infrastructure before a single record is read
([#1655](https://github.com/leon0399/llame/issues/1655)). The same walk throws
`knowledge_path_invalid` on the first symbolic link, so one `.claude/skills`
link disables search for every record in the Space
([#1654](https://github.com/leon0399/llame/issues/1654)). The `grep` engine
prunes `.git` on every scheme but nothing prunes `.jj`, so a `kb://` grep
discarded 3,812 binary or invalid entries on that Space. Directory listings
render `.git` and `.jj` with a capped level of their children on every read.
Each surface invents its own rule for the same question: what does a walk skip.

The fix is one policy, not three patches. A single walk policy also prepares
the planned unified search tool, which will accept scopes across the host,
Chats, and Knowledge Spaces and must not re-invent this rule.

## What Changes

- **One walk policy, three clauses.** A new `walk-policy` capability defines
  what enumeration skips: a fixed set of infrastructure directories, the ignore
  files of the walked tree, and explicit-addressing precedence. The fixed set
  is `.git`, `.jj`, `.hg`, `.svn`, and `node_modules`, skipped by leaf name at
  any depth. The skip is silent.
- **Ignore semantics move, unchanged.** The three ignore requirements of
  `grep-tool` move to `walk-policy` with their scenarios. The semantics stay
  as the engine implements them today: `.ignore` applies everywhere,
  `.gitignore` only inside a repository detected by `.git` above, files are
  bounded policy sources, a deeper layer outranks a shallower one, and no rule
  decides the requested root or anything above it.
- **Explicit addressing always wins.** A `read`, a `grep` scope, or a listing
  that names one exact path reaches it, even when the policy excludes it. The
  policy binds enumeration, never the path a caller names.
- **`grep` gains one policy on every scheme.** The hub engine's `.git` prune
  widens to the fixed set, and the Knowledge walk leg gains the ignore-file
  support the host leg already has. The Rust Machine daemon implements its own
  walk and already honors ignore files, so the engine layer widens the fixed
  set there too, in `crates/machine-grep`. No protocol change and no protocol
  version increment: the widened set only narrows a walk. An operator updates
  each daemon with the release.
- **`knowledge_search` adopts the policy.** The search walk skips fixed
  infrastructure directories, applies the ignore files of its Space, and skips
  a symbolic link instead of failing the Space. A link produces no warning. An
  ignore-file read is bounded and consumes no Markdown file or byte bound.
- **Directory listings adopt the policy.** A fixed infrastructure entry still
  renders, with no entries below it. An ignore-ruled entry does not render.
  The requested directory is never filtered. A `kb://` Space listing gains the
  same behavior through the shared listing.
- **Owner-authored ignore files become the Space exclusion mechanism.** An
  owner who writes `.agents/` into a `.ignore` at a Space root removes those
  vendored skill passages from search, grep, and listings. This closes the
  vendored-content question of #1655 without a new configuration surface. The
  matcher reads ignore text without knowing the git index, as host grep does
  today: a tracked tree stays tracked while walks skip it.

Corpus narrowing: files under the fixed set, and files an ignore rule
excludes, stop being searched and listed by enumeration. Explicit reads keep
working, and every exclusion is either fixed or owner-authored.

## Assumptions, confirmed with Leo

From the grilling rounds of 2026-11-22, recorded on
[#1655](https://github.com/leon0399/llame/issues/1655):

- The fixed set is the issue's five names. No `.bzr`, `_darcs`, or other
  speculative names.
- Ignore semantics are the grep engine's, replicated verbatim. Repository
  detection stays keyed on `.git` and governs only a `.gitignore` above the
  requested root; a `.gitignore` inside the walked tree always applies. A
  pure-jj Space applies its own root `.gitignore`. An ancestor `.gitignore`
  applies only inside a detected repository.
- The skip is silent. Grep's `ignored` report stays reserved for ignore-rule
  exclusions; the fixed set reports nothing, as `.git` does today.
- Listings render fixed-set entries without children; ignore-ruled entries
  disappear. Walks skip both.
- One OpenSpec change, layered delivery. The Machine leg needs no protocol
  work: its Rust daemon implements the walk natively, with ignore support
  today, and mirrors the widened fixed set in the engine layer.
- A symbolic link found by enumeration is skipped silently, folding #1654 into
  this change as the third policy clause.
- The planned unified search tool is a design constraint, not a consumer. The
  policy ships with only what its current consumers need.

Assumptions that follow but were not asked:

- An ignore file is a listed entry and counts against the entry bound, as any
  entry does. Its bounded read consumes no Markdown file or byte bound.
- The glossary gains the term "Walk policy" in the first implementation layer.
- A listing counts an ignore-ruled entry nowhere: it does not render and does
  not count in the requested level's entry count. A fixed-set entry counts and
  renders.

## Constraints against parallel changes

`name-selector-units` archived on 2026-11-23, before this proposal's rebase.
It rewrote the `knowledge-tools` corpus requirement in STE with the `L`
selector spelling. This change's knowledge-tools delta is written against that
archived revision and carries the spelling through, so the shared requirement
has no live conflict. The two changes touched disjoint requirements in
`grep-tool`, `native-file-tools`, and `tool-call-permissions`. The Rust
Machine daemon rewrite also archived (`2026-11-26-rust-machine-daemon`); this
change adapts to it, and its delta text does not conflict with the Machine
walk requirements that rewrite shipped.

## Capabilities

### New Capabilities

- `walk-policy`: one enumeration policy, consumed by `grep`, by
  `knowledge_search`, and by directory listings. Fixed infrastructure set,
  ignore-file semantics moved from `grep-tool`, and explicit-addressing
  precedence.

### Modified Capabilities

- `knowledge-tools`: MODIFIED `Knowledge search scans one or all current
  spaces deterministically within global bounds`. Search enumeration obeys the
  walk policy, a link entry is skipped without a warning, and ignore-file reads
  stay outside the content bounds.
- `grep-tool`: MODIFIED `Walk order and links are defined per scheme`. Every
  scheme's walk skips the fixed set and applies the walk policy's ignore
  rules; the Knowledge leg gains ignore support. REMOVED `Ignore files from
  the scope and above it apply`, `A gitignore above the scope applies only in
  its repository`, and `An ignore rule decides an entry by its own path`,
  moved to `walk-policy`.
- `native-file-tools`: MODIFIED `Directory reads return a deterministic
  bounded listing`. Listings apply the walk policy by entry class, keep
  fixed-set entries visible without children, and never filter the requested
  directory.
- `tool-call-permissions`: MODIFIED `Grep evaluates excluded directories
  against the read group`. The bypass exception covers only ignore-ruled
  directories; a fixed-set directory is evaluated nowhere and named nowhere.

## Impact

- `packages/native-file-tools`: the fixed set and the ignore machinery move
  from `src/grep/` to a shared walk-policy module; the engine's `.git` check
  widens; `directory-listing.ts` applies the policy per entry class.
- `apps/api/src/tools/grep-ports.ts`: the Knowledge walk port gains
  ignore-file readers through the Knowledge filesystem port.
- `apps/api/src/knowledge/knowledge-filesystem.ts`: `processSearchEntry` skips
  fixed-set names, applies ignore layers, and skips a link instead of
  throwing; bounded ignore-file reads join the search walk.
- `crates/machine-grep`: the Rust walk widens its fixed set to match the hub
  engine, verified by `apps/machine/tests/search.rs`.
- Docs: `docs/product/reference/tools/knowledge_search.md`, `grep.md`, and
  `read.md`; `docs/product/glossary.md` gains "Walk policy"; dated
  `CHANGELOG.md` entries in the shipping layers.
- Closes [#1654](https://github.com/leon0399/llame/issues/1654) and
  [#1655](https://github.com/leon0399/llame/issues/1655) in the Knowledge
  implementation layer.

## Non-Goals

- The unified search tool itself. The policy serves it; nothing of it ships
  here.
- Honoring ignore files when an explicit path is resolved. `read`, `edit`, and
  `write` never consulted them and keep that behavior.
- Any Machine daemon protocol change. The daemon walks and matches locally
  with ignore support today.
- Extending repository detection to `.jj`, and adding further fixed names.
  Both are follow-ups if a real case appears.
- An exclusion mechanism beyond ignore files. No new operator configuration
  surface.
- Changing link handling on the host, Machine, skill, or listing walks. They
  already report links and never enter them.

## Acceptance

- On a colocated jj Space, `knowledge_search` returns only passages from
  content trees, with `complete: true` and `warningCount: 0`, and the walk
  reads no `.git` or `.jj` entry.
- A Space holding `.claude/skills/<name>` links returns its records' passages;
  the links produce no error and no warning.
- A Space whose `.ignore` names `.agents/` returns no passage from that tree,
  and `read kb://<space>/` lists no entry from it.
- `grep scopes: ["kb://<space>"]` over a jj Space reports no binary or
  invalid-UTF-8 discard from `.jj`, and applies a Space's `.gitignore`.
- `read kb://<space>/.git/HEAD` still reads, and `read kb://<space>/.git/`
  still lists the directory.
- A host read of a repository root lists `- .git/` with no children beneath it,
  and lists no `dist/` that a `.gitignore` excludes.
