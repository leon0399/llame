## Context

See proposal.md for the reasons. The facts below were read at `origin/master` `02c8657c5`.

- **One grammar, several splitters.** `packages/native-file-tools/src/path.ts` owns the shape gate
  (`MEMBER_SOURCE`, digits only, lines 421-443), member placement (`parseMember`,
  `resolvePendingSelector`, lines 169-310), the host literal probe (lines 366-420), and the shared
  splitter `splitSelectorSuffix` (lines 515-558: trailing `:raw`, then `:outline`, then the last
  colon after the last `/`). `machine://`, `ssh://`, `media://`, `job://`, `artifact://`,
  `projects://`, Workspace paths, and prompt imports reuse that splitter. `kb://` and `skill://`
  split at the first colon of the path remainder and reuse only the gate
  (`knowledge-locator.ts:63-90`, `skill-locator.ts:88-159`). Web has its own splitter
  (`apps/api/src/tools/web-read/locator.ts:27-110`), which cuts the fragment first
  (`stripFragment`, lines 189-193) and refuses any split when `?` or `#` remains (`opensSelector`).
- **A suffix outside the gate stays on the path** on `machine://` and `ssh://`
  (`machine-locator.ts:109-126`, `ssh-locator.ts:196-210`). Both split the raw text before they
  decode `%XX`, so `%3A` reaches a literal colon.
- **The Machine daemon probes the literal text again** as `${path}:${selector}`
  (`apps/machine/src/file-targets.ts:126-143`) and then applies the selector with its own bundled
  copy of the grammar. Hub and daemon refuse each other unless `PROTOCOL_VERSION` is equal
  (`apps/api/src/machines/machine-session.ts:489`).
- **Printers.** Read headers and continuations: `model-text.ts` `formatRange`, `fileHeader`,
  `rangeSelector`, `multiSelector`, `resumeSelector`, `continuationLine` (lines 91-308). Grep
  passage locators are built in five places (`grep/passages.ts:557`, `grep/page.ts:196`,
  `apps/api/src/tools/grep-machine.ts:718`, `grep-artifact.ts:318`, and `grep-page.ts:444` in
  `mergeCutPassage`). Three server functions parse a passage range back: `grepFileLocator`
  (`grep/model-text.ts:47-63`) for the file line, and `passageStartLine` and `passageEndLine`
  (`grep/passages.ts:215-222`), which feed the page cursor (`grep/page.ts:110,171`), scan capping
  (`grep/scan.ts:519,540`), artifact cut counts (`grep-artifact.ts:281,311`), and cut-passage merge
  (`grep-page.ts:436`). Other
  printers: grep remainder (`grep/model-text.ts:439-473`), Knowledge `passageLocator`
  (`knowledge-tools.ts:522-528`), artifact notice (`runtime-safety/src/artifact-notice.ts:56-73`),
  head spill (`result-truncation.ts:214-226`), bash spill template
  (`apps/api/src/tools/prompts/bash-spill-omitted.md`), instruction pages
  (`instruction-files.ts:265-266`, `instruction-imports.ts:70`), and the prompt-import template
  (`apps/api/src/chats/prompts/prompt-imports.md:3,6`).
- **Replay re-renders.** `apps/api/src/tools/model-text.ts` renders the stored result object on
  every replay, so headers and continuations of old turns change with the renderer. String fields
  stored in a result (grep and Knowledge passage `locator`, prompt-import payloads) keep the spelling
  of the time they were written.
- **Owner UI and E2E parse printed text.** `packages/ui/.../grep.tsx:86-140` and
  `knowledge-search.tsx:52-80` parse `path:start-end`; `e2e/support/model-server.ts:238-242,
  509-515, 1104` parse read headers and continuations.
- **Permissions reuse the parser.** The `read` projection removes "the split-off read selector"
  through the same parser (`tool-call-permissions`, `Match submitted string values...`), so a new
  form that the parser splits leaves matching with no evaluator change.
- **GitHub adapter.** `parseGithubUrl` matches `URL.pathname` only (`adapters/github/url.ts:143-165`). A blob is fetched from the Contents API and rendered line for line
  (`adapters/github/code.ts:236-265`), and a selector already applies to that render. The adapter
  never sees a fragment. A failed adapter falls through to the generic ladder.

### Prior art

| System                                  | Unit spelling                                                         | Line and column                                                                                            | Notes                                |
| --------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| oh-my-pi `read`                         | `:L5-L10` and bare, case-insensitive (`tui/src/tools/line-ranges.ts`) | folds `a.ts:12:5` to line 12; keeps `clip.mp4:1:30` as a timestamp (`tui/src/tools/read.ts` about 128-160) | closest peer; its print side is bare |
| GitHub                                  | `#L10-L20`, `#L10`, `#L10C5-L20C3`                                    | column in the anchor                                                                                       | the fragment llame now reads         |
| GitLab, Sourcegraph                     | `#L10-20`                                                             | none                                                                                                       | one letter for the range             |
| Claude Code, OpenCode, Hermes, OpenClaw | typed `offset`/`limit`                                                | none                                                                                                       | option O4, rejected in #1833         |

## Goals / Non-Goals

Goals: one grammar change in `path.ts` that every source inherits; one canonical formatter for all
printers; no change to member semantics, bounds, context, or truncation.

Non-goals: see proposal.md. Additionally, no new member semantics for `P` or `M`, and no stored-data
migration.

## Decisions

### D1: The unit letter is stripped at the shape gate

The member shape admits an optional `L` or `l` before the first number of a member, and before the
second number of a range whose first number has it (`L5-L10`). That one member shape serves the
gate, `MEMBER_LIST` in the host `rawSplit`, and the web `<list>:raw` claim, because the raw split runs
before the gate: `notes.md:L4-5:raw` must split as path `notes.md` with selector `L4-5:raw`, kept
as written so the daemon's literal probe tests the model's text. Letters are removed only inside
`applySelectorSuffix`, after the split. Thus `parseMember` and the pending resolution keep their
digit-only logic. The splitters, the hub, and `parseMachinePath` pass the selector text as written,
so the daemon probes the literal name that the model wrote (D3).

Rejected: a unit field on `ReadTarget`. Only one unit exists, so a field would carry a constant and
every reader would have to check it. When `P` ships, its source adds that field with its own
semantics.

### D2: Reserved letters are selector shapes that fail

The gate recognizes a `P` or `M` member (`P3`, `P3-5`, `-M2`, either case), the misplaced `L-5`,
and `:raw:N:M`/`:outline:N:M` as selector shapes. The hub splitters for Machine paths (bare,
`file:`, relative, and `machine://`, through `workspace-path.ts:351-357` and `parseMachinePath`)
and for `ssh://` therefore treat them as selectors, not as part of a filename. The applier then
refuses each one: `P`/`M` and representation-plus-line-column with the shared message, `L-5` with
its fixed hint. These refusals come from the grammar, which knows no locator spelling, so `kb://`,
`skill://`, and web, which add `%3A` only when `isSelectorSuffix` fails
(`knowledge-locator.ts:83-90`, `skill-locator.ts:144-149`, `web-read/locator.ts:298-305`), add none.
Any other letter stays outside the gate, which keeps `notes:X5` a filename on Machine and `ssh://`
paths as today. The web port hint (`locator.ts:234-238`) names `<href>/:<suffix>` only for a suffix
the grammar admits, so `https://example.test:P3` gets the port message.

Rejected: leaving `P` and `M` outside the gate until their features ship. A filename such as
`notes:P3` on `ssh://` would then work today and break when pages ship, which is the exact cost
the reservation exists to avoid.

### D3: Line and column is one selector form, split before the last colon

`splitSelectorSuffix` and the web splitter recognize a final `:N:M` of two bare numbers after
`:raw` and `:outline` and before the last-colon fallback. The `:raw` and `:outline` patterns
(`path.ts:516,527`, `web-read/locator.ts:27-28`) widen to also claim a `:N:M` tail, so
`x.ts:raw:12:5` splits as path `x.ts` with selector `raw:12:5`, which the gate treats as a refused
shape (D2). Without that, the `:N:M` branch would read line 12 of a file `x.ts:raw`. They return the selector `N:M`, which the
gate admits as its own form and the applier reads as the member `N`. `kb://` and `skill://` split at
the first colon, so their suffix is already `N:M`.

The written selector reaches the Machine daemon unchanged, so its literal probe tests
`x.ts:12:5`, the whole text that the model wrote. Rejected: splitting `x.ts:12:5` into the path
`x.ts:12` plus a second probe (grilling Q5 chose no second probe), and rewriting the selector to
`12` before the daemon, which would make the daemon probe `x.ts:12` as a literal path.

### D4: One canonical formatter, used by every printer

`packages/native-file-tools` exports `formatLineRange` and `canonicalSelector` (names chosen at
implementation; one module). `model-text.ts`, grep passage construction, the grep remainder,
Knowledge passages, instruction pages, and prompt-import labels call it.
`packages/runtime-safety` cannot depend on `native-file-tools`, so `artifact-notice.ts` and
`result-truncation.ts` write the `L` prefix inline, with their own tests.

`grepFileLocator`, `passageStartLine`, `passageEndLine`, `cutToFit` (`grep/page.ts:188-191`), the
daemon's `passageOf` (`apps/machine/src/grep.ts:147-155`, which turns engine locators into wire line
numbers for every Machine grep), `grep.tsx`, `knowledge-search.tsx`, and the E2E parsers accept both `path:5-10` and `path:L5-10`, because stored passage locators keep their old
spelling. The formatter lands in the input-grammar layer, because the web refusal for
`https://example.test:1-5` already names `https://example.test/:L1-5` there.

Rejected: a backfill that rewrites stored `locator` strings. Both spellings stay valid input, so a
backfill buys only cosmetic uniformity at the cost of a data migration on Leo's running instance.

### D5: Prompt-import labels print the canonical selector

The planner splits the selector only for Machine targets today (`prompt-imports.ts:196-208`); `kb://`,
`skill://`, `media://`, `ssh://`, and web targets go to `read` whole (`:216-251`). The label step
therefore splits each target with the parser of its scheme, and prints the path plus
`canonicalSelector(selector)` only when the read resolved that split. A Machine target whose
literal probe found the whole name prints as written, because `README.md:L30-35` would name a
different resource. The existing `resolved` field cannot tell the two apart: it holds the real
path (`machine-prompt-probe.ts:66`), which equals the split locator when the literal name links to
the split file. `probeMachineTarget` (`prompt-imports.ts:352-366`) therefore returns a new
in-memory outcome field, `literal`, that the label step reads; it is not stored. A target whose
selector the grammar refuses prints as written. The owner message, the stored marker, and the
admission text stay as written, so permission evaluation is unchanged.

### D6: A GitHub line anchor becomes the selector after the adapter claims the blob

`parseWebLocator` still cuts the fragment first, and it now returns a `lineAnchor` when the
fragment matches `L<n>(C<c>)?(-L<m>(C<c>)?)?` exactly. Every other fragment is dropped as today.

`WebAdapter.match` is boolean, the GitHub `match` accepts every GitHub kind, and the executor sees
adapters only by their operator id (`adapters/contract.ts:85-86,255-292`, `execute.ts:312`). The
contract therefore gains one optional pure hook, `lineAddressed(source): boolean`. The GitHub
adapter implements it as "this source parses as a blob". The rendered outcome gains a flag that
says the render came from an adapter whose hook accepted the source. After admission, the read
asks each enabled adapter's hook, without network I/O and whatever `:raw` would do. If one accepts:

- with a selector (`:raw` included), the read fails with `invalid_selector` before any request
  (grilling Q6);
- without one, the anchor becomes the selector `L<n>-<m>` for the adapter render only.

The executor applies the anchor only to a render that carries the flag. A render from a later
claimant after a fall-through, or from the generic ladder, gets no selector from the anchor. Two
`use: github` entries behave as one: the first that renders with the flag gets the anchor. The stored
`path` is the fragment-free locator, so the header and continuation have selector room, except
when the locator has a query such as `?plain=1`, where the continuation states the remainder alone. Permission admission is unchanged: the submitted text keeps the fragment, and the
projected text drops it.

Rejected: anchors on every web read. A fragment on an HTML page is a heading id, not a line, and a
render's line numbers have no stable relation to the publisher's.

### D7: Increment the Machine protocol version once, with the whole daemon grammar

A daemon older than the hub refuses `L5` or `12:5` from the model with `invalid_selector`, which is
safe. It also refuses the `:raw:L1-2000` pages that llame writes for instruction files, and
`readInstructionFile` treats that as a failed file (`instruction-files.ts:271-278`,
`instruction-imports.ts:220`). A Machine `AGENTS.md` would then disappear from the Run with no
message. The input-grammar layer therefore increments `PROTOCOL_VERSION` from 2 to 3
(`remote-machines` MODIFIED), so the hub refuses a stale daemon with the visible
`incompatible_version` failure (`machine-session.ts:489-496`). That layer also carries the
line-and-column suffix: a second grammar change in a later layer would need a second increment,
because a version-3 daemon would refuse the `12:5` selectors a newer hub forwards. No test pins the
literal number; the CHANGELOG entry tells operators to update every daemon with the release.

Rejected: a capability in `hello.methods`, which keeps two spellings alive in the hub for one
release. Rejected: bare instruction pages, which break the canonical-spelling requirement for the
one selector that the owner sees in audit. Rejected: translating `L` to bare on the hub, which does
not cover `N:M` (D3).

### D8: Refusal messages

`SELECTOR_FORMS` becomes the Q9 message in `native-file-tools`
`The shared selector refusal names the lettered forms`. A message that quotes the model's selector,
such as the web line-count refusal and the anchor conflict, quotes it as written. The artifact, job, and skill-catalog listing refusals and the web line-count
refusal (`web-read/result.ts:241-255`) name `:L5-10`-style forms and add the bare clause. The
`L-5` hint and the anchor conflict message are fixed texts in their requirements.

### D9: Delivery graph

Input before output: a printed `L` must already parse when the model copies it. Each output layer
is safe alone because input accepts both spellings. The input-grammar layer carries the
line-and-column suffix and closes #1834, so the one protocol increment covers every daemon-side
grammar change (D7). The anchor cutover comes last so its header already prints the canonical
form. See tasks.md.

## Risks / Trade-offs

- [A filename that ends in a new selector shape changes meaning on Machine and `ssh://` paths
  (`notes:L5`), and `x:12:5` changes meaning on every text source] -> Literal-path precedence keeps
  an existing whole name on host and Machine; `ssh://` reaches it through `%3A`; `x:12:L5` keeps the
  old line-5 reading. The proposal marks this **BREAKING**.
- [Replayed headers change once, so the provider prompt cache misses on each Chat's next request
  after deploy] -> One-time cost. No stored text changes, so nothing else moves.
- [An external client parses `path:5-10` from tool results] -> Only the shipped UI and E2E parse
  them, and both accept both spellings. Recorded as **BREAKING** for wire consumers.
- [A model mixes old and new spellings across turns] -> Both are valid input with one meaning.
- [Machine daemon older than the hub] -> D7: the hub refuses it at the handshake, so every
  Machine stays unavailable until its daemon is updated.
- [A literal name such as `secret:P3` now projects as `secret`, so a `$`-anchored reject on the
  whole literal name stops matching it] -> The same known text-only gap as a bare range today.
  The recommended rules end in `([/\\]|$|:)` and still refuse it. Recorded as **BREAKING**.
- [`l5` lowercase is close to `15` in some fonts] -> Output is always upper-case `L`; lowercase is an
  input convenience only.
- [A GitHub anchor on a fall-through read silently reads the whole page] -> The adapter note in the
  result already reports the failure. A refusal would hide content that the generic ladder can
  serve.

## Migration Plan

No data migration. Deploy hub and Machine daemons together; the protocol increment enforces it. Rollback reverses the layers from the
top. Revert the input-grammar layer last: once output layers have shipped, stored transcripts
contain `L` spellings that the model copies, and only that layer parses them.

## Open Questions

None. Exact export names in D4 are an implementation choice.

## Revision history

- Round 0 (initial draft, 0e7df23fc): grilling round Q5-Q9 recorded on #1833 before drafting.
- Round 1: two reviewers, spec consistency (P0 0, P1 5, P2 7) and feasibility (P0 0, P1 7, P2 7).
  Accepted all P1: proposal names aligned; `ssh://`/`machine://` carve-out in the shared refusal;
  anchor trigger defined through the adapter hook (D6), whatever `:raw` does; `L-5` hint scope and
  `%3A` order; instruction-files isolation clause restored; grep range parsers and the fifth printer
  added (D4); the letter admitted in the raw split (D1); formatter moved to the input-grammar
  layer; literal prompt-import targets print as written (D5); D7 reversed to a protocol increment;
  the literal-name permission gap recorded. Accepted P2: `N:M` in the `kb://`/`skill://` validation,
  `5-L10` refused, representation plus line-and-column refused, anchor case and `#L0`, `?plain=1`
  continuation, the source-without-lines rule narrowed to images, stale anchors, STE slips.
  Rejected none.
- Round 2: two local reviewers (consistency P0 0/P1 3/P2 9; feasibility P0 0/P1 4/P2 3) and the
  bots on d51b98f35 (Codex 1, CodeRabbit 6, pullfrog 2). Accepted: the `L-5` rule said "after its
  minus sign"; host and Machine paths join the `ssh://` carve-out and "selector shape" is defined;
  `:raw:N:M`/`:outline:N:M` claimed by the representation split (D3); `cutToFit` and the daemon
  `passageOf` added (D4); `remote-machines` MODIFIED for version 3; the line-and-column suffix
  moved into the input-grammar layer so one increment covers it (Codex, CodeRabbit); `L-5` and
  reserved refusals add no `%3A`; quoted model selectors stay as written; D5 `literal` field; the
  web port hint only for admitted suffixes; `2024:10:raw:L1-N`. Rejected as pre-existing canonical
  text unchanged in behavior here: multiline `knowledge_search` queries, outline `lineCount` versus
  the open continuation, and the bound-cut scenario order (CodeRabbit). Rejected as no change
  needed: pullfrog's finalize reconciliation note, which finalize task 6.3 already covers.
