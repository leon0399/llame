# Proposal

Issues: [#1397](https://github.com/leon0399/llame/issues/1397), partly
[#1392](https://github.com/leon0399/llame/issues/1392).

## Why

`grep` stops before it finishes ordinary searches. On 2026-11-01 a
case-insensitive `senseshift` search over `/mnt/d/Projects` (WSL drvfs) hit
the 30 s deadline after 682 files and returned four hits from an Arduino
build cache. A no-match search over this repository (4,020 files, 42.1 MiB)
hit the 32 MiB byte bound after 2,944 files in 9.0 s; `rg` finishes the same
search in 0.87 s. The fixed bounds are not the main cost. The walk opens,
reads, and closes one file at a time, so a high-latency mount spends the call
waiting on I/O. In the drvfs run, reads took 27.0 s of 31.8 s, and replaying
the same 1,342 reads 16 at a time took 1.5 s instead of 22.5 s.

None of the five peer harnesses inspected bounds files examined, entries
listed, or bytes read. They bound results and time only (design: Prior art).

## What Changes

- **BREAKING** (operator-visible): the walk has no file-count, entry-count,
  aggregate-byte, or per-file-size bound by default. An operator can set any
  of them under a new `tools.grep` object. The previous 5,000 / 20,000 /
  32 MiB / 1 MiB defaults are gone.
- The walk reads up to 8 files at the same time and still returns passages,
  warnings, and the cursor in canonical order.
- Files are searched as a stream with no size cutoff. A line longer than
  4 MiB of UTF-8 bytes skips its file as `oversized`. A file that is not
  valid UTF-8 at any point still contributes no passage.
- The call deadline derives from the tool call timeout
  (`tools.callTimeoutSeconds`, default 120 s) minus a margin, so a slow walk
  returns its passages and a cursor instead of the runner's empty `timeout`
  error. The fixed 30 s deadline is removed.
- A file that blocks a whole call is reported by locator and the cursor moves
  past it, so a resumed search always makes progress through a file.
- Ignore files: `.ignore` is honored beside `.gitignore`. Ignore files in
  directories above the scope apply (`.gitignore` up to the repository
  directory, `.ignore` up to the filesystem root). The scope directory itself
  is always searched. Each rule decides an entry by the entry's own path, as
  in Git, which fixes the #1392 layer-voiding defect.
- The result reports excluded directories: a count and the first five
  locators that the `read` group admits, spelled as scopes, so a model can
  scope one of them explicitly. Host scopes decode seven literal spellings
  (`%25`, `%2A`, `%3F`, `%5B`, `%5D`, `%7B`, `%7D`) in one pass, and the
  permission check sees the decoded path, so a directory such as `app/[id]`
  is searchable and a spelling cannot slip past a reject. Machine scopes keep
  the full `machine://` decoding on both sides.
- **BREAKING** (Machine protocol): `fs.grep` changes in place. The request
  field `budget` becomes `bounds`, with `null` for an unset bound and a
  `progressed` flag. The response gains the excluded-directory and
  unfinished-file fields. A daemon built before this change refuses the new
  request; no compatibility path exists.

## Assumptions, confirmed with Leo

Grilling record of 2026-11-01:

- Q1 B, refined: no cumulative scan bound by default; bounds are opt-in
  operator settings. Memory and allocation bounds stay.
- Q2 B: stream text files with no per-file size cutoff.
- Q3: whole-result preservation is out of scope. The 20-passage-per-file cap,
  the 512-unit line cut, the 15,000-unit page, and the cursor stay as they
  are. [#915](https://github.com/leon0399/llame/issues/915) (snapshots) owns
  them.
- Q4 A: the deadline derives from the call timeout.
- Q5 A: `tools.grep` holds `maxFilesExamined`, `maxEntriesListed`,
  `maxBytesRead`, and `maxFileBytes`; unset means unbounded.
- Q6 A: 8 concurrent reads, fixed in code.
- Q7 A: honor `.ignore`. An explicit scope searches an ignored directory; no
  flag overrides ignore rules.
- Q9 A: apply ignore files above the scope, but never to the scope directory.
- Q10 C: report the count plus up to 5 excluded directories.
- Q11 A: only the literal scope prefix counts as explicit.
- Q12 A: a deterministic concurrency test plus recorded before/after timings.
- Q13 A: 64 MiB per line, accepted on a 512 MiB worst case.
- Q14 A: skip and name a file one call cannot finish.
- Q15: no Machine compatibility path; `fs.grep` changes as if new.
- Q16 A: fold the #1392 ignore-layer defect into this change.
- Q17 A: host scopes decode only the seven literal spellings; `machine://`
  scopes keep the full locator decoding on both the probe and admission
  side.
- Q18 A: the excluded-directory report spells `%` and the six glob
  characters as `%XX`, decoded in one pass, so every reported locator
  works as a scope.
- A1–A4 confirmed: margin is 10% of the timeout with a 5 s floor; concurrency
  covers listing and ignore lookups; `.ignore` outranks `.gitignore` in one
  directory; one directory is still listed whole.

Assumptions that follow from those answers but were not asked separately:

- Ignore files stay a host and Machine walk feature. `kb://` and `skill://`
  walks read no ignore file today, and this change adds none.
- A Machine walk applies ignore files above the scope only inside the
  registered root that holds the prefix.
- The unfinished-file rule covers a byte bound reached inside a file as well
  as the deadline, because a streamed file can cross either bound mid-scan.
  It applies only when the whole call, across every scope and Machine
  request, took no entry after its start point.
- An excluded directory is named only when the `read` group admits its
  locator, both as written and with a final separator. The engine keeps at
  most 1,000 excluded directories per call.
- The margin never exceeds half the call timeout. Without a timeout in the
  call context, grep uses `tools.callTimeoutSeconds`.
- A Machine request gets nine tenths of the time left, so its answer arrives
  before the API stops waiting.
- A rule decides an entry only by the entry's own path, never through a
  directory above it, as Git does. The walk never enters an excluded
  directory, so ancestors need no test.
- Progress means an emitted passage or a finished entry after the start
  point. Progress is call-wide: it travels between scopes and to and from a
  Machine. A file one call cannot finish is skipped only without progress.
- An unfinished single-file scope moves the cursor to the next scope with
  `complete: false`; a call past the last scope returns an empty complete
  page.
- A daemon that refuses `fs.grep` parameters reports as Machine unusable,
  not as the model's `invalid_input`.
- The excluded-directory evaluations follow the `grep` per-file exception of
  `tool-call-permissions`: not recorded one by one, not in the refused-file
  count, none in a `bypass` attempt.

## Deviations from the grilling record

Leo confirmed these on 2026-11-01 ("the numbers are reasonable"):

- **Q5 mechanism.** Q5 A sent an unset bound to a Machine as
  `Number.MAX_SAFE_INTEGER` only to avoid a protocol change. Q15 removed that
  reason, so an unset bound travels as `null`.
- **A5 stack.** A5 confirmed three implementation layers. Review round 1
  estimated the first above the 2,000-line budget, so streaming and
  read-ahead are separate layers: four implementation layers.
- **Q13 line bound: 64 MiB → 4 MiB.** Q13 accepted 64 MiB per line on a
  512 MiB memory figure, by analogy with OMP, whose regex engine is native.
  `re2js` runs on the event loop and cannot be interrupted inside one line
  test. Measured on a 64 MiB line with no match: `(?i)senseshift` took 0.6 s
  on random text and 3.6 s on other text, and an 8-term case-insensitive
  alternation took 17 s; up to 8 patterns are tested per line. The real memory
  worst case was also 0.9–1.4 GiB, not 512 MiB. At 4 MiB a test costs about
  0.04–1.1 s per pattern and 8 tasks hold about 128 MiB of line text. Today's
  1 MiB file bound already caps a line at 1 MiB, so 4 MiB is still four times
  today. Keeping 64 MiB needs a process-wide large-line slot and accepts
  multi-second event-loop stalls (design D3, Rejected).
- **Thread pool.** Node runs file reads on a libuv pool of 4 threads by
  default, so 8 reads would run 4 at a time. The API, worker, and daemon set
  `UV_THREADPOOL_SIZE=16` when it is unset (design D2). This was not asked;
  it is the precondition for Q6.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `grep-tool`:
  - MODIFIED "Walks are bounded": skip rules stay, with the line bound added;
    the fixed numeric bounds and the 30 s deadline move to ADDED
    requirements.
  - MODIFIED "Walk order and links are defined per scheme": ignore files now
    follow the ignore-file requirements.
  - MODIFIED "Results are ordered, bounded, and paged by a keyset cursor":
    the 5,000-file and 20,000-entry references become the configured bounds;
    a file counts toward the file bound when the walk takes it; every line of
    the result counts toward the page; a call deadline keeps a no-match
    result incomplete.
  - MODIFIED "Scope backends fail closed per scheme": unset bounds travel as
    `null`; the request and response carry progress; the daemon gets nine
    tenths of the time left; the daemon returns excluded directories and an
    unfinished file; the API filters every daemon path through the `read`
    group; a daemon that refuses the parameters is Machine unusable; the
    Machine budget scenario names a configured byte bound.
  - ADDED: opt-in operator bounds; byte-bound counting; the deadline from the
    call timeout; streamed files; concurrent reads in canonical order; the
    unfinished-file rule and its progress rule; ignore files above the scope;
    the repository limit for `.gitignore`; the scope-directory rule; the
    excluded-directory report, its filter and bound, and its scope spelling;
    host decoding of the seven literal spellings.
- `instance-config`: ADDED the optional `tools.grep` bound settings.
- `tool-result-rendering`: MODIFIED "A grep page groups consecutive passages
  under one file line" to render the excluded-directory line and the
  unfinished-file line; MODIFIED "Framing values render on one line" so their
  locators fold line breaks.
- `tool-call-permissions`: ADDED the `read` evaluation of excluded
  directories under the `grep` per-file exception.

Deliberately unchanged:

- `grep-tool` "Matching is per logical line with a one-line window": a stream
  splits lines with the same rules; the 512-unit cut and the 2,000-line
  passage stay.
- `grep-tool` "The grep tool accepts one strict input object": no input
  field changes.
- `grep-tool` "Every hit is a locator that the read group admits": its
  per-file rule holds; ignore files, in scope or above it, are walk policy and
  never a hit.
- `grep-tool` "The tool is advertised when a backend can serve": its
  `tools.grep` is the tool-prompt-templates predicate, a template name, not
  the `tools.grep` configuration object that `instance-config` adds.
- `instance-config` "First-slice setting surface": its add-when-consumed rule
  ("extended by consumer changes, each adding its own keys") covers the new
  keys, which a separate ADDED requirement defines.
- `knowledge-tools`: `knowledge_search` keeps its own 20,000 / 5,000 /
  1 MiB / 32 MiB bounds; it does not use the grep engine's bounds.
- `tool-call-permissions` "Match submitted string values without
  serialization artifacts": its sixth named exception ("the `read` group
  SHALL evaluate each candidate file") is extended by the ADDED requirement,
  not restated.
- `tool-result-rendering` "Results that carry content render as text": "A
  `grep` page opens with its notice … or with its first `## <locator>` line"
  describes a page with a passage. A no-match page opens with its warnings
  line today, and after this change with the warnings, `[ignored …]`, or
  `[not searched to the end: …]` line.
- `tool-result-rendering` "A grep passage cut at the page bound names the
  cursor": page cutting is unchanged.

## Impact

- `packages/native-file-tools/src/grep/*`: scan, walk, passages, limits, and
  the walk port read interface.
- `apps/api/src/tools/grep*.ts`: ports, budget, deadline, Machine segment,
  result fields, rendering.
- `apps/api/src/knowledge/knowledge-filesystem*.ts`: the streamed read.
- `apps/machine/src/grep.ts`, `apps/machine/src/grep-port.ts`, and
  `packages/machine-protocol/src/grep.ts` and `types.ts`: the `fs.grep`
  request and response.
- `apps/api/src/instance-config/*`: schema, loader, published JSON Schema,
  `llame.config.jsonc.example`.
- `apps/api/src/sentry-setup.ts` and `apps/machine/src/instrument.ts`: the
  `UV_THREADPOOL_SIZE` default.
- `apps/api/src/prompts/tools/grep.md`, `docs/product/reference/tools/grep.md`,
  `docs/product/operator/native-files.md`, `docs/product/operator/machines.md`,
  `docs/development/harness-comparison/grep.md`, `CHANGELOG.md`.

## Non-Goals

- Whole-result preservation, page size, the per-file passage cap, and the
  cursor format (#915).
- A file-name search tool (`glob`):
  [#1510](https://github.com/leon0399/llame/issues/1510).
- A model-facing flag that disables ignore rules.
- Ignore files for `kb://` or `skill://` walks.
- A faster regex engine or a whole-file prefilter.

## Acceptance

- A no-match search over this repository on ext4 completes in one call with
  `complete: true` under default configuration.
- A test with a delayed fake port proves that no more than 8 reads run at the
  same time, that 8 do run at the same time, and that passages keep canonical
  order.
- Before/after timings for the two recorded workloads appear in the design and
  the implementation PRs.
- Each scenario in the delta specs has a focused test.
