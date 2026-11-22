## Why

The `read` selector grammar is a wire contract that llame prints into tool results and stores in
every transcript. Today a bare range is the only unit, so planned sources collide with it:
[video frames](https://github.com/leon0399/llame/issues/1072) (`clip.mp4:50`),
[PDF pages](https://github.com/leon0399/llame/issues/1276) (`paper.pdf:3-5`), and
[`chats://` messages](https://github.com/leon0399/llame/issues/703) would each read the same digits
differently. A unit system is cheap before launch and costly after it, because every stored
transcript teaches the model the spelling it saw.

Two adjacent failures use the same parser. A pasted compiler location such as `src/x.ts:12:5`
fails with `not_found` ([#1834](https://github.com/leon0399/llame/issues/1834)), and a pasted GitHub
link loses its `#L10-L20` range ([#1835](https://github.com/leon0399/llame/issues/1835)).

Source: [#1833](https://github.com/leon0399/llame/issues/1833), its
[decision table](https://github.com/leon0399/llame/issues/1833#issuecomment-7048865586), the
[grouping decision](https://github.com/leon0399/llame/issues/1833#issuecomment-7050365179), and the
[spec grilling round](https://github.com/leon0399/llame/issues/1833#issuecomment-7084086429).

## What Changes

- **Input grammar.** Every line member accepts the unit letter `L` before its number, in either
  case: `L5`, `L5-10`, `L5+10`, `L5-`, `-L5`, comma lists of them, `raw:L4-5`, and
  `outline:L5-40`. A range also accepts GitHub's `L5-L10`. A bare member still means lines.
  `L-5` fails with `invalid_selector` and a fixed hint. A list that mixes units fails.
- **Reserved units.** `L` (lines), `P` (pages), and `M` (messages) are reserved. No source accepts
  `P` or `M` yet, so they fail with `invalid_selector` on every source, including `ssh://` and
  `machine://`, where an unknown suffix stays on the path today.
- **Printed spelling.** Every selector that llame prints or authors uses the canonical `L`
  spelling: read headers, continuation notices, listing paging, artifact notices, bash spill
  lines, grep and `knowledge_search` passage locators, the grep remainder line, Knowledge
  instruction pages, and prompt-import labels. Tool prompts and the refusal messages teach the
  `L` forms and say that a bare number also reads as a line.
- **Line and column** ([#1834](https://github.com/leon0399/llame/issues/1834)). Every text
  source reads a trailing `:N:M` of two bare numbers as line `N` and ignores the column. A literal
  path still wins first where a literal probe exists.
- **GitHub line anchors** ([#1835](https://github.com/leon0399/llame/issues/1835)). The GitHub
  adapter reads a blob fragment `#L10`, `#L10-L20`, or `#L10C5-L20C3` as the line selector over
  the decoded source. Other fragments and other adapters keep today's behavior.
- **BREAKING (wire spelling).** Grep passage `locator` fields, `knowledge_search` passage
  `locator` fields, and every printed range change from `path:5-10` to `path:L5-10`. Stored
  results replay with the new header and continuation spelling. Stored passage `locator` strings
  keep the spelling they were written with, and both spellings stay valid `read` input. A client
  that parses these strings must accept both; the shipped owner UI is updated in the same layer.
- **BREAKING (filenames).** On `ssh://`, `machine://`, `kb://`, `skill://`, and web locators, a
  name that ends in a new selector shape (`notes:L5`, `notes:P3`, `x:12:5`) now splits as a
  selector. Host and Machine reads keep literal-path precedence. Every other source reaches such a
  name through its `%3A` spelling.

## Assumptions, confirmed with Leo

- Output names units; input accepts bare digits as lines (O3, issue Outcome).
- Canonical forms, `L5-L10` and lowercase input, and the `L-5` hint (grilling Q1 A, Q1b A).
- Each list member carries its own letter; a list that mixes units fails (grilling Q2 A).
- `L`, `P`, `M` are reserved; other units claim a letter with their feature (grilling Q3 A).
- A bare range always means lines, and a source without lines refuses it (grilling Q4 A).
- Literal paths still win (decision table).
- `:N:M` folds on every text source, bare pair only, no second probe; `x.ts:12:L5` reaches line 5
  of `x.ts:12` (grilling Q5 A).
- A GitHub blob locator with both a line anchor and a selector, `:raw` included, fails with
  `invalid_selector` (grilling Q6 A).
- Listings print `L` (grilling Q7 A).
- Prompt-import labels print the canonical spelling; the owner's message is never rewritten
  (grilling Q8 A).
- Refusal messages teach the `L` forms and add that a bare number also reads as a line
  (grilling Q9 A).

Assumptions that follow from those decisions but were not asked:

- A list may combine bare and `L` members (`5-16,L960-973`), because both are lines. Only a second
  unit makes a list mixed.
- The count after `+` takes no letter: `L5+10` is valid, and `L5+L10` fails with
  `invalid_selector`.
- The GitHub anchor also accepts `#L10C5` (one line with a column), because the column rule drops
  it. Anchors are matched case-sensitively, as GitHub writes them.
- A line anchor applies only to the decoded blob that the GitHub adapter renders. When the adapter
  fails and the read falls through to the generic ladder, the fragment is dropped as any fragment
  is today.
- Stored transcripts are not rewritten (pre-launch policy: no preservation backfills, and none is
  needed because both spellings stay valid input).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: MODIFIED `Read selectors and context are deterministic` (unit letters in
  the member set, the new refusal message, and the line-and-column split),
  `Web locators are fetched by the native read tool` (admitted forms, line-and-column split, and
  GitHub anchors before the fragment cut), and `An unselected read requests the whole source`
  (printed `:L51-`). ADDED `Line members can name the L unit`,
  `A misplaced unit letter is refused with a fixed hint`, `Unit letters are reserved`,
  `llame writes every selector in the canonical spelling`,
  `A trailing line and column read the line`, `GitHub blob line anchors select lines`, and
  `A line anchor and a selector together are refused`.
- `tool-result-rendering`: MODIFIED `Results that carry content render as text`,
  `The read header names the source and the shown lines`,
  `The read header carries the source total when it is stored`,
  `A count of one takes the singular noun`, `Continuation is one bracketed notice line`,
  `The continuation count names the source lines after the cut`,
  `A bash result renders a status header and its streams`,
  `An artifact notice is one bracketed line`, `The grep remainder line names the next files`, and
  `A job read renders as text`. Each prints `L`.
- `grep-tool`: MODIFIED `Every hit is a locator that the read group admits` and
  `The remainder line names the next files`.
- `knowledge-tools`: MODIFIED
  `Knowledge search scans one or all current spaces deterministically within global bounds`
  (passage locator spelling).
- `tool-artifacts`: MODIFIED `A head result names the artifact in its cap notice`.
- `instruction-files`: MODIFIED `A Knowledge locator loads the chain within its Space` (page
  spelling `raw:L<from>-<to>`).
- `prompt-imports`: ADDED `Import labels print the canonical selector`.
- `tool-call-permissions`: ADDED `Every selector spelling leaves resource matching`.

Deliberately unchanged, with the reading under which each holds:

- Every requirement that quotes a bare range only as `read` input (`native-file-tools`
  multi-range, outline scope, Knowledge, skill, media, PDF, and directory requirements;
  `remote-machines`, `ssh-locator`, `background-jobs`, `import-markers`, `prompt-imports`
  resolution, and `tool-artifacts` read requirements). Bare members stay valid input with the same
  meaning, so each quoted input still reads what it says.
- `grep-tool` `Matching is per logical line with a one-line window`: `:3-7` names a passage's line
  window, not its printed spelling, which `Every hit is a locator...` fixes.
- `tool-result-rendering` `A grep page groups consecutive passages under one file line`: it
  requires `<locator>:<start>-<end>` to be a valid `read` argument, which stays true. The page
  prints no range in its file line.
- `tool-result-rendering` `A locator without selector room states the remainder alone`: a
  fragment or query still blocks a trailing selector. A read that a GitHub line anchor selects
  stores a fragment-free path, so its continuation has selector room.
- `tool-call-permissions` `Match submitted string values without serialization artifacts`,
  `File permission matching uses logical resource locators`, and the artifact, job, and Project
  locator requirements: each removes "the split-off read selector" through the `read` parser, so
  the new forms leave matching with no text change. The ADDED requirement pins that with
  negative scenarios. The active `tool-search` change modifies
  `Recommended portable policy with explicit replacement`, which this change does not touch.
- `native-file-tools` `GitHub native adapter reads repository code` and
  `Web adapter contract is ordered, admitted, and fallible`: the anchor rule is ADDED beside them,
  and neither quotes a fragment.

## Impact

- `packages/native-file-tools`: grammar, split, refusal messages, read-text renderers, grep
  passage locators, and the grep file-line parser.
- `packages/runtime-safety`: artifact notice and head-spill continuation.
- `apps/api`: web locator split and GitHub adapter, Knowledge, skill, Machine, ssh, artifact, job,
  and Project locators (through the shared gate), grep page and Machine grep, Knowledge passages,
  bash spill template, instruction paging, prompt-import labels, listing refusal messages, and
  the tool prompts `read.md`, `grep.md`, `knowledge_search.md`, `bash.md`, `web_search.md`, and
  `chat-default.md`.
- `apps/machine`: the daemon applies the new forms through the shared package. A daemon older than
  the hub refuses them with `invalid_selector`; no protocol version change.
- `packages/ui`: grep and Knowledge search cards parse both spellings.
- `e2e/support/model-server.ts` and the Knowledge E2E spec: printed-text parsers.
- Docs: `docs/product/reference/selectors.md`, the tool and locator reference pages, and the
  operator `web-read.md` and `tool-call-permissions.md` examples.
- Prompt cache: every Chat's replayed read headers change once at deploy, so the first request
  after it misses the provider cache for that history.

## Non-Goals

- Units for pages, messages, frames, or timestamps. This change reserves `P` and `M` only; each
  unit ships with its feature.
- Typed `offset`/`limit` arguments (option O4).
- Rewriting stored transcripts or passage locators.
- Line anchors for any adapter or URL shape other than a GitHub blob, including GitHub tree,
  commit, and `raw.githubusercontent.com` URLs.
- Columns. The column of `:N:M` and of `#L10C5` is dropped, not used.

## Acceptance

- `read("notes.md:L5-10")`, `read("notes.md:5-10")`, and `read("notes.md:l5-L10")` return the
  same lines; `read("notes.md:L-5")` fails with `invalid_selector` and the fixed hint.
- `read("notes.md:P3")` and `read("ssh://box/notes:M2")` fail with `invalid_selector`.
- A read header, continuation notice, artifact notice, grep and `knowledge_search` passage
  locator, and prompt-import label print `L`, such as `notes.md:L4-11 of 40 lines`.
- `read("src/x.ts:12:5")` returns line 12 of `src/x.ts`; a file literally named `x:12:5` is still
  read as that file; `2024:10:raw` stays line 10 of `2024`, read raw.
- `read("https://github.com/o/r/blob/main/f.ts#L10-L20")` returns lines 10 through 20 of `f.ts`
  with the context of a `:L10-20` read; `#readme` keeps today's behavior; the fragment is never
  sent to GitHub.
- A reject clause on a file refuses every new spelling of a read of that file.
