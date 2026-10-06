## Why

Issue #1025: models already write `:-K`, `:N-`, and `:N-M:raw`, and the draft `read` description documents forms the grammar does not accept. Today `guide.md:60-64:raw` is reported as a missing file, `:-20` and `:50-` are refused with a bare `invalid_selector` on host and with advice to write `:50` on web, and the same mistake on `kb://` is a generic `invalid_path`, so a model that wrote a nearly correct selector learns nothing it can carry to the next call. The description cannot ship until every uncommented form works.

## What Changes

- The member grammar gains `N-` (line N through the last line) and `-K` (the last K lines), and the five members become one set accepted in bare comma lists, `raw:<list>`, and the outline's single member; a `raw:` list therefore also gains `N+K`, which it refuses today. Members are resolved against the source's count — a regular file's line count, a web render's line count, a directory's requested-level entry count, the skill catalog's entry count — and then the shipped sorting, merging, context, raw, outline, Markdown-ancestor, bound, and `nextOffset` rules apply unchanged. `requestedRange(s)` report the resolved absolute lines.
- `-K` larger than the source clips to line 1; `-0` is `invalid_selector`; `N-` past the end resolves to an empty member and follows the source's shipped past-the-end rule (`invalid_selector` as a nonempty file's or render's first requested start, nothing as a later list member, the empty page on a listing or the catalog); on an empty regular file or web render, `-K` and `1-` return the shipped empty result because the start-past-EOF rule does not apply to a source with no last line at offset 0, while any other `N-` fails as a start past the last line; an all-empty regular-file comma list starting at line 1 returns plural empty ranges and one starting later fails.
- A regular-file read on host, `file://`, `kb://`, or `skill://` whose selector contains `N-` or `-K` counts the file's lines in one forward pass on the open handle, after the regular-file check and before the ordinary read; the pass is uniform, including a lone `:N-`.
- `:<ranges>:raw` is accepted as the same read as `:raw:<ranges>` on every source, through the shape gate every source validates against; `:raw:<ranges>` remains the canonical spelling. Literal-path precedence is unchanged.
- **BREAKING** for `kb://` and `skill://` callers that matched the error type: a suffix outside the grammar, split off a locator that itself parses, is `invalid_selector` on every source, with one message that names the working forms and, on a `kb://` or `skill://` resource path and on web, the `%3A` spelling of the same locator after them. `invalid_path` remains the answer for a malformed locator part. The web hint that answered `:12-` with "write `:12`" is retired, since `:12-` is now a selector, and the web hint that answered a non-numeric suffix with the `%3A` spelling alone now names the forms first.
- A `-K` member on a web adapter document the web plane cut at its document bound returns `representation_too_large` naming the cut, as `:outline` does; `N-` and ordinary reads of the cut document are unchanged.
- **BREAKING** for operator policies that matched a selector: for `read`, every text permission evaluation matches for `path` — the host and web projections and the runner's submitted-text reject pass — drops the split-off read selector, as `kb://` and `skill://` projection already does; a Workspace-relative path is resolved first and stripped after, and derived web locators and address locators are matched exactly as requested. `edit` and `write` keep any selector-shaped suffix in every text they are matched on, because a host mutation takes its path literally. Evaluation stays text-only with no filesystem probe; an exact allow therefore admits the allowed path with any read selector, and a `$`-anchored reject catches its path with any read selector.
- The model-facing `read` description ships its restructured `## Selectors` section with every uncommented form working, states the grammar once, drops the elision-footer rule, comments the document-extraction claim, scopes percent-encoding to `kb://` and web, removes the claim that a differently spelled web locator is refused, and tags every commented draft with its owning issue (#935, #849, #937, #933, #934, #936, #801, #1072, #1073, #1074).
- `docs/product/reference/selectors.md`, the locator reference pages, and the operator permission and web-read runbooks describe the new grammar, the unified error, and the admission change.

## Assumptions, confirmed with Leo (2026-10-02)

Decisions Q1-Q15 of the grilling session on #1025: members resolved before the shipped pipeline (Q1); clip on `-K` over-length (Q2); `invalid_selector` on every source (Q3); canonical `raw:` spelling and selector-free admission on every source (Q4, Q9); refusal of `-K` on a cut web document under `representation_too_large` (Q5, Q14); listings, the catalog, and outline scope accept the members (Q6, Q7); the draft-prompt defects are fixed in this change and the restructured prompt lands in the prompt-docs layer (Q8, Q10); orphan drafts received issues #1072, #1073, #1074 (Q11); a uniform forward count pass (Q12, Q13); a separate permissions layer (Q15).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: the selector grammar (`N-`, `-K`, both raw orders), resolution against each source's count, the unified `invalid_selector` contract and message vocabulary across host, `file://`, `kb://`, `skill://`, and web, the multi-range, Knowledge-locator, skill-locator, and web-locator grammar statements, the outline scope member, the media-type/member representation-selection requirement and its selector-free admission scenario, and the cut-document refusal for `-K` on web adapter results.
- `tool-call-permissions`: for `read`, the submitted-text pass, the Workspace projection, and the direct host, file-alias, and web projections drop the split-off read selector before matching ("Match submitted string values without serialization artifacts" and "File permission matching uses logical resource locators", with the literal-filename and file-alias scenarios restated and mutation and Workspace-relative scenarios added), and the portable-policy runbook mandate names the selector-free matched text ("Recommended portable policy with explicit replacement").

Deliberately unchanged: the directory-listing requirements (the resolution rule in the selector requirement covers the requested-level count), outline output, Markdown ancestors, web fetch bounds, the portable policy's reject terminators, and `workspace-entry`'s projection rule, whose resolved absolute path remains the text both execution and permission evaluation start from; what the evaluator then removes from a `read` text is `tool-call-permissions`' contract.

## Impact

- `packages/native-file-tools/src/path.ts` owns the grammar, the split, and `ReadTarget`; `stream-read.ts`, `source-lines.ts`, `markdown-ancestors.ts`, `markdown-range.ts`, `markdown-outline.ts`, `directory-listing.ts`, and `read.ts` consume resolved members and gain the count pass and the shared message.
- `apps/api/src/tools/web-read/locator.ts`, `result.ts`, and `execute.ts`; `apps/api/src/knowledge/knowledge-locator.ts`; `apps/api/src/skills/skill-locator.ts` and `skill-results.ts`; `apps/api/src/tools/native-files.ts` (catalog window and error results); `apps/api/src/tools/permissions/locator-projection.ts` and `apps/api/src/tools/runner.ts` (the submitted-text reject pass).
- `apps/api/src/prompts/tools/read.md`; `docs/product/reference/selectors.md`, `docs/product/reference/locators/{index,host-path,kb,skill,web}.md`, `docs/product/reference/tools/read.md`; `docs/product/operator/tool-call-permissions.md` and `docs/product/operator/web-read.md` (which states today that a web locator is matched with its selector kept); `CHANGELOG.md`.
- Tests that pin the old grammar negatively flip in their owning layer: `packages/native-file-tools/src/path.test.ts`, `apps/api/src/tools/web-read/locator.test.ts`, `apps/api/src/knowledge/knowledge-locator.test.ts`, `apps/api/src/skills/skill-locator.test.ts`, `apps/api/src/tools/native-files.test.ts`, `apps/api/src/tools/permissions/locator-projection.test.ts`, `apps/api/src/tools/runner.test.ts`, `apps/api/src/instructions/instruction-files.test.ts` (a `^<file>:raw:` reject pin); the shared gate's `apps/api` pins (`locator.test.ts:332-336`, `native-files.test.ts:1533-1542`) flip in the grammar layer so its published head stays green.
- No dependency, schema, migration, configuration key, or new authority. The `tools.permissions` shape is unchanged; only the text a host or web clause sees changes.

## Non-Goals

- A reverse file scan, a tail-specific reader, or a count-free path for any form.
- New representation members, heading-name selectors, a filesystem probe during admission, or a second permission judgment on the opened path.
- Any commented draft in the `read` description: #935, #849, #937, #933, #934, #936, #801, #1072, #1073, #1074.

## Acceptance

- `read("/abs/notes.md:-20")` on a 500-line file returns lines 481-500 with the ordinary context line at 480 and `requestedRange {481, 500}`; `:-900` on the same file returns lines 1-500; `:-0` is `invalid_selector`.
- `read("/abs/notes.md:50-")` on a 3,000-line file returns lines 50 through 2,049 with `requestedRange {50, 3000}`, `truncated: true`, and a `nextOffset` from which `:2050-` continues.
- `read("/abs/notes.md:1-5,-20:raw")` and `read("/abs/notes.md:raw:1-5,-20")` return identical verbatim content; `read("/abs/notes.md:outline:-200")` returns the outline of the last 200 source lines with its ancestor chain.
- `read("kb://<id>/notes.md:5-")`, `read("skill://<name>:-10")`, `read("https://example.test/guide:-40")`, `read("/var/log/:-20")`, and `read("skill://:-10")` resolve against their source's count under the same rules.
- `read("kb://<id>/notes/a:b.md")`, `read("/abs/notes.md:nonsense")`, `read("https://example.test/guide:12+")`, and `read("https://w.example/wiki/Special:Search")` each return `invalid_selector` with the one message naming `:N`, `:N-M`, `:N+K`, `:N-`, `:-K`, comma lists, `:raw`, and `:outline`; the `kb://` and web messages then name `a%3Ab.md` and `Special%3ASearch` (a `skill://` resource path likewise), the host message names nothing more; `read("https://example.test/guide:12-")` returns lines 12 to the end.
- `read("https://github.com/o/r/issues/1:-40")` on a thread the web plane cut at 5 MiB returns `representation_too_large`; `:1-40` and `:raw` of the same locator keep their shipped results.
- With only `^/srv/docs/README$` allowed, `read("/srv/docs/README:raw")` is admitted; with `^/home/u/\.ssh/id_rsa$` rejected, `read("/home/u/.ssh/id_rsa:1-5")` is refused; a reject written against `:raw` matches no read on any source, the submitted-text pass included; with only `^/srv/app/config\.json$` allowed for `write`, `write("/srv/app/config.json:1-5")` is refused as `no_allow`.
- The shipped `read.md` has no commented `TODO` without an issue number and no uncommented form that fails; `pnpm exec openspec validate read-selector-members --strict` and `pnpm lint:markdown` pass on the proposal layer.
