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
  passage locators are built in four places (`grep/passages.ts:557`, `grep/page.ts:196`,
  `apps/api/src/tools/grep-machine.ts:718`, `grep-artifact.ts:318`). `grepFileLocator`
  (`grep/model-text.ts:47-63`) parses a stored bare range back to print the file line. Other
  printers: grep remainder (`grep/model-text.ts:439-473`), Knowledge `passageLocator`
  (`knowledge-tools.ts:493-499`), artifact notice (`runtime-safety/src/artifact-notice.ts:56-73`),
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
- **GitHub adapter.** `parseGithubUrl` matches `URL.pathname` only (`adapters/github/url.ts:82-85,
  273-289`). A blob is fetched from the Contents API and rendered line for line
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

The gate admits an optional `L` or `l` before each number of a member, plus the range form
`L5-L10`. After the gate accepts a suffix, one normalization step removes the letters, so
`parseMember`, the pending list, the raw split, and every scheme reader keep their digit-only
logic. The normalization returns the bare member list; the canonical printer adds `L` back.

Rejected: a unit field on `ReadTarget`. Only one unit exists, so a field would carry a constant and
every reader would have to check it. When `P` ships, its source adds that field with its own
semantics.

### D2: Reserved letters are selector shapes that fail

The gate recognizes a `P` or `M` member (`P3`, `P3-5`, `-M2`, either case) as a selector shape, so
the splitters of `machine://` and `ssh://` treat it as a selector and not as part of a filename.
The applier then refuses it with `invalid_selector` and the shared message. Any other letter stays
outside the gate, which keeps `notes:X5` a filename on those schemes as today. `L-5` is matched by
its own shape and refused with the fixed hint before the generic refusal.

Rejected: leaving `P` and `M` outside the gate until their features ship. A filename such as
`notes:P3` on `ssh://` would then work today and break when pages ship, which is the exact cost
the reservation exists to avoid.

### D3: Line and column is one selector form, split before the last colon

`splitSelectorSuffix` and the web splitter recognize a final `:N:M` of two bare numbers after
`:raw` and `:outline` and before the last-colon fallback. They return the selector `N:M`, which the
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

`grepFileLocator`, `grep.tsx`, `knowledge-search.tsx`, and the E2E parsers accept both
`path:5-10` and `path:L5-10`, because stored passage locators keep their old spelling.

Rejected: a backfill that rewrites stored `locator` strings. Both spellings stay valid input, so a
backfill buys only cosmetic uniformity at the cost of a data migration on Leo's running instance.

### D5: Prompt-import labels print the canonical selector

The import planner already splits the selector from each target. The label and the not-imported
line print the path plus `canonicalSelector(selector)`. The owner message, the stored marker, and
the admission text stay as written, so permission evaluation is unchanged.

### D6: A GitHub line anchor becomes the selector after the adapter claims the blob

`parseWebLocator` still cuts the fragment first, and it now returns a `lineAnchor` when the
fragment matches `L<n>(C<c>)?(-L<m>(C<c>)?)?` exactly. Every other fragment is dropped as today.
After admission, the read asks the GitHub adapter's pure `match` whether it claims the locator as a
blob. If it does:

- with a selector (`:raw` included), the read fails with `invalid_selector` before any request
  (grilling Q6);
- without one, the anchor becomes the selector `L<n>-<m>` for the adapter render only.

If the adapter fails and the read falls through, the generic render gets no selector from the
anchor. The stored `path` is the fragment-free locator, so the header and continuation have
selector room. Permission admission is unchanged: the submitted text keeps the fragment, and the
projected text drops it.

Rejected: anchors on every web read. A fragment on an HTML page is a heading id, not a line, and a
render's line numbers have no stable relation to the publisher's.

### D7: No Machine protocol bump

A daemon older than the hub receives `L5` or `12:5` and refuses it with `invalid_selector` from its
own grammar. That fails closed and reads nothing wrong. The deploy procedure updates hub and daemon
together. Rejected: bumping `PROTOCOL_VERSION`, which makes every Machine unavailable until it is
updated, for a change that degrades safely. Rejected: translating `L` to bare on the hub, which
does not cover `N:M` (D3) and adds a second spelling layer.

### D8: Refusal messages

`SELECTOR_FORMS` becomes the Q9 message in `native-file-tools` `The selector refusal teaches the
canonical forms`. The artifact, job, and skill-catalog listing refusals and the web line-count
refusal (`web-read/result.ts:241-255`) name `:L5-10`-style forms and add the bare clause. The
`L-5` hint and the anchor conflict message are fixed texts in their requirements.

### D9: Delivery graph

Input before output: a printed `L` must already parse when the model copies it. Each output layer
is safe alone because input accepts both spellings. The line-and-column and anchor cutovers come
last so their headers already print the canonical form. See tasks.md.

## Risks / Trade-offs

- [A filename that ends in a new selector shape changes meaning on `ssh://`, `kb://`, `skill://`,
  and web] -> Host and Machine keep literal-path precedence; the other schemes reach the name
  through `%3A`. The proposal marks this **BREAKING**.
- [Replayed headers change once, so the provider prompt cache misses on each Chat's next request
  after deploy] -> One-time cost. No stored text changes, so nothing else moves.
- [An external client parses `path:5-10` from tool results] -> Only the shipped UI and E2E parse
  them, and both accept both spellings. Recorded as **BREAKING** for wire consumers.
- [A model mixes old and new spellings across turns] -> Both are valid input with one meaning.
- [Machine daemon older than the hub] -> D7: fails closed with `invalid_selector`.
- [`l5` lowercase is close to `15` in some fonts] -> Output is always upper-case `L`; lowercase is an
  input convenience only.
- [A GitHub anchor on a fall-through read silently reads the whole page] -> The adapter note in the
  result already reports the failure. A refusal would hide content that the generic ladder can
  serve.

## Migration Plan

No data migration. Deploy hub and Machine daemons together. Rollback reverses the layers from the
top. Revert the input-grammar layer last: once output layers have shipped, stored transcripts
contain `L` spellings that the model copies, and only that layer parses them.

## Open Questions

None. Exact export names in D4 are an implementation choice.

## Revision history

- Round 0 (initial draft): grilling round Q5-Q9 recorded on #1833 before drafting.
