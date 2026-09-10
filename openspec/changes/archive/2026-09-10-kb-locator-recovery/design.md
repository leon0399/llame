## Context

See proposal.md — Why. Decisions were settled with the owner in the design
session that produced #736 and #737; this document records them and the
evidence.

Parsing today: `parseKnowledgeLocator`
(`apps/api/src/knowledge/knowledge-locator.ts:35-66`) splits on the first
`/`, then on the first `:` after it, and passes the path through verbatim.
Nothing anywhere calls `decodeURIComponent`. `validatePath`
(`knowledge-filesystem-validation.ts:51-79`) rejects absolute, empty, `.`,
`..`, backslash, and control-character components on the split segments.
`isLocatorAddressablePath` (`:87`) is `!relativePath.includes(':')` and is
consulted once, at `knowledge-filesystem.ts:276`, to skip a file from search.
`passageLocator` (`knowledge-tools.ts:474`) emits raw paths.

Misses today: a `kb://` read resolves with `allowMissing=false`
(`apps/api/src/tools/native-files.ts:77`); the adapter lstats every component
and throws `knowledge_not_found`, which `mapResolutionFailure` renders as the
same `File not found.` the native reader would, before `readResolvedFile`
runs. An absolute-path miss surfaces as `ENOENT` in `readFailure`
(`packages/native-file-tools/src/read.ts:151-165`). `isInsideSpace`
(`knowledge-filesystem.ts:332-349`) already handles a missing path by walking
up to the nearest existing ancestor and checking its `realpath`.

Prior art, re-verified on fresh clones on 2026-09-08 and pinned; where the
issue text said something different, the pinned reading wins:

- oh-my-pi @ `a33cc26`: `internal-urls/parse.ts` keeps the pathname encoded
  (`PATHNAME_RE`, `:15,74,101`) and each scheme decodes once, downstream, on
  the whole combined path before any segment split (`local-protocol.ts:230`,
  `vault-protocol.ts:157`, and seven more). Both spellings therefore resolve
  alike, and a literal space survives because decoding is a no-op on it; but
  decode-before-split is exactly the `%2F` boundary risk D1 avoids. The
  model instruction "Literal `:`, `?`, `#` -> percent-encode"
  (`prompts/tools/read.md:28`) sits under the `ssh://` bullet only. So the
  archived `kb-locator` D6 was right that the instruction is `ssh://`-scoped
  and wrong that encoding is required: decoding is general and both
  spellings work. #736's own correction overstated this; the pinned reading
  is recorded here.
- openclaw @ `1a06c2f8`: `agent-tools.read.ts:623-628` detects an encoded
  separator in the pathname before `decodeURIComponent` and bails to the
  raw path (reject-on-detection through `@openclaw/fs-safe`), not
  split-then-decode as #736 said. D1's per-segment refusal has the same
  effect by a different mechanism.
- gemini-cli @ `c647533`: `resolveToRealPath` (`utils/paths.ts:441,449`)
  decodes the whole path once for `read_file`, `write_file`, and `edit`;
  `%25` appears nowhere in the repository, so the literal-`%` cost is
  undocumented.
- hermes @ `091cc0e8be`: `_suggest_similar_files`
  (`tools/file_operations.py:1744-1801`) lists the directory on `ENOENT`,
  scores (exact 100, same stem 90, prefix 70, substring 60, then a
  Ratcliff/Obershelp ratio ≥ 0.8 → 50), returns five, and the names reach the
  model in the tool's JSON error (`tools/file_tools.py:1861-1865`).
  gemini-cli @ `0bd1d4397` `pathCorrector.ts:34-82` is an exact-basename BFS
  for the edit tool only, capped at 50 directories, failing on ambiguity.
  oh-my-pi @ `1adcef976` `path-utils.ts:1372-1410` probes a five-variant
  ladder silently, then a unique workspace glob. deepseek-harness, goose,
  aider, and llame return a flat error.
- No harness instructs a model about spaces.
- Fuzzy engines, surveyed for the suggestion scorer on 2026-09-08: fzf,
  `fzf-for-js`, `fuzzysort`, `microfuzz`, `nucleo`, `skim`, and `zf` are
  subsequence matchers (every query character must appear in the candidate in
  order, raw unbounded score). Hand-traced, they fail outright in both match
  directions on three of the four error classes here: wrong extension,
  percent-encoding (a substitution, not an insertion), and transposed words.
  `frizbee` (the backend of dmtrKovalenko's `fff`) is the one engine built
  for typos, and it ships as a native addon or MCP server with no maintained
  npm or WASM build. No harness applies any of these at miss time; opencode
  (`fuzzysort` plus a native `fff` binding), gemini-cli (`fzf`), and
  deepseek-harness keep them for the human file picker and give the model a
  bare "not found". `fuzzysort` and `leven` are in this repo's lockfile only
  as transitive dev dependencies of shadcn and orval.

A representative vault (232 entries): 123 names with spaces, 15 with
parentheses, 11 with `@`, 9 with `+`, 5 with `&`, none with `:`, `%`, `#`, or
`?`.

## Goals / Non-Goals

Goals:

- Both spellings of a path resolve, so the model's URI instinct stops costing
  a round trip.
- Every regular file in a Space is addressable and searchable, including one
  with `:` in its name.
- A miss carries the names that would have hit, on both schemes, from one
  implementation.

Non-goals:

- A slug alias for Space UUIDs (#332). Any change to the selector grammar.
- A silent probe ladder that resolves a wrong path without telling the model
  (oh-my-pi's shape). The model is told what exists; it chooses.
- Suggestions on `edit` or `write`. A mutation that misses must miss.
- Recursive or cross-directory search for the name (gemini-cli's shape). One
  `opendir` on the parent, on the error path only.

## Decisions

### D1: Decode on parse, after splitting

The raw locator is split on `/` and on the first `:` after the identifier,
exactly as today; then each path segment is `decodeURIComponent`-ed. Because
the split precedes decoding, `%2F` decodes into a segment that contains `/`
and is refused, and `%3A` decodes into a segment that contains `:` and is
accepted: the selector colon was already consumed on the raw string. A
`URIError` from a malformed sequence maps to `invalid_path`. Decoding happens
exactly once, so `%252E%252E` is the literal name `%2E%2E`. The Space
identifier and the selector are matched on the raw string and never decoded:
an identifier carrying `%` fails the identifier pattern and returns
`knowledge_space_not_found`; a selector carrying `%` is not a selector and
returns `invalid_path`. The decoded segments are rejoined with `/` and handed
to the existing `validatePath`, which refuses `..`, empty, backslash, NUL and
control-character components; because `validatePath` re-splits the joined
string, a decoded `/` is invisible to it, so the parser refuses a decoded
segment containing `/` itself, per segment, before rejoining. The
discriminating test is `notes%2Fsecret.md`: it must be `invalid_path`, and
`notes/secret.md` must not be opened. A traversal such as `%2F..%2F` is
refused by the `..` rule whether or not the per-segment check exists, so it
proves nothing about it.

Alternatives: instruct the model to always encode (rejected: no peer does;
123 of 232 vault names would carry `%20`); instruct it never to encode
(rejected: the URI shape invites encoding and the seven-miss transcript shows
the instruction loses); accept literal only and add `:` as an escape
(rejected: still leaves `%`-containing names ambiguous and invents a grammar).

### D2: Emission encodes only what the grammar needs

`passageLocator` encodes a segment only when it contains `:`, `?`, `#`, or
`%`, replacing exactly those characters. The `:` is the one this parser needs;
`?` and `#` are the two a URI-minded model may strip as query or fragment;
`%` must be encoded once encoding exists at all, or a name containing `%20`
on disk becomes ambiguous. Everything else stays literal so the common case
reads as a path. `isLocatorAddressablePath` is deleted along with its call.

A `kb://` listing renders entry names, not locators, so nothing there
encodes; the header stays the locator as given. This narrows #736, which
asked for listings to encode too; recorded here as a changed decision.

Downstream, every model-facing tool result passes the delimiter neutralizer,
which entity-escapes reserved tag names such as `<tool-result>` in any string,
the `locator` field included. A file named after a reserved tag therefore
reaches the model with that name escaped. Accepted: it is the same treatment
every other result string receives, and the file remains addressable by the
literal name.

### D3: One sentence for the model, in two places

The `read` description gains: "In a `kb://` path, write a literal `:`, `?`,
`#`, or `%` as `%3A`, `%3F`, `%23`, or `%25`; spaces and other characters may
be literal or encoded; `/` is the separator and is never encoded."
`chat-default.md` gains the same rule in its
Knowledge sentence. This mirrors oh-my-pi's three-character instruction plus
the `%` cost gemini-cli leaves undocumented.

### D4: Suggestions live in the native package, on the `ENOENT` path

`readFailure` in `packages/native-file-tools/src/read.ts` is the one place
both schemes reach a miss once D5 lands. Today it receives only the error; it
gains the resolved host path and the display path, and derives the parent
and the requested basename from them. The `ENOENT` error's own `path` field
is never used, so no host path can leak into a `kb://` message. On `ENOENT`
for a file target without a trailing separator it `lstat`s the parent and,
when the read refused links (`followSymlinks` false, which is every `kb://`
read, mirroring the leaf rule at `read.ts:126-127`), refuses a symbolic-link
parent with the bare error; an absolute-path read passes `followSymlinks`
true (`read.ts:88`) and its suggestions follow a linked parent exactly as the
read itself would have, because the host process is the authority there and
no Space boundary exists. It then opens the parent once, reads names under
the existing traversal budget, scores each against
the requested basename, and appends up to five names to the `not_found`
message: `File not found. Similar names in the same directory: a, b, c.` If
the parent itself is missing, the message says so and lists nothing. A target
with a trailing separator is a directory read and gets no suggestions on any
scheme, which is what the absolute-path resolver already does. Names only;
the message is composed once here, because a bare name carries no path and
therefore nothing a `kb://` result must hide. (#737 proposed per-caller
composition for that reason; with names only it buys nothing, so it is
dropped.)

Scoring is an edit-distance pipeline, not a subsequence matcher, because the
query is a wrong spelling of an existing name rather than an abbreviation of
one (see the engine survey in Context):

1. Normalize the requested basename and every candidate identically: NFC,
   then percent-decode inside a try/catch; a string that fails to decode
   (`100%.md`) is compared as spelled, so a malformed name on disk or in the
   request is scored, never thrown. This alone settles encoding and NFC/NFD
   for absolute paths, where D1's decode-on-parse does not apply.
2. Split stem from extension: the extension is the text after the last `.`
   that is not the first character, so `a.b.md` has stem `a.b` and extension
   `md`, and `.env` has no extension. A differing extension subtracts 0.1
   from the final score, never fails the candidate, so `notes.txt` finds
   `notes.md` at 0.9.
3. Score stems by Damerau-Levenshtein similarity, `1 - distance / maxLength`,
   case-insensitive, then apply the extension penalty; keep candidates whose
   final score is at least 0.5. A stem shorter than three characters must
   match exactly, because one edit on two characters scores 0.5 by
   arithmetic and means nothing. The normalized distance gives the threshold
   a subsequence score lacks: a hopeless miss returns nothing.
4. For a candidate below threshold, re-score once with its whitespace- and
   punctuation-separated tokens sorted, so `Notes Standup 2026-09-08.md`
   (0.167 raw) finds `2026-09-08 Standup Notes.md`; character edit distance
   alone does not recover a block move.

The work is bounded, because the scorer runs synchronously on the worker's
event loop and the tool timeout cannot interrupt it. Measured: 10,000
entries of `NAME_MAX` (255) characters against a 255-character request is
650 million DP cells and 5.9 s in Node on one miss; the sample vault (232
names, 24 characters on average) is 2 ms. Two bounds, both stated in the
task: a candidate whose length differs from the request's by more than half
the longer length is skipped before the DP, because the distance is at least
the length difference and such a candidate cannot reach 0.5 (exact, drops
nothing that could qualify, and token sorting preserves length); and the
scoring of one miss, token-sorted retries included, stops at 8,000,000 DP
cells (about 70 ms measured), after which no suggestions are returned, the
same answer the directory-entry budget gives. Names are sorted before
scoring so the budget cuts deterministically. A full 10,000-entry directory
of typical names (10,000 × 24²) scores in about 5.8 million cells, under the
budget.

Top five by score, ties by name. Short names produce false positives at 0.5
(`config` finds `conflict` at 0.625, `ROADMAP` finds `README` at 0.571);
accepted, because the list is a suggestion the model reads, never a path the
tool resolves, and the cap and the single-directory scope bound it. Hand-rolled, about forty lines, no
dependency: the candidate set is one directory and the strings are short.
`fuse.js` (bounded edit distance, zero dependencies, active) is the library
alternative if owning the DP is unwanted; `fastest-levenshtein` is zero-dep
but last published 2022. A miss with nothing above threshold returns the bare
error, per the issue.

The tool description says suggestions may appear, following hermes.

### D5: A `kb://` read tolerates a missing leaf

`executeKnowledge` passes `allowMissing: true` for reads as well as writes.
`resolveKnowledgeHostPath` already walks every existing component with the
symlink refusal and joins the remainder unchecked below the first missing
one; `assertInsideSpace` then proves the nearest existing ancestor is inside
the Space by `realpath`; only then does the native reader open the path and
raise `ENOENT`. The parent directory the suggestion reads is therefore
either that proven ancestor or a directory beneath it that also failed to
exist, in which case D4 reports the parent missing and reads nothing. The
proof is one instant old by the time the parent is opened, and `opendir`
follows links, so D4 `lstat`s the parent and refuses a link immediately
before opening it. That narrows the window to the gap between two syscalls;
it does not close it, because Node exposes no descriptor-relative directory
open (`fdopendir`), so a link planted between the `lstat` and the `opendir`
would be followed. This is the limitation `assertInsideSpace` already
documents for itself (`knowledge-locator.ts:80-88`), and the shipped `kb://`
directory listing runs the same `lstat`-then-`opendir` sequence today
(`read.ts:126`, `directory-listing.ts:106`), so a suggestion read is no wider
than a listing. Planting that link requires write access inside the owner's
own Space directory on the host; such a writer already reads the Space.
Closing the window needs a native addon and is out of scope.

Space-level failures are unchanged and precede all of this: an absent,
removed, or other-owner identifier returns `knowledge_space_not_found` before
any path is resolved, so no suggestion can act as an existence oracle across
owners. Inside the owner's own Space the names listed are the owner's own.

### D6: Errors

Malformed encoding and a decoded `/` are `invalid_path` with the existing
message. A literal `:` in a raw path stays `invalid_path` when its suffix is
not a selector, as shipped, so the "colon rejected" scenario keeps its name
and gains the `%3A` answer.

## Threats

- `%2F` or `%2E%2E` used to leave the Space → split precedes decoding and
  validation follows it; a decoded segment containing `/` is refused; `..`
  is refused by the existing rule; a negative test covers both spellings.
- Suggestions used to enumerate another owner's Space → Space resolution
  fails closed before any path work; suggestions exist only after
  containment of the parent is proven by `realpath`, and a `kb://` parent is
  `lstat`-checked and refused as a link immediately before it is opened.
  Residual: the check and the open are two syscalls, so a link planted
  between them is followed; that needs write access inside the owner's Space
  directory, and it is the window the shipped listing and
  `assertInsideSpace` already accept (D5).
- Suggestions revealing a resolved host path → names only, composed in the
  package from `Dirent.name`; an assertion in the `kb://` test checks the
  message against the configured root.
- A huge parent directory on the error path → one `opendir` bounded by the
  existing `DIRECTORY_TRAVERSAL_BUDGET`; over budget, no suggestions.
- Scoring 10,000 long names blocks the event loop for seconds → the length
  prefilter and the 8,000,000-cell budget in D4; over budget, no suggestions.
- Decoding applied to an absolute path by mistake → decoding lives in
  `parseKnowledgeLocator` only; absolute paths are untouched.

## Migration Plan

1. `encoding` layer: D1, D2, D3, D6. `suggestions` layer: D4, D5. `finalize`.
2. No database change. Persisted locators from before this change are literal
   and still parse, except one carrying a literal `%`, which the new parser
   refuses as malformed; the risk entry below owns that cost.
3. The `read` description changes, so the deploy follows the declaration
   cutover (quiesce, drain, deploy API and worker together, resume). Rollback
   is the reverse, and it breaks every locator the new search emitted with
   `%3A`, `%3F`, `%23`, or `%25`, because the old parser decodes nothing. For
   `%3A` that is the pre-change behavior: the file had no locator before. For
   `?`, `#`, and `%` it is a new break: `validatePath` accepts those
   characters raw, so such a file was addressable by its literal locator
   before the change and its persisted search results stop opening after a
   rollback. Accepted under the pre-launch rule against compatibility paths;
   no such file exists in the sample vault.

## Risks / Trade-offs

- [A filename containing a literal `%` needs `%25`] → documented in the
  description; no such file in the sample vault; the alternative, no
  decoding, costs a round trip on every space.
- [A literal `%20` on disk is now unreachable by its literal spelling] →
  reachable as `%2520`; same trade every decoding parser makes.
- [Suggestions add a directory read to every miss] → error path only, one
  `opendir`, budget-bounded; a successful read is untouched.
- [`allowMissing` on reads widens what a read attempts] → it attempts one
  `lstat`/open on a path whose ancestor is proven inside the Space; the
  write path has run this way since `kb-locator`.
- [This change and #738 both edit `native-file-tools/spec.md`] → different
  requirement blocks; whichever lands second rebases and re-diffs.

## Revision history

- **v4 (2026-09-09):** PR #740 review (Codex, CodeRabbit). Parent-link rule
  scoped: refused when the read refuses links (`kb://`), followed as the read
  would on absolute paths; spec sentence moved into the `kb://` requirement
  (Codex P2, CodeRabbit). D5 no longer claims the `lstat` closes the TOCTOU
  window: narrowed, with the `assertInsideSpace` and shipped-listing
  precedents and the residual stated; atomic no-follow open rejected as
  unavailable in Node (Codex P1, partially accepted). Scoring bound added:
  length prefilter plus an 8,000,000-cell budget, measured (Codex P1).
  Rollback entry covers all four encodings and names the new break for `?`,
  `#`, `%` (Codex P2). D3 states `/` is never encoded; D4 defines the
  decode-failure fallback and task 2.1 tests `100%.md` as a sibling; the
  spec's equivalence rule limited to spellings valid under the grammar;
  proposal says `edit` and `write` use the new parser without suggestions;
  task 3.1 command spelled out; task 3.3 checks status before archiving
  (CodeRabbit). Rejected: person-level owners in `tasks.md` (CONTRIBUTING
  asks for layer ownership, recorded) and post-follow containment for
  absolute-path parents (no Space boundary exists on that scheme).

- **v3 (2026-09-08):** Review round 1 (two independent reviewers). Decoded-`/`
  check moved into the locator parser, per segment, with `notes%2Fsecret.md`
  as the discriminating case (both reviewers). Parent `lstat`-and-refuse
  before the suggestion `opendir` (both). Extension penalty fixed at 0.1
  after similarity, extension defined, two-character stems exact-only, the
  token-sort example replaced by one that is below threshold, short-name
  false positives stated as accepted (hostile P1-4, P2). `readFailure`
  signature named; trailing-separator targets get no suggestions on any
  scheme; decoded exactly once, identifier and selector never decoded;
  neutralizer escaping of reserved-tag names stated (P2s). The
  knowledge-tools scenario that kept its name now has a true body and the
  `:` case is its own scenario. Word "Space" in the no-probe sentence is an
  intended edit, listed here. D2 narrowing of #736 recorded. Migration line
  qualified for literal-`%` locators. Line cites corrected. Peer cites pinned
  to observed commits.

- **v2 (2026-09-08):** D4 scorer replaced after an engine survey requested by
  the owner: fzf-class subsequence matching and the `fff`/`frizbee` native
  engine rejected with reasons recorded in Context; edit-distance pipeline
  (normalize, stem/extension split, Damerau-Levenshtein similarity with a
  0.5 cutoff, token-sorted retry) adopted, hand-rolled.
- **v1 (2026-09-08):** Initial proposal.

## Open Questions

None.
