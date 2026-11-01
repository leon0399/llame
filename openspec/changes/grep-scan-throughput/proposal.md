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
- The walk reads up to 8 files at the same time and still returns passages in
  canonical order.
- Files are searched as a stream with no size cutoff. A line longer than
  64 MiB skips its file as `oversized`. A file that is not valid UTF-8 at any
  point still contributes no passage.
- The call deadline derives from the tool call timeout
  (`tools.callTimeoutSeconds`, default 120 s) minus a margin, so a slow walk
  returns its passages and a cursor instead of the runner's empty `timeout`
  error. The fixed 30 s deadline is removed.
- A file that one whole call cannot finish is reported by locator and the
  cursor moves past it, so a resumed search always makes progress.
- Ignore files: `.ignore` is honored beside `.gitignore`. Ignore files in
  directories above the scope apply (`.gitignore` up to the nearest `.git`,
  `.ignore` up to the filesystem root). The scope directory itself is always
  searched. Each rule is evaluated on its own, which fixes the #1392
  layer-voiding defect.
- The result reports excluded directories: a count and the first five
  locators, so a model can scope one of them explicitly.
- **BREAKING** (Machine protocol): `fs.grep` changes in place. Unset bounds
  travel as `null`, and the response gains the ignored-directory and
  unfinished-file fields. No compatibility path exists for an older daemon.

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
- Q13 A: 64 MiB per line.
- Q14 A: skip and name a file one call cannot finish.
- Q15: no Machine compatibility path; `fs.grep` changes as if new.
- Q16 A: fold the #1392 ignore-layer defect into this change.
- A1–A5 confirmed: margin is 10% of the timeout with a 5 s floor; concurrency
  covers listing and ignore lookups; `.ignore` outranks `.gitignore` in one
  directory; one directory is still listed whole; three implementation
  layers.

Assumptions that follow from those answers but were not asked separately:

- Ignore files stay a host and Machine walk feature. `kb://` and `skill://`
  walks read no ignore file today, and this change adds none.
- A Machine walk applies ignore files above the scope only inside the
  registered root that holds the prefix.
- The unfinished-file rule covers a byte bound reached inside a file as well
  as the deadline, because a streamed file can cross either bound mid-scan.
- A file is skipped as unfinished only when the call reached no entry past its
  incoming cursor. A stop that lands inside a file after progress resumes at
  that file on the next call.
- An ignored directory is named only when the `read` group admits its
  locator, under the existing rule that a refused path contributes no count
  and no name. The engine keeps at most 1,000 excluded directory paths per
  call.
- With Q15 removing compatibility, an unset bound travels to a Machine as
  `null`, not as `Number.MAX_SAFE_INTEGER`. This replaces the Q5 mechanism,
  which existed only to avoid a protocol change.
- The margin never exceeds half the call timeout, so a short timeout still
  scans.
- Node runs file reads on a libuv pool of 4 threads by default, so 8 reads
  would run 4 at a time. The API, worker, and daemon set
  `UV_THREADPOOL_SIZE=16` when it is unset (design D2). This was not asked;
  it is the precondition for Q6.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `grep-tool`:
  - MODIFIED "Walks are bounded": skip rules stay; the fixed numeric bounds
    and the 30 s deadline move to the requirements below.
  - MODIFIED "Walk order and links are defined per scheme": ignore files now
    follow the new ignore requirement.
  - MODIFIED "Results are ordered, bounded, and paged by a keyset cursor":
    the 5,000-file and 20,000-entry references become the configured bounds.
  - MODIFIED "Scope backends fail closed per scheme": the Machine budget
    scenario names a configured byte bound; unset bounds travel as `null`.
  - ADDED: operator bounds are opt-in; the deadline derives from the call
    timeout; files are searched as streams; reads run concurrently in
    canonical order; a file one call cannot finish is skipped and named;
    ignore files apply from above the scope; excluded directories are
    reported.
- `instance-config`: ADDED the optional `tools.grep` bound settings.
- `tool-result-rendering`: MODIFIED "A grep page groups consecutive passages
  under one file line" to render the excluded-directory line and the
  unfinished-file line.

Deliberately unchanged:

- `grep-tool` "Matching is per logical line with a one-line window": a stream
  splits lines with the same rules; the 512-unit cut and the 2,000-line
  passage stay.
- `grep-tool` "The grep tool accepts one strict input object": no input
  field changes.
- `instance-config` "First-slice setting surface": its add-when-consumed rule
  ("extended by consumer changes, each adding its own keys") covers the new
  keys, which a separate ADDED requirement defines.
- `tool-result-rendering` "A grep passage cut at the page bound names the
  cursor": page cutting is unchanged.

## Impact

- `packages/native-file-tools/src/grep/*`: scan, walk, passages, limits, and
  the walk port read interface.
- `apps/api/src/tools/grep*.ts`: ports, budget, deadline, Machine segment,
  result fields, rendering.
- `apps/machine/src/grep.ts` and `packages/machine-protocol/src/grep.ts`: the
  `fs.grep` request and response.
- `apps/api/src/instance-config/*`: schema, loader, published JSON Schema,
  `llame.config.jsonc.example`.
- API, worker, and daemon entrypoints: the `UV_THREADPOOL_SIZE` default.
- `apps/api/src/prompts/tools/grep.md`, `docs/product/reference/tools/grep.md`,
  `docs/product/operator/native-files.md`, `CHANGELOG.md`.

## Non-Goals

- Whole-result preservation, page size, the per-file passage cap, and the
  cursor format (#915).
- A file-name search tool (`glob`); filed separately.
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
