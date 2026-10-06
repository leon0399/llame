## Context

See [proposal.md](proposal.md) for motivation and the observable contract.
File and line citations are at `master` commit `77e91506`.

The selector grammar has one shape gate, `SELECTOR_SUFFIX` behind
`isSelectorSuffix` (`packages/native-file-tools/src/path.ts:224-229`), and one
applier, `applySelectorSuffix` (`path.ts:232-254`), which turns a validated
suffix into a `ReadTarget` of absolute `{offset, limit}` members
(`path.ts:93-110`, `262-278`). Host, `kb://`, `skill://`, and web all validate
through that gate (`apps/api/src/knowledge/knowledge-locator.ts:47`,
`apps/api/src/skills/skill-locator.ts:51-79`,
`apps/api/src/tools/web-read/locator.ts:270`); only the split is duplicated,
once for host (`path.ts:294-313`) and once for web (`locator.ts:53-69`). Both
splits recognize `:raw` first and claim everything after it, so
`guide.md:60-64:raw` splits into the path `guide.md:60-64` plus `raw`, and the
host reports `not_found` with sibling suggestions while the web fetches a URL
the model never meant.

Every reader after the applier works on absolute members: the single-range
stream (`packages/native-file-tools/src/stream-read.ts:168-194`), the
multi-range walk (`stream-read.ts:196-452`), the Markdown collectors
(`markdown-ancestors.ts`, `markdown-range.ts`), the outline reader
(`markdown-outline.ts`), the in-memory selectors web uses
(`source-lines.ts:58-86`, `stream-read.ts:474`), the directory flat slice
(`directory-listing.ts:332-339`), and the catalog page
(`apps/api/src/skills/skill-results.ts:78-110`). A host regular file never
learns its line count: the stream returns at the window end
(`stream-read.ts:181-187`). Web renders, listings, and the catalog hold their
content in memory and know their count. `kb://` and `skill://` files reach the
same streaming reader through `readResolvedFile`
(`packages/native-file-tools/src/read.ts:117-161`).

A malformed suffix is `invalid_selector` on host and web and `invalid_path` on
`kb://` and `skill://`; the host message is the bare type string
(`path.ts:17-37`, `240-241`), the web message names the working forms
(`locator.ts:166-192`), and the Knowledge and skill messages are generic. The
web message for a bare `12-` or `12+` tells the model to write `:12`
(`locator.ts:166`; the `:12+` case is pinned at `locator.test.ts:300-304`),
and a non-numeric suffix such as `Special:Search` gets only the `%3A` hint
(`locator.ts:184-186`).

Permission admission projects `path` before matching
(`apps/api/src/tools/permissions/locator-projection.ts:38-69`): `kb://` and
`skill://` are re-encoded without their selector, a web locator keeps
`url:selector`, and a direct host path is matched as submitted, selector
included. The runner also evaluates the submitted arguments unprojected and
refuses on any reject that matches them before the projected pass
(`apps/api/src/tools/runner.ts:215-223`). Host evaluation is text-only with no
filesystem probe, no second judgment runs on the path that is finally opened,
and host mutations take their path literally with no selector split
(`packages/native-file-tools/src/mutate.ts`).

The uncommitted draft of `apps/api/src/prompts/tools/read.md` restructures the
tool description after OMP's, lists `:N-M:raw` as working, keeps `:-K` and
`:N-` commented out, and carries commented drafts for vision, video,
`:conflicts`, SQLite, archives, `ssh://`, notebooks, document extraction, and a
`?q=` summary selector.

## Goals / Non-Goals

**Goals:**

- One member grammar — `N`, `N-M`, `N+K`, `N-`, `-K` — accepted wherever a
  member is accepted today, resolved once per source and then handed to the
  shipped readers untouched.
- Both raw orders accepted on every source, with one spelling downstream.
- One error type and one message vocabulary for a malformed selector on every
  source.
- Permission admission that judges the resource, not the selector, on every
  source.
- A model-facing description in which every uncommented form works.

**Non-Goals:**

- A reverse file scan, a tail-specific reader, or any change to how a window
  is rendered once its members are absolute.
- New representation members, heading-name selectors, or changes to outline
  output.
- Any of the commented drafts: vision (#935), `?q=` (#849), `:conflicts`
  (#937), SQLite (#933), archives (#934), `ssh://` (#936), code outlines
  (#801), video (#1072), notebooks (#1073), local documents (#1074).
- A filesystem probe or a second permission judgment on the opened path.

## Prior art

| Source                                                | Observation                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| POSIX `tail -n K`                                     | More lines requested than the file holds prints the whole file; never an error.                                                    |
| OMP `read` description (the draft's model, per #1025) | `:-K` is the last K lines and `:N-` runs to the end; OMP's bare `:N` is open-ended, which llame's single-line `:N` is not.         |
| llame `#705` multi-range selectors                    | Members sort, merge, grow one context line, and re-merge after validation (`path.ts:114-158`); resolution before that step is new. |
| llame `#572` outline scope                            | `:outline:<member>` reuses `parseRange` (`path.ts:246`), so a wider member set reaches it for free.                                |

## Decisions

### D1: Tail and open-ended forms are range members, resolved against the source count

**Decision:** The member grammar becomes `N | N-M | N+K | N- | -K`, one set
for bare lists, `raw:` lists, and the outline member; a `raw:` list therefore
also gains `N+K`, which the shipped gate withholds from it (`path.ts:225`). A
selector carries its members unresolved until the source knows its line (or
entry) count; resolution maps `N-` to `N..count` and `-K` to
`max(1, count-K+1)..count`, after which validation, sorting, merging, context
growth, raw, outline scope, Markdown ancestors, directory slicing, and catalog
paging run exactly as shipped. `requestedRange(s)` report the resolved absolute
lines.

**Alternatives rejected:** `tail` and `openEnded` fields on `ReadTarget`
handled by each reader. Every reader — single stream, multi-range walk, two
Markdown collectors, outline, two in-memory selectors, directory, catalog —
would grow a branch, and `:1-5,-20` or `:outline:-40` would each be a further
branch or a refusal. The issue's worry that combinations multiply the grammar
and tests holds only under that shape.

### D2: Host files count lines with a forward byte pass before the ordinary read

**Decision:** When a selector contains any `N-` or `-K` member, a regular-file
read on host, `file://`, `kb://`, or `skill://` first counts LF bytes through
the file in bounded chunks, derives the native line count (LF count, plus one
when the file is non-empty and does not end in LF, matching
`source-lines.ts:46-49`), resolves the members, and then runs the shipped
streaming reader. The pass runs inside the streaming reader, after the open
handle has passed the regular-file check (`stream-read.ts:509-510`), using
positional reads on that same handle, so a device such as `/dev/zero:-5` is
refused as `not_regular_file` before anything is counted and no second open is
needed. The rule is uniform: a lone `:N-` also
counts, so its `requestedRange` ends at the file's real last line. Web renders,
listings, and the catalog resolve against the count they already hold.

**Alternatives rejected:** A reverse block scan from EOF helps only
non-Markdown single-range tails, because Markdown ranged reads scan forward
from line 1 for ancestor headings (`markdown-ancestors.ts`). A ring buffer of
the last K+1 rendered lines is a third reader path and cannot serve a comma
list. Mapping a lone `:N-` to the existing `limit: undefined` window skips the
count for one spelling at the price of a second code path and a
`requestedRange` that ends at the window rather than the file.

**Trade-off:** A `-K` or `N-` read costs one extra pass over the file. A file
that grows between the passes yields coordinates from the first pass; the
shipped contract already calls coordinates execution-time, not a snapshot.

### D3: Bounds follow `tail`, not the start-past-EOF rule

**Decision:** `-K` with K greater than the count resolves to `1..count`. `-0`
is `invalid_selector`. `N-` with N past the last line resolves to an empty
member and follows each source's shipped past-the-end rule: on a nonempty file
or web render it is `invalid_selector` when it is the first requested start
(`stream-read.ts:353-361`) and is dropped before merging and context
expansion as a later list member — a limit-0 member left in would be reported
as an inverted interval (`source-lines.ts:182-185`) and grown into a stray
context line (`path.ts:149-158`); a comma list whose members all resolve empty
fails as a start past the last line on a nonempty file or web render. On an
empty regular file or web render, `-K` and `1-` return the shipped empty result
(the start-past-EOF rule does not apply to a source with no last line at offset
0); any other `N-` fails as a start past the last line. On a listing or the
catalog it is the empty page those slices already return
(`directory-listing.ts:332-339`, `skill-results.ts:83-90`), and an empty listing
or catalog keeps its empty page for every member. For an empty regular file, an
all-empty comma list starting at line 1 returns plural empty ranges; one
starting later fails as a start past the last line.

**Alternative rejected:** Failing `-K` when K exceeds the count, reporting the
count. The model that asked for "the last 50" of a 10-line file wants the file,
and the resolved `requestedRange` already tells it the file was shorter.

### D4: Both raw orders are one form, canonicalized at the split

**Decision:** The shared shape gate and applier (`path.ts:224-254`) accept
`<list>:raw` as the same selector as `raw:<list>`, which is what lets `kb://`
and `skill://` take it: both split once at the first colon and hand the whole
remainder to that gate (`knowledge-locator.ts:45-47`,
`skill-locator.ts:51-79`). The host and web splitters, which recognize a
trailing `:raw` first, additionally take the colon segment before it when it
has the member-list shape and emit the
canonical `raw:<list>` suffix, so `isRawSelector`
(`apps/api/src/tools/web-read/execute.ts:218-221`), locator projection, the
instruction-file reader (`apps/api/src/instructions/instruction-files.ts:247`), and
every message template see one spelling. Documentation lists `:raw:<ranges>`
first and names `:<ranges>:raw` as the same read. Literal-path precedence is
unchanged: an existing file named `x:60-64:raw` is read as that file. One
meaning changes: `name:10:raw` was the raw read of a literal file `name:10`
and becomes line 10 of `name` raw; such a file is still readable raw as
`name:10:raw:1-N`. A segment without the list shape (`notes:draft:raw`)
stays on the path as today.

**Alternative rejected:** Teaching downstream code both spellings. Every
consumer of the suffix grows a second branch for no observable gain.

### D5: A malformed selector is `invalid_selector` on every source, with one message vocabulary

**Decision:** When a trailing suffix splits off a locator that itself parses
and the suffix is outside the grammar, every source returns `invalid_selector`
with a message built by one shared builder that names the working forms
(`:N`, `:N-M`, `:N+K`, `:N-`, `:-K`, comma lists, `:raw` and `:raw:<list>`,
`:outline:<member>`), carried over from the web builder's shape. On a source
that has an encoded spelling for a literal colon — a `kb://` or `skill://`
resource path, and web — the
message then names the `%3A` spelling of the same locator; host has none
(`%3A` decodes to `:` there), so it names the forms only. This replaces the
web builder's two-tier rule, under which a non-numeric suffix such as
`Special:Search` got the `%3A` hint alone. `invalid_path`
remains the answer for a malformed locator part. The web builder stops
advising `:12` for `12-`, which is now a selector. A
selector the source cannot serve (past the end, no lines) keeps its existing
`invalid_selector` reporting the count.

**Alternative rejected:** Keeping `invalid_path` on `kb://` and `skill://` and
sharing only the message. The spec prose that explains the split
("each source's shipped precedence") exists only to describe an inconsistency;
pre-launch, the contract is cheaper to fix than to document.

### D6: Host diagnosis needs no base-path probe

**Decision:** The host keeps its shipped precedence — literal path first, then
the split — and gains only the shared message. A suffix outside the grammar is
`invalid_selector` whether or not the base path exists; a valid selector on a
missing base stays `not_found` with sibling suggestions. After D4 the
`:60-64:raw` case no longer reaches `not_found`.

### D7: `-K` on a cut web document is refused

**Decision:** When the web plane cut an adapter document at its 5 MiB document
bound, a selector containing a `-K` member returns `representation_too_large`
with a message naming the cut, as `:outline` does today
(`apps/api/src/tools/web-read/result.ts:98-110`). `N-` members are unaffected,
since their start is real and the ordinary truncation note covers the cut. The
ordinary read and `:raw` of the same document keep their shipped behavior.

**Alternative rejected:** Serving the tail of the cut with the existing
`document truncated: too_large` note. The model asked for the end; a note
beside the wrong end is not a refusal.

### D8: Listings and the catalog accept the new members

**Decision:** A directory's requested-level entry count and the skill
catalog's entry count resolve `N-` and `-K` like a file's line count, as flat
slices and as the catalog's single range respectively. The catalog message
that names its accepted forms gains the new ones.

**Alternative rejected:** Refusing the members on listings. The count is in
memory; the exception would exist only to save a sentence of documentation.

### D9: Outline scope accepts the new members

**Decision:** `:outline:N-` and `:outline:-K` scope the outline to the
resolved source lines with the ancestor chain of the first line prepended, as
`:outline:N-M` does. Outline still takes exactly one member and no comma list.

### D10: Permission admission drops the selector on every source

**Decision:** For `read`, every text the evaluator matches for `path` has
its split-off selector removed: the host and web projections, as the
Knowledge and skill projections already do, and the runner's unprojected
submitted-text reject pass (`runner.ts:215-223`), which otherwise keeps a
`:raw` reject effective on every source. A Workspace-relative path is
resolved first and stripped after. Derived web locators (hops, alternates,
probes, adapter targets) and address locators are not stripped: they are
chosen by a server or an adapter, so a hop ending in `:5` is matched exactly
as it will be requested (`apps/api/src/tools/web-read/admission.ts`). `edit` and `write` keep any
selector-shaped suffix in every text they are matched on, decoded alias
included, because a host mutation takes its path literally and
`/srv/app/config.json:1-5` names a different file to it. Evaluation remains
text-only with no filesystem probe. The admission text for
`read("/srv/docs/README:raw")` is `/srv/docs/README`; a web locator is matched
as its canonical URL. The `:` alternative in the default credential rejects
stays load-bearing: F1-F3 also guard `edit`, `write`, and `enter_workspace`,
and a literal colon-bearing name outside the grammar (`/home/u/.ssh:old`)
keeps its suffix in a `read`'s matched text. The canonical scenario heading
"File alias projection preserves the selector" is kept for continuity with its
body inverted; renaming it is left to spec synchronization.

**Threat:** The projection stays text-only, so it trades exactness on both
\*\*sides. An exact allow such as `^/srv/docs/README$` admits a read of a literal
file named `/srv/docs/README:raw` when one exists. An exact reject written for
the resource, such as `^/data/report$`, matches a read of the literal file
`/data/report:2024` after selector removal, so it refuses that read. Conversely,
a reject written for the literal filename, `^/data/report:2024$`, matches
nothing for `read`; it cannot single out that file apart from `/data/report`.
When an allow names `/data/report`, admission succeeds and the executor reads
the literal file. This is the text-only gap the shipped policy already accepts
for `write` rejects; no probe of the filesystem can tell a selector from a colon
in a name, so a rule is scoped to the resource rather than to a selector
spelling.

**Alternatives rejected:** Keeping host and web admission on the submitted
text, which fails exact allows closed on any selector and makes a selector
spelling (`:1-5:raw` versus `:raw:1-5`) policy-relevant; projecting to the
canonical `raw:` text, which matches a string the model never wrote.

### D11: The prompt restructure ships in the prompt-docs layer with every draft owned

**Decision:** The restructured `read.md` is committed in the layer that
documents the grammar, not before. Its `## Selectors` section states the
grammar once; the instruction block stops repeating it. Lines that claim
unshipped behavior are fixed: the elision-footer rule in `<critical>` is
dropped, "Documents → extracted text" is commented, the percent-encoding
line is scoped to `kb://` and web, and the web line "A different spelling is
refused with the canonical one named" is removed, since the parser normalizes
spellings rather than refusing them (`locator.ts:236-251`). Every commented
draft carries
`TODO(#N)` for its owning issue.

### D12: Five layers after the proposal

**Decision:** `grammar` (`packages/native-file-tools`), `sources` (web, `kb://`,
`skill://`, catalog, error unification), `permissions` (projection and the
`tool-call-permissions` delta with its operator doc), `prompt-docs`
(`read.md`, reference docs, CHANGELOG, `Closes #1025`), `finalize`. The
permissions layer is small but changes a second capability's admission
contract, so it is reviewed on its own.

## Risks / Trade-offs

- [Operator rejects anchored on `:raw:`] → After D10 no `read` text reaches
  admission with a selector on any source, the submitted-text pass included;
  such a clause was never a sound guard and now matches nothing, which the
  operator docs state.
- [`https://w.example/wiki/Special:-5` becomes a tail read of `Special`] →
  Consistent with `2024:10` selecting a line; the literal spelling is `%3A-5`,
  and the message for a non-numeric suffix still names it.
- [Negative tests pin the old grammar (`path.test.ts:85`, `88`, `355`; the
  `:12+` message at `locator.test.ts:300-304` and the `Special:Search` hint at
  `305-314`; kb and skill reject lists)] → Each flips in the layer that
  changes the behavior, with the new positive case beside it.
- [A file grows between the count pass and the read] → Both run on one open
  handle, and coordinates are execution-time by contract; the result reports
  what the read pass saw.
- [Two capabilities change in one stack] → The permissions layer carries only
  the projection change and its spec, so the admission contract is reviewed
  apart from the grammar.

## Migration Plan

No data, schema, or configuration migration. The change is a tool-contract
widening plus one admission-text change; deploying the API and worker together
is sufficient, and rollback is a redeploy of the previous build.

## Open Questions

None that change the specs, approach, or layers.
