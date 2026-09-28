## Context

See [proposal.md](proposal.md) for motivation and issue decisions. This
change owns plane 2 of the approved three-plane read architecture. The
`file-locator` sibling owns the source plane and the architecture section;
`read-representations` owns the representation plane. Plane 2 receives an
already canonical, admitted HTTP(S) source locator, obtains bounded content,
and returns the existing native read envelope to the shared selector stage.

The current seam is deliberately small. `WebReadDeps` injects the parser,
fetch session, renderer, result builder, transport, and resolver
(`apps/api/src/tools/web-read/execute.ts:22-29`); `fetchAndRender` creates one
session, derives admission and address admission, fetches once, renders, and
builds the result (`execute.ts:105-145`). The pipeline exposes a fixed method
list (`pipeline.ts:10-22`), short-circuits `:raw` before probes
(`pipeline.ts:104-115`), and orders alternate, suffix, local render,
`llms.txt`, and raw (`pipeline.ts:123-180`). The fetch session shares one
30-second deadline and redirect counter across probes
(`http-client.ts:72-90`, `436-452`); the transport issues `GET` only
(`connection.ts:212-216`). Derived admission currently enumerates hops,
alternates, suffixes, `llms.txt`, and addresses and decides each before I/O
(`admission.ts:12-18`, `145-159`). The result builder reserves the native
result envelope before applying selectors and bounds (`result.ts:26-73`).

The config loader resolves `tools` as one typed object
(`apps/api/src/instance-config/config-loader.ts:177-203`) and uses single-pass
interpolation with value-free errors (`config-loader.ts:588-627`). `tools`
currently has no web adapter field
(`apps/api/src/instance-config/llame-config.ts:427-446`), so this change adds
the consumer-owned field and schema entry rather than a second configuration
source.

Prior art was inspected in `agent://OmpReadPrior/report` and rechecked at OMP
HEAD `09e7bf6564bb7a818d503076dfa595ad0018fa0d`. Two OMP surfaces matter.
The `pr://` and `issue://` internal URLs render a fixed Markdown layout from
`gh` JSON: a title line, `Key: value` metadata, `## Body`, then `## Files`,
`## Reviews`, `## Review Comments`, and `## Comments` sections
(`packages/coding-agent/src/tools/gh-view.ts:339-440`). They load every
comment and review-comment page (`gh-view.ts:176-219`), cut only the file
list at 50 entries, put the diff at a separate address, and can afford to
load everything because the rendered document is cached in SQLite across
sessions (`tools/github-cache.ts`). The web scraper for `github.com` URLs is
thinner: one renderer for issues and pull requests with no review comments
(`web/scrapers/github.ts:189-240`), blobs through
`raw.githubusercontent.com` (`:107`, `:710-726`), commits with full patches
from a single request (`:259-321`), and a first-segment ref parser that
mis-splits branches containing `/` (`:57`). Its `SpecialHandler` returns
`null` for both mismatch and failure (`web/scrapers/types.ts:13-29`,
`tools/fetch.ts:1031-1049`). This design takes the `pr://` layout and the
load-everything rule, replaces the session cache with the ordinary `:N-M`
window over a refetched document, separates pure matching from network work,
makes fallthrough explicit, and does not copy OMP's credential-from-environment
policy.

Live probes on 2026-09-27 supplied the GitHub protocol evidence.
`https://github.com/leon0399/llame/pull/990.diff` answers `302` to
`https://patch-diff.githubusercontent.com/raw/leon0399/llame/pull/990.diff`,
which serves `text/plain` (151,776 bytes); `commit/<sha>.diff` serves
`text/plain` from `github.com` directly. `GET
/repos/leon0399/llame/git/trees/master:apps/api?recursive=1` returns 850
entries in 200 KB and the whole repository tree returns 3,827 entries in
1.0 MB with `truncated: false`. `GET /git/matching-refs/heads/web-read`
returns `refs/heads/web-read-adapters/proposal`, so prefix matching crosses
segment boundaries. The contents endpoint answers `404` both for a missing
ref (`No commit found for the ref feature`) and a missing path (`Not Found`),
distinguishable only by body; a short SHA (`c91b31c`) is accepted as `ref`.
The unauthenticated quota on the probing machine's shared egress address was
already exhausted by unrelated traffic, which is the operational case for the
operator token.

## Goals / Non-Goals

**Goals:**

- Add one traceable adapter stage between admitted source resolution and the
  existing ladder without changing selectors, result bounds, or address
  admission.
- Make every secondary origin explicit, independently admitted, and visible in
  provenance.
- Enable nothing by default, make delegated routes explicit operator
  attestations, and keep adapter failures non-fatal unless the shipped call
  bound or source request itself ends the call.
- Render GitHub issues and pull requests in the layout a coding agent already
  reads in oh-my-pi, so the model reads a pull request the way it reads a file:
  whole, paged by `:N-M`.
- Give implementation layers stable interfaces and fixture-server seams so
  each adapter can be verified without live third-party dependence.

**Non-Goals:**

- A runtime plugin loader, dynamic module registry, code-owned third-party
  protocol, per-entry request headers, GitHub Enterprise, Telegram, GraphQL,
  a `POST` transport, anchor fragments, forced adapter selection, a `json`
  representation, or a new web tool id.
- Changing the generic status-error body contract, the #914 address policy, or
  the representation slot owned by the sibling change.

## Decisions

### D1: Place adapters after source admission and before the generic ladder

**Decision:** Parse, canonicalize, and admit the submitted HTTP(S) source as
shipped. If the selector is `:raw`, fetch and return the response without
running adapters. Otherwise run the ordered adapter list from
`tools.webAdapters`, then the existing negotiated/alternate/suffix/
Readability/`llms.txt`/raw ladder. A URL an adapter's `match` accepts is
_claimed_; a URL every `match` rejects is _unclaimed_ and reaches the ladder
with no adapter request and no note, exactly as today.

**Alternative rejected:** Put each adapter inside one generic ladder slot, or
let adapters replace the source executor. The former makes source-specific
matching depend on body content and makes `:raw` ambiguous; the latter would
bypass the existing shared session and address admission.

**Consequence:** A source URL is admitted once before matching, but every
adapter-derived URL is admitted again. Generic behavior remains observable
when nothing claims or when an adapter fails. The `file-locator` and
`read-representations` changes can compose around this stage without knowing
site protocol details.

### D2: Use a typed contract with pure match, two route kinds, and explicit fallthrough

**Decision:** Each static entry has `id`, pure synchronous `match(url)`, a
route kind, declared origins, a bounded request/render path, and an explicit
outcome. Route `native` fixes first-party origins in code; `rewrite` takes a
validated literal-origin operator target and uses the local negotiated/text
or Readability renderer. Failure categories are `permission`, `address`,
`status`, `rate_limit`, `transport`, `parse`, `empty`, `binary`,
`too_large`, and `content_type`. Transport notes use only the bounded named
classes `dns`, `tls`, `connect`, `reset`, or `other` when the runtime can
classify them; they never forward a platform exception string.

Failure has two shapes. When the primary request of a claimed URL fails, the
adapter records a bounded note naming itself and the category and falls
through to the next matching entry, then the generic ladder. When the primary
request succeeded and a later request for the same document fails (a comment
page, a check-runs page, or the README), the adapter renders what it has and
attaches one note per missing section, such as
`review comments omitted: rate_limit, resets 2026-09-27T12:40:00Z`; D9 owns
how the `Checks:` line renders its failure states. No adapter failure returns
a response body to the model.

**Alternative rejected:** OMP's combined `SpecialHandler` returning `null` on
both mismatch and failure. It makes a handler's precedence and failure reason
invisible. All-or-nothing on secondary failure was also rejected: it discards
a pull request whose title, body, and head were already fetched in favor of
Readability output of GitHub's page chrome, which is the case #939 exists to
avoid. A `service` route kind with code-owned third-party protocols was
drafted and cut: a rewrite pointed at such a service reads its JSON through
the generic text path, and a protocol-specific renderer has no second caller.

**Consequence:** The implementation can test matching with zero I/O, test each
failure category against a local fixture, and prove that a refusal does not
become a network attempt. Adding an adapter is a module, a static entry,
tests, and a spec delta, not a runtime plugin surface.

### D3: Admit every derived adapter locator independently

**Decision:** An API URL, a rewrite target, and every redirect hop are full
derived locators. The same evaluator and projection run before each request,
followed by the same resolver and pinned address admission. The decision does
not inherit the source URL's allow, and an adapter request that is refused
disqualifies only that adapter. A domain allowlist therefore must admit
`https://api.github.com/` for the GitHub adapter to run; without it the adapter
falls through with `permission`. The adapter never requests
`patch-diff.githubusercontent.com`; it only renders a `Diff:` URL. That host
is needed only when the model separately reads the rendered `Diff:` URL
through the generic ladder, because the `.diff` URL 302-redirects there.

**Alternative rejected:** Inherit the source decision. That turns a source
allow into an egress grant and makes prompt-injected or server-chosen targets
escape operator policy.

**Consequence:** The adapter can never contact `api.github.com` or a rewrite
origin merely because the source matched. Adapter decisions use the `adapter`
provenance kind; address decisions remain `address` and never expose resolved
addresses.

### D4: One adapter credential, scoped to `api.github.com`, stripped on redirects

**Decision:** The GitHub token is the only adapter credential in this change.
It is attached only to requests whose origin is `https://api.github.com` and
removed before any hop to another origin. Rewrite entries carry no headers.
Submitted source and generic ladder requests send no adapter credential.
Token presence and value never appear in notes, errors, decisions, or model
output.

**Alternative rejected:** Per-entry interpolated `headers` on rewrite entries,
with reserved-header validation and literal-versus-interpolated redaction
rules. No current rewrite target needs a credential, and the feature brought a
class of secret-leak paths and four config scenarios with it. Adding headers
later changes no existing configuration.

**Consequence:** One origin comparison covers every credential decision, and
the negative tests are two: a redirect from `api.github.com` to another origin
captures no token, and a rewrite target never receives one.

### D5: Add `method: "adapter"` and a structured adapter object

**Decision:** Keep the shipped closed `WebRenderMethod` values for generic
stages and add `adapter` as the one method for all adapter successes. Add
`adapter: { id, route, origin? }`: native entries omit `origin`, rewrite
entries report their target origin. `finalUrl` stays the source URL for every
adapter success. Notes say when content came through an operator-configured
origin.

**Alternative rejected:** Encode each adapter as a new union value such as
`github`, or prepend a text header. Per-adapter method values grow a closed
union and make generic consumers branch for every site; a text header
pollutes source lines and selector coordinates.

**Consequence:** Consumers branch once on `method: "adapter"` and inspect
stable structured provenance. The result envelope reservation grows by the
adapter fields, so a long adapter render truncates content before dropping
provenance. The object is stored in tool parts and is the one part of the
contract that is expensive to change; the internal types are not.

### D6: Preserve status-error secrecy while classifying rate limits

**Decision:** The generic HTTP client keeps the shipped rule that a non-2xx
status returns no body and no headers other than `Retry-After`
(`openspec/specs/native-file-tools/spec.md:1190-1196`). An adapter may inspect
status and the bounded headers `retry-after`, `x-ratelimit-remaining`, and
`x-ratelimit-reset`. GitHub rate limit means `429`, or `403` with
`x-ratelimit-remaining: 0` or `retry-after`; `x-ratelimit-reset` only adds
reset metadata. It becomes a `rate_limit` note and fallthrough or a
per-section omission, not a model-visible body or permission error.

**Alternative rejected:** Return bounded error JSON to the model, or map every
403 to permission denied. The former changes the #930-sensitive status-body
contract; the latter mislabels rate exhaustion.

**Consequence:** A generic status error still ends the call as shipped. A
claimed URL can fail without hiding a usable generic representation, and its
note contains only category and bounded reset metadata.

### D7: Load everything, bound by time and size, page with `:N-M`

**Decision:** An adapter loads its whole document: every comment, review,
review-comment, and file page of a pull request, the whole two-level tree of
a directory. There is no adapter request cap. The bounds are the shared
30-second call deadline, the 5 MiB per-response body bound, and a 5 MiB bound
on the rendered adapter document. Reaching a bound after the primary request
succeeded renders what arrived with an omission note (D2). The model pages the
rendered document with the ordinary `:N-M` selector; each page refetches, and
the tool does not promise that two reads return the same text, as shipped.

**Alternative rejected:** A fixed request cap of eight with head-and-tail
paging and continuation markers. It needed a universal thread-paging contract
before a second thread-rendering adapter exists, and it cut long threads at
exactly the end the model needs most. A per-Run cache of the rendered
document, which is how OMP affords load-everything, was deferred: it adds
worker state and changes the shipped refetch rule, so it needs its own change
if quota use shows the need.

**Consequence:** A normal issue or pull request loads completely in a handful
of requests. Paging a very long thread unauthenticated spends the instance's
60-per-hour GitHub quota on every page; the runbook says to configure a token
when reading long threads or when llame shares its egress address. A future
nested-thread adapter (Reddit, Hacker News, X replies) chooses its own
strategy, such as top-level items with score and reply count so the model
opens subthreads itself; that is guidance here, not a requirement.

### D8: Build a typed document and render it; `:json` comes later

**Decision:** The GitHub adapter normalizes each REST response into a typed
document per shape (`repository`, `tree`, `blob`, `commit`, `issue`, `pull`,
`comment`, `review`, `reviewComment`), and one deterministic renderer turns
the document into Markdown. The schema is internal. When eval cells land
(#833), `json` becomes a member of the representation slot owned by
`read-representations` (#989): it returns the whole document or fails with
`too_large`, because a JSON body cannot be line-paged, and publishing it fixes
the schema.

**Alternative rejected:** Render Markdown straight from API responses, as OMP
does; adding `:json` later would rewrite every renderer. Shipping `:json` now
was also rejected: its only consumer is unbuilt, and it would couple this
change to two unmerged proposals.

**Consequence:** Normalization and rendering test separately, a fixture can
assert the document and the text independently, and the later nested-thread
layout (D7) becomes a renderer option rather than a second fetch path.

### D9: Render issues and pull requests in the `pr://` layout, over REST only

**Decision:** The issue and pull request views follow OMP's `formatIssueView`
and `formatPrView` (`gh-view.ts:339-440`): a `# Pull Request #N: title` line,
`Key: value` metadata, `## Body`, `## Files (n)` listing every changed file
with status and counts, `## Reviews (n)`, `## Review Comments (n)`, and
`## Comments (n)`. Every comment-like item is one `### author · timestamp`
heading at the same depth, in source order, with `ID:`, `Reply to:` (when
present), `Location: path:line` and `Side:` (review comments), and `URL:`
lines, then the body. Three lines are added to the metadata block:
`Reviews: 2 approved, 1 changes requested (latest per reviewer)` in place of
OMP's `Review decision`, `Checks: 14 passed, 1 failed (lint), 2 pending` from
all pages of `GET /repos/{o}/{r}/commits/{head_sha}/check-runs` requested with
`filter=latest&per_page=100`, reduced to counts, and `Diff: https://github.com/{o}/{r}/pull/{n}.diff`.
GitHub returns at most the 1000 most recent check suites, so the counts cover
what the endpoint returns. A check-runs page that answers but cannot be
parsed counts as not arriving, the same as a failed page, because the line can
only count runs it parsed; a first page without a numeric `total_count` counts
the same way. If a page after the first does not arrive, the `Checks:` line
states the loaded counts plus `total_count` minus the loaded runs (for example
`Checks: 97 passed, 1 failed (lint), 2 pending, 40 not loaded`); if the first
page does not arrive, it renders `Checks: unavailable`, never invented zero
counts. Every such case adds an omission note naming check runs and its
category: `parse` for an unparsable page or missing `total_count`, otherwise
the failed request's category. `Merge state` renders `mergeable_state` as
returned, including `unknown`. Minimized comments render like any other
comment. There is no events section.

Endpoints: `GET /repos/{o}/{r}/issues/{n}` plus all pages of
`/issues/{n}/comments`; `GET /repos/{o}/{r}/pulls/{n}` plus all pages of
`/issues/{n}/comments`, `/pulls/{n}/reviews`, `/pulls/{n}/comments`, and
`/pulls/{n}/files`, plus all pages of `/commits/{head_sha}/check-runs`
requested with `filter=latest&per_page=100`. All requests carry `Accept:
application/vnd.github+json` and are `GET`.
The check-runs pages use the shared call deadline and 5 MiB document bound
like every other list.

**Alternative rejected:** GraphQL for `reviewThreads` resolution state and
`reviewDecision`. It needs a token the default configuration lacks, a `POST`
transport in `connection.ts`, and a dual-admission rule for the endpoint; it
is #996. Heading depth for reply nesting was rejected because Markdown has six
levels and Reddit threads do not. Rendering patches inline or claiming
`/pull/{n}/files` was rejected: GitHub already serves the diff as text at
`.diff`, the generic ladder reads it today, and the `Diff:` line steers the
model there.

**Consequence:** Token and no-token output have the same shape. The model
learns one layout for GitHub that it may already know from OMP. The adapter
never requests `patch-diff.githubusercontent.com`; it only renders the
`Diff:` URL. When the model separately reads that URL through the generic
ladder, the `.diff` URL 302-redirects to that host, so its admission is
needed then. The `/pull/{n}.diff` and `.patch` shapes are unclaimed on
purpose, and the grammar says so.

### D10: Read code through the contents and trees endpoints, in the local listing shape

**Decision:** A blob requests
`GET /repos/{o}/{r}/contents/{path}?ref={ref}`, decodes the JSON contents
object from base64, and renders valid UTF-8 text line-for-line without a
heading, so `:N-M` addresses source lines. NUL bytes, invalid UTF-8,
`encoding: none`, empty content for a large file, or a declared size over the
body bound are `binary` or `too_large` and fall through. A directory requests
one `GET /repos/{o}/{r}/git/trees/{ref}:{path}?recursive=1` (the root:
`git/trees/{ref}?recursive=1`), filters the flat result to the requested
level and one child level, and renders the local directory listing shape: the
requested level, then each child directory's first 20 entries followed by
`… N more`, with the same `… N entries`, truncation, and range-selector rules
as a host directory read. A response over 5 MiB is `too_large` and falls
through (GitHub itself truncates only above 7 MB, so its `truncated` flag
cannot survive that bound), and symlink and submodule entries use the host
`@` and `?` markers. A root over the host per-directory entry budget keeps
its metadata and README and replaces the listing with a `tree omitted:
too_large` note.
The repository root renders `Description`, `Default branch`,
`Visibility`, and `Language` lines from `GET /repos/{o}/{r}`, then the
two-level root listing, then `## README` from `GET /repos/{o}/{r}/readme`
decoded. A commit requests `GET /repos/{o}/{r}/commits/{sha}` and renders
message, author, timestamp, a file list with counts, and
`Diff: https://github.com/{o}/{r}/commit/{sha}.diff`; patches are not
rendered.

**Alternative rejected:** Fetching `raw.githubusercontent.com`, calling `gh`,
or one contents request per child directory. The raw origin complicates token
scoping and fails the text gate on binaries; `gh` introduces process and
credential behavior outside the read HTTP contract; per-child contents costs
`1 + N` requests where the recursive tree costs one and gives exact counts.

**Consequence:** Every directory costs one request, the root three. Two
bounds apply in order. The host per-directory entry budget (10,000 entries at
the requested level) binds first: a non-root directory over it ends with the
host's `directory_too_large`, and an over-budget root keeps its metadata and
README with a `tree omitted: too_large` note. A subtree whose JSON exceeds
5 MiB (on the order of 20,000 entries in total; GitHub's own cut-off is
100,000 entries or 7 MB) falls through to the generic ladder as `too_large`.
A fallback to per-child requests is added only if a real repository needs it. The model browses root → `tree/main/src` → `blob/main/src/a.ts`
inside the adapter.

### D11: Resolve refs containing `/` by trying first, then `matching-refs`

**Decision:** A blob or tree URL does not mark where the ref ends and the path
begins. The adapter tries the first path segment as the ref. On a `404` with
segments remaining, it requests `GET /git/matching-refs/heads/{segment}`, then
`/tags/{segment}` if heads yield nothing; a candidate is acceptable only when
it equals the remainder or is followed by `/` in it, and the longest
acceptable candidate wins; the contents or tree request is retried at that
ref. A 40-character hexadecimal first segment is a SHA and skips the lookup; a
shorter hexadecimal segment is tried like any ref, which the API accepts. A
`404` with nothing left to split is a `status` failure. Worked cases:
`blob/main/src/a.ts` costs one request; `blob/feature/foo/src/a.ts` on branch
`feature/foo` costs three; a tag `feature/foo` costs four.

**Alternative rejected:** Always look up refs first. It never returns the
wrong file but costs one or two extra requests on every read against the
60-per-hour unauthenticated quota.

**Consequence:** One documented limit: when a tag `v1` and a branch `v1/x`
both contain the requested path, `blob/v1/x/README.md` returns the tag's file
with no signal, because the first attempt succeeds. Git forbids a branch `v1`
beside `v1/x`, so the case needs a tag and a branch sharing a prefix and a
path. The spec records it as a scenario.

### D12: Rewrite is a bounded local route with two placeholders

**Decision:** A `rewrite` entry declares exact canonical `hosts` and an
optional `pathPattern`. When present, `pathPattern` is an RE2-compatible
regular expression compiled by the same bounded matcher `tools.permissions`
uses, searched unanchored against the canonical path. Its `target` is a
literal `http(s)` origin with no placeholder in scheme, host, or port, no
userinfo, and no fragment, followed by a path/query template. `{path}` is
allowed only in the path and inserts the canonical source path as-is;
`{query}` inserts `encodeURIComponent` of the canonical query without its
`?`. Each target is rebuilt per call, revalidated against the declared origin
and literal path prefix, admitted, and address-pinned. It is fetched once
using only the negotiated/text or Readability stages, without alternate,
suffix, or `llms.txt` probes; a raw, challenge, or failed render falls
through. Provenance reports `route: "rewrite"`, the target origin, and the
source URL as `finalUrl`; a note states that content came through the
configured origin. The runbook example is
`{ hosts: ["x.com", "twitter.com"], pathPattern: "^/[^/]+/status/\\d+$", target: "https://x.pcstyle.dev{path}" }`.

**Alternative rejected:** `{host}` and `{url}` placeholders, and a
`?url=`-style target. `{url}` is the widest model-controlled egress channel
and no current target needs it; the first target that does adds it with its
own encoding tests. Operator-supplied code, parsers, or unvalidated origins
remain rejected.

**Consequence:** x.com has no third-party default. An operator who wants it
attests to one origin, sees the leak in the runbook and result notes, and
removes the entry to disable it. Path text remains a model-chosen egress
input, so source and target both require admission.

### D13: Make config absence mean none and presence an exact list

**Decision:** `tools.webAdapters` is an optional closed array. Absent selects
`[]`; present means exactly the listed entries, in order. Every entry has a
required unique `id` and a `use` of `github` or `rewrite`; the `contract`
layer accepts `rewrite` only and `github-threads` adds `github`. The GitHub
`token` uses the existing interpolation resolver; a literal token fails boot.
Non-secret fields (`hosts`, `pathPattern`, `target`) are validated as
authored; `pathPattern` uses the same bounded matcher as `tools.permissions`
and is searched unanchored against the canonical path, while an interpolation
token in them fails boot. Unknown uses, duplicate ids, unknown fields, and
invalid, oversized, or unsupported patterns fail boot before any request.

**Alternative rejected:** Enabling `github` when the key is absent. It would
make an upgrade start contacting `api.github.com` on every instance with an
open read policy, and it makes "on by default" a per-adapter decision instead
of one rule. Merging operator entries into built-in defaults was rejected
because it makes disabling and ordering ambiguous.

**Consequence:** An upgrade changes nothing until an operator lists an entry.
The `id` field does real work once two rewrites match the same host: first
match wins, a failed match falls through to the next, and notes name the entry.

### D14: Keep the implementation static rather than runtime-loadable

**Decision:** The list is a code-owned TypeScript array with interfaces;
configuration selects known `use` values and data, never modules or code.
Operator-declared rewrite maps are supported as data.

**Alternative rejected:** Dynamic import, executable config, or an
operator-supplied parser URL. Those expand the boot and egress trust boundary
and make permission review impossible from source.

**Consequence:** A new adapter is a module, a static entry, tests, and a spec
delta.

### D15: Threat model both directions and rely on address admission

**Decision:** Treat fetched content as untrusted: adapter Markdown and
rewrite responses can contain prompt injection, so notes and provenance are
data, not instructions. Treat model-authored source path and query text as
outbound egress: a page can instruct the model to encode conversation text in
a URL, but every source and derived request still passes the operator `read`
group and address admission. The adapter layer adds no host bypass, no
universal private-address block, and no publisher trust claim.

**Consequence:** Operators using domain allowlists must list
`api.github.com` for GitHub adapter use and each rewrite origin.
`patch-diff.githubusercontent.com` is needed only when the model separately
reads the rendered `Diff:` URL through the generic ladder, because the
`.diff` URL 302-redirects there. A model can still request an allowed
exfiltration URL by design; the runbook states that `read` policy is the
outbound boundary.

### D16: Resolve the #939 acceptance narrowing as cross-issue bookkeeping

**Decision:** Do not reinterpret fragments in this change. Before the
`github-code` layer closes #939, it posts an issue comment that moves
`#L10-L40` to #927, review-thread resolution state and `reviewDecision`
to #996, and issue/pull request list URLs to #995, and records the REST
shape (`Reviews:` per-reviewer counts, `Merge state` as returned) as the
shipped acceptance. Issue #939 then closes against its narrowed acceptance.

**Consequence:** #939's native adapter is complete for the shapes it claims.
The comment is a required delivery task, not an implementation workaround.

## Risks / Trade-offs

- [A model can prompt-inject a rewrite URL or a source page can contain
  instructions to exfiltrate text] -> every derived URL uses full read-group
  and address admission; the runbook states both inbound content tampering and
  outbound model-authored URL risk.
- [An operator token exposes every private repository it can see] -> no token
  is the default, the token is instance-wide and documented as operator
  attestation, and the runbook recommends a fine-grained repository scope.
- [Load-everything spends the unauthenticated quota on long threads and on
  shared egress] -> the runbook recommends a token for both; a per-Run cache
  is a later change if measured use shows the need.
- [A rewrite sends source path text to a third party] -> rewrites are opt-in,
  target templates are closed to two placeholders, boot rejects unsafe
  targets, each target is admitted, and result notes state the leak.
- [GitHub JSON changes shape] -> normalization failures are bounded `parse`
  notes and fall through; fixtures record the observed shapes.
- [A tag shadows a branch sharing its prefix and a path] -> documented limit
  with a scenario (D11).
- [A rate-limit body could contain attacker-controlled text] -> classification
  uses status and bounded headers only; the model receives a short category
  note.
- [OMP's `null` fallthrough was ambiguous] -> explicit claimed/unclaimed
  vocabulary and two failure shapes.
- [The #939 issue names URL fragments, resolution state, and lists] -> D16
  narrows the acceptance with a comment linking #927, #996, and #995.

## Migration Plan

The change is additive and off by default. Deploy code; an absent
`tools.webAdapters` contacts nothing. Operators who want GitHub add one
`github` entry and, if they read long threads or share an egress address, a
token; operators who want x.com add one `rewrite` entry; both restart so boot
validation and secret interpolation apply atomically. Removing an entry
disables it on the next boot. Rollback is a code rollback or config
replacement; there is no database migration, result replay migration, or
persisted adapter state.

## Deferred

- `:json` representation of the typed document: #833 (comment posted
  2026-09-27), as a member of the #989 representation slot.
- GraphQL review-thread resolution state and `reviewDecision`: #996.
- Issue and pull request list URLs: #995.
- `#L10-L40` blob anchors: #927.
- Telegram: #940, a separate change.
- Nested-thread rendering strategy for tree-shaped sources: guidance in D7,
  decided by the first such adapter.

## Open Questions

- Final module names and fixture route names are implementation details. They
  must preserve the interfaces and request accounting above and do not require
  another proposal decision.
