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
(`http-client.ts:72-90`, `436-452`). Derived admission currently enumerates
hops, alternates, suffixes, `llms.txt`, and addresses and decides each before
I/O (`admission.ts:12-18`, `145-159`). The result builder reserves the native
result envelope before applying selectors and bounds (`result.ts:26-73`).

The config loader resolves `tools` as one typed object
(`apps/api/src/instance-config/config-loader.ts:177-203`), uses single-pass
interpolation with value-free errors (`config-loader.ts:588-627`), and already
has a private interpolated-header resolver for MCP origins
(`config-loader.ts:962-1007`, `1032-1057`). `tools` currently has no web
adapter field (`apps/api/src/instance-config/llame-config.ts:427-446`), so
this change adds the consumer-owned field and schema entry rather than a
second configuration source. `linkedom` is already an API dependency at
`apps/api/package.json:74`.

Prior art was inspected in `agent://OmpReadPrior/report` and rechecked at OMP
HEAD `22269d67cb29a77e5fbf0b2a3918f58a6d682454`. OMP's `SpecialHandler` combines
match, fetch, and render and returns nullable results
(`/home/leon0399/.cache/checkouts/github.com/can1357/oh-my-pi/packages/coding-agent/src/web/scrapers/types.ts:13-29`); its barrel order puts GitHub before the rest and Twitter in the social list
(`.../web/scrapers/index.ts:164-183`); handlers return null for recoverable
failure through `handleSpecialUrls` (`.../tools/fetch.ts:1031-1049`). OMP's
GitHub handler calls `api.github.com`, adds an optional bearer token, and
collapses all non-2xx responses to `{ ok: false }`
(`.../web/scrapers/github.ts:112-145`). Its Twitter handler tries an ordered
Nitter list and returns a non-null blocked result when all fail
(`.../web/scrapers/twitter.ts:6-11`, `29-68`, `71-93`). This design keeps the
useful ordered handlers and provenance, but separates pure matching from
network work, makes fallthrough explicit, and does not copy OMP's credential
and secondary-origin policy gaps.

A 2026-09-27 live spike supplied the protocol evidence. Fetching
`https://t.me/durov/300?embed=1&mode=tme` and parsing with the installed
`linkedom` returned author `Pavel Durov`, date
`2024-06-30T06:48:04+00:00`, the full post text, ten media nodes, and a
26,458-byte HTML body. Fetching
`https://api.fxtwitter.com/jack/status/20` returned `code: 200`, source URL
`https://x.com/jack/status/20`, id `20`, author `jack`, timestamp
`Tue Mar 21 20:50:14 +0000 2006`, text `just setting up my twttr`, and no
reply or media object. Fetching
`https://x.pcstyle.dev/jack/status/20` returned Markdown with the source URL
and a bounded reply thread. The rewrite therefore uses only local negotiated/text or Readability stages,
while FxEmbed maps only the fields the protocol actually supplies.

## Goals / Non-Goals

**Goals:**

- Add one traceable adapter stage between admitted source resolution and the
  existing ladder without changing selectors, result bounds, or address
  admission.
- Make every secondary origin explicit, independently admitted, credential
  scoped, and visible in provenance.
- Keep defaults first-party only, make delegated routes explicit operator
  attestations, and keep adapter failures non-fatal unless the shipped call
  bound or source request itself ends the call.
- Give implementation layers stable interfaces and fixture-server seams so
  each adapter can be verified without live third-party dependence.

**Non-Goals:**

- A runtime plugin loader, dynamic module registry, arbitrary rewrite service,
  GitHub Enterprise, Telegram credentials, authenticated X sessions, anchor
  fragments, forced adapter selection, or a new web tool id.
- Changing the generic status-error body contract, the #914 address policy, or
  the representation slot owned by the sibling change.

## Decisions

### D1: Place adapters after source admission and before the generic ladder

**Decision:** Parse, canonicalize, and admit the submitted HTTP(S) source as
shipped. If the selector is `:raw`, fetch and return the response without
running adapters. Otherwise run the ordered built-in/configured adapter list,
then the existing negotiated/alternate/suffix/Readability/`llms.txt`/raw
ladder. A rewrite fetches its target once, applies only negotiated Markdown/text or the
local Readability stage with its quality gate, and remains the selected adapter
for provenance; it does not run alternate, suffix, or `llms.txt` probes.

**Alternative rejected:** Put each adapter inside one generic ladder slot, or
let adapters replace the source executor. The former makes source-specific
matching depend on body content and makes `:raw` ambiguous; the latter would
bypass the existing shared session and address admission.

**Consequence:** A source URL is admitted once before matching, but every
adapter-derived URL is admitted again. Generic behavior remains observable
when no adapter claims or when an adapter fails. The `file-locator` and
`read-representations` changes can compose around this stage without knowing
site protocol details.

### D2: Use a typed contract with pure match, explicit route, and fallthrough

**Decision:** Each static entry has `id`, pure synchronous `match(url)`, route
kind, declared origins, bounded request/render, and an explicit outcome. Route
`native` fixes first-party origins in code; `service` fixes a code-owned
protocol while taking only its base origin and secret headers from config;
`rewrite` takes a validated literal-origin operator target and uses the local
negotiated/text or Readability renderer. New service protocols are code-owned
`use` values with operator-declared origins, not operator-supplied parsers.
Failure categories are `permission`, `address`, `status`, `rate_limit`,
`transport`, `parse`, `empty`, `budget`, `binary`, `too_large`, and
`content_type`. Transport notes use only the
bounded named classes `dns`, `tls`, `connect`, `reset`, or `other` when the
runtime can classify them; they never forward a platform exception string. A
matched failure produces a bounded note and tries the next matching entry or
generic ladder.

**Alternative rejected:** OMP's combined `SpecialHandler` returning null on
both mismatch and failure. It makes a handler's precedence and failure reason
invisible and allowed Twitter to block generic fallback while GitHub fell
through. A universal registry is also rejected: the approved architecture
requires static lists with real implementations, and CODING_STANDARDS.md
prohibits a registry without present need.

**Consequence:** The implementation can test matching with zero I/O, test each
failure category against a local fixture, and prove that a refusal does not
become a network attempt. Adding the GitHub, Telegram, and service protocols
still changes one module and one static list entry each, not a runtime plugin
surface.

### D3: Admit every derived adapter locator independently

**Decision:** An API URL, embed URL, service target, rewrite target, and every
redirect hop are full derived locators. The same evaluator and projection run
before each request, followed by the same resolver and pinned address
admission. The decision does not inherit the source URL's allow, and an
adapter request that is refused disqualifies only that adapter. A domain
allowlist therefore must name each declared secondary origin: a GitHub rule
for `^https://github\\.com/` does not admit `https://api.github.com/`; the
runbook gives both clauses or explains the fallthrough.

**Alternative rejected:** Inherit the source decision. That turns a source
allow into an egress grant and makes prompt-injected or server-chosen targets
escape operator policy. A reject-only check is insufficient because the
operator's allowlist must be able to admit a configured service origin while
still rejecting all other hosts.

**Consequence:** The adapter can never contact `api.github.com`, Telegram's
embed, or a configured service merely because the source matched. The cost is
one policy evaluation per derived request and explicit operator configuration
for every secondary origin. Adapter decisions use the `adapter` provenance
kind; address decisions remain `address` and never expose resolved addresses.

### D4: Scope credentials to the declared origin and strip on redirects

**Decision:** The GitHub token is allowed only on the fixed
`api.github.com` origin. FxEmbed/rewrite secret headers are allowed only on
their configured origin. The request wrapper compares origin before attaching
headers and removes adapter credentials whenever a response redirects to a
different origin. Submitted source and generic ladder requests send no adapter credentials.
An adapter credential may be sent only to its declared origin and a same-origin
hop; it is stripped before any cross-origin hop.

**Alternative rejected:** Attach headers to every request in one call, or
allow the runtime's automatic redirect to carry them. That leaks an operator
secret to a source host, a server-selected host, or a prompt-injected rewrite
origin.

**Consequence:** A redirect can still be followed under normal admission, but
it cannot retain the adapter credential across an origin boundary. A same-
origin redirect remains within the declared origin. Token presence and its
value are never part of notes, errors, decisions, or model output.

### D5: Add `method: "adapter"` and a structured adapter object

**Decision:** Keep the shipped closed `WebRenderMethod` values for generic
stages and add `adapter` as the one method for all site/service/rewrite
successes. Add `adapter: { id, route, origin? }`; native entries omit origin,
while service and rewrite entries report the origin. `finalUrl` stays the
source URL for every adapter success. Notes say when content came through a
third-party or operator-configured origin.

**Alternative rejected:** Encode each adapter as a new union value such as
`github`, `telegram`, and `fxembed`, or prepend a text header. Per-adapter
method values grow a closed union and make generic consumers branch for every
site; a text header pollutes source lines and selector coordinates. A free-form
method string loses type safety.

**Consequence:** Consumers can branch once on `method: "adapter"` and inspect
stable structured provenance. Existing selector and result-bound code remains
shared. The result envelope reservation grows by the adapter fields, so a
long adapter render truncates content before dropping provenance.

### D6: Preserve status-error secrecy while classifying rate limits

**Decision:** The generic HTTP client keeps the shipped rule that a non-2xx
status returns no body and no headers other than `Retry-After`
(`openspec/specs/native-file-tools/spec.md:968-988`). An adapter may inspect
status and the bounded rate-limit headers needed for routing. GitHub rate limit means 429, or 403 with
`x-ratelimit-remaining: 0` or `retry-after`; `x-ratelimit-reset` only adds
reset metadata. It becomes a `rate_limit` note and fallthrough, not a
model-visible body or permission error. Other adapter
status, parse, and empty failures use the same note plus fallthrough rule.

**Alternative rejected:** Return bounded error JSON to the model, or map every
403 to permission denied. The former changes the explicit #930-sensitive
status-body contract and gives attacker-controlled diagnostics a new surface;
the latter mislabels rate exhaustion and cannot tell the model to use another
route.

**Consequence:** A generic status error still ends the call as shipped. A
matched adapter can fail without hiding a usable generic representation, but
its note contains only category and bounded reset metadata, never response
body text.

### D7: Keep one shared budget and reserve an adapter sub-budget

**Decision:** Extend the existing per-call session instead of creating a
session per adapter. Every request consumes the shared 10-second header,
30-second call, 5 MiB body, and redirect budget. The adapter phase has its own
cap of eight requests per call, including redirects of those requests; those
redirects also consume the shared 20-hop budget. Exhausting the adapter cap is
a `budget` adapter failure that falls through, not a new call-ending error.
The generic ladder keeps its existing one-alternate, one-suffix, and four-
`llms.txt` quotas.

**Alternative rejected:** Give every adapter a fresh session or let a GitHub
comment walk consume an unbounded number of calls. Fresh sessions permit a
hostile source to multiply work; unbounded pagination violates the bounded
read contract.

**Consequence:** An adapter can spend eight bounded requests without changing
the generic ladder quotas. Redirects still share the global 20-hop and 30-second
limits, and fixture tests can count every adapter request.

### D8: Use fixed GitHub REST paths and one token-gated GraphQL field

**Decision:** Match only the five source shapes in the contract with the stated
owner/repo/number/sha/ref/path grammars and encode each API path segment after
parsing. Use `GET /repos/{o}/{r}/readme` and
`GET /repos/{o}/{r}/contents/{path}?ref={ref}` with
`Accept: application/vnd.github+json`; decode the JSON contents object and
refuse binary, invalid UTF-8, `encoding: none`, empty large-file content, and
oversize. Use `GET /repos/{o}/{r}/commits/{sha}` for commits,
`GET /repos/{o}/{r}/issues/{N}` plus bounded comment pages for issues, and
`GET /repos/{o}/{r}/pulls/{N}` plus bounded issue/review comments and
`/repos/{o}/{r}/commits/{sha}/check-runs` for PRs. With a token, a fixed
GraphQL POST carries owner/repo/number variables and is admitted under both the
literal graphql endpoint and the REST pull locator; any 3xx response is a status adapter failure and no redirect is followed.
Blob content is rendered without a heading so `:N-M` remains a source line
selector. Missing pagination is stated in notes.

**Alternative rejected:** Fetch GitHub HTML/raw.githubusercontent.com, call
`gh`, or add the entire GitHub API surface. HTML loses review structure, a
second raw origin complicates token scoping, and `gh` introduces process and
credential behavior outside the read HTTP contract. Raw media also fails the
shipped text gate and can mislabel binary bytes.

**Consequence:** The first native adapter is deterministic and only contacts
`api.github.com`. Public reads work without a token; a token adds instance-
wide authority and resolution state with a documented blast radius. Enterprise
hosts and unsupported paths fall through.

### D9: Parse Telegram's first-party embed with the installed DOM dependency

**Decision:** Pure-match `t.me` or `telegram.me` with a channel matching
`^[A-Za-z][A-Za-z0-9_]{3,31}$` outside the reserved set and a post id matching
`^[1-9][0-9]{0,9}$`; permit no query or only `single`, never `comment` or
`thread`. Always derive the `t.me` embed target
`https://t.me/<channel>/<id>?embed=1&mode=tme`, even for `telegram.me` sources,
then parse server-rendered widget selectors with `linkedom` and render
author/date/text, quoted origin, and media type notes. A matched error widget,
missing author, or missing both text and media is a claimed `empty` failure; a
media-only post renders normally and an out-of-grammar shape is unclaimed. Do not request media or
comments. The proposal-time spike observed `.tgme_widget_message_author`, the
`time` datetime, `.tgme_widget_message_text`, and ten media nodes on `durov/300`.

**Alternative rejected:** Bot API and MTProto. They require different
credentials and privilege models and cannot read arbitrary public channels in
the first slice. A `t.me/s/` feed is also deferred because it introduces
ordering and paging semantics that are not single-post read semantics.

**Consequence:** Markup changes can cause parse/empty fallthrough rather than
an incorrect claim. `t.me/c/...`, feeds, comments, search, and channel roots
remain unclaimed and never receive credentials.

### D10: Treat FxEmbed as a protocol and rewrite as a bounded local route

**Decision:** FxEmbed has one operator base origin and matches x.com,
twitter.com, www/mobile variants, and `/user/status/id`, `/i/status/id`, or
`/i/web/status/id` shapes. It reduces `baseUrl` to its origin and constructs
`new URL(`/status/${id}`, baseOrigin)`, producing
`https://api.fxtwitter.com/status/20`; it maps only the bounded JSON fields supplied. Rewrite templates have a literal http(s)
origin with no placeholders in scheme/host/port; userinfo and fragments are
forbidden and a literal query is allowed. Placeholders are limited to the
target path/query; `{path}` is allowed only in the path, while `{host}`,
`{query}`, and `{url}` use `encodeURIComponent` of canonical values wherever
they appear after the origin. Each
target is revalidated per call for the declared origin and literal path prefix,
admitted, and address-pinned. It is fetched once using only negotiated/text or
Readability stages, without probes; raw/challenge/failed renders fall through.
Provenance reports route `rewrite` and the source URL.

**Alternative rejected:** Let operators supply executable code, dynamic
parsers, or unvalidated target origins. Operator-declared fixed-origin maps are
accepted: opt-in, per-target admission/address pinning, credential scoping, and
provenance answer the open-redirect concern without making configuration a
plugin loader.

**Consequence:** x.com has no third-party default. An operator can choose
FxEmbed or `x.pcstyle.dev`, sees the leak in the runbook and result notes, and
can disable it by removing the declaration. Path/query text remains a model-
chosen egress input, so the source and target both require admission.

### D11: Make config absence safe and presence an exact replacement

**Decision:** `tools.webAdapters` is an optional closed array. Absent SHALL select
exactly `[github, telegram]` in that order; present always means exactly the
listed entries, including `[]`. Intermediate subset defaults are delivery
steps recorded only in tasks.md. `github.token` and service/rewrite headers use the existing
interpolation resolver. Non-secret fields (hosts, regexes, base URL shape,
target templates) are validated as authored and do not silently interpolate.
Unknown ids, uses, duplicate ids, origins, placeholders, and target forms fail
boot before requests.

**Alternative rejected:** Merge operator entries into built-in defaults, or
use one boolean per service. Merge makes disabling and ordering ambiguous and
could contact a declared third party unexpectedly; booleans cannot represent
ordered protocol instances or explicit replacement.

**Consequence:** An operator who wants x.com service access must attest to a
specific origin. An absent key never contacts a third party. A configured
GitHub token is an instance setting, like MCP headers, and the runbook must
state that every owner on the instance can address its private visibility.

### D12: Keep the implementation static rather than runtime-loadable

**Decision:** The list is a code-owned TypeScript array/record with interfaces;
configuration selects known `use` values and data, never modules or code.
Operator-declared rewrite maps and service origins are supported as data. This
satisfies the approved three-plane architecture and the repository standard
against registries over a fixed set while providing four real route families
at introduction.

**Alternative rejected:** Dynamic import, executable config, or an operator
supplied parser URL. Those expand the boot and egress trust boundary and make
permission review impossible from source.

**Consequence:** A new adapter is a module, a static entry, tests, and a spec
delta. Configuration can opt in to a fixed protocol or target shape but cannot
smuggle code into the API process.

### D13: Threat model both directions and rely on address admission

**Decision:** Treat fetched content as untrusted: adapter Markdown and
third-party service responses can contain prompt injection, so notes and
provenance are data, not instructions. Treat model-authored source path,
query, and rewrite-derived target data as outbound egress: a page can instruct
the model to encode conversation text in a URL, but every source and derived
request still passes the operator `read` group and address admission. The
adapter layer does not add a host bypass, universal private-address block, or
publisher trust claim.

**Alternative rejected:** Trust the source host and inherit its allow, or
block only obvious private hostnames in adapter code. The former makes service
origins invisible; the latter duplicates and weakens the shipped #914 resolver
and pinning policy.

**Consequence:** Operators using domain allowlists must list `api.github.com`,
`t.me`, and each declared service/rewrite origin. A model can still request an
allowed exfiltration URL by design; the runbook states that `read` policy is
the outbound boundary. Third-party tampering remains visible through source
identity, route, origin, and notes but is not cryptographically solved.

### D14: Resolve the #939 fragment acceptance as a cross-issue bookkeeping change

**Decision:** Do not reinterpret fragments in this change. Fragments are cut
before permission and request as shipped; GitHub blobs render line-for-line
and use the existing `:N-M` selector. Before the GitHub layer closes #939, it
must post an issue comment linking #927 and move the original `#L10-L40`
acceptance row to #927, then close #939 against its narrowed acceptance.

**Alternative rejected:** Parse `#L10-L40` inside GitHub while generic web
fragments remain stripped. That would create a site-specific selector
precedence and contradict the approved architecture's ownership of anchors in
issue #927.

**Consequence:** #939's native adapter is complete for source-line selectors
without claiming anchor work. The issue comment is a required delivery task,
not an implementation workaround.

## Risks / Trade-offs

- [A model can prompt-inject a service URL or a source page can contain
  instructions to exfiltrate text] -> every derived URL uses full read-group
  and address admission; the runbook states both inbound content tampering and
  outbound model-authored URL risk.
- [An operator token exposes every private repository it can see] -> no token
  is the default, the token is instance-wide and documented as operator
  attestation, and the runbook recommends fine-grained repository scope.
- [A rewrite can send source-derived path/query text to a third party] ->
  rewrites are opt-in, target templates are closed and encoded, boot rejects
  unsafe targets, each target is admitted, and result notes state the leak.
- [Service markup or JSON changes] -> parser failures are bounded and fall
  through; Telegram uses a fixture-server parser test and the live spike is
  recorded as evidence, not a test dependency.
- [Adapters compete with generic probes for the call deadline] -> the adapter
  sub-budget is eight, GitHub pagination is bounded, adapter redirects consume
  the shared 20-hop limit, and generic ladder quotas remain unchanged.
- [A rate-limit body could contain attacker-controlled text] -> classification
  uses status and bounded headers only; the existing no-status-body rule stays
  intact and the model receives a short category note.
- [OMP's `null` fallthrough was ambiguous and Twitter blocked generic fallback]
  -> this design has explicit matched failure outcomes and the spec requires
  failure notes plus fallthrough.
- [The #939 issue originally names URL fragments] -> the design narrows that
  acceptance to `:N-M`, requires an issue comment linking #927, and leaves the
  architecture owner unchanged.

## Migration Plan

The change is additive and off-by-default for every delegated route. Deploy
code with built-in GitHub and Telegram first; an absent config key contacts no
third party beyond those fixed first-party origins. Operators who want x.com
must add and review one `fxembed` or `rewrite` entry, then restart so boot
validation and secret interpolation apply atomically. Removing the entry or
setting `tools.webAdapters: []` disables adapters on the next boot. Rollback
is a code rollback or config replacement; there is no database migration,
result replay migration, or persisted adapter state.

## Open Questions

- The original #939 `#L10-L40` row is intentionally not implemented here. The
  GitHub layer must post the narrowing comment with a link to #927 before
  writing `Closes #939`; no implementation decision remains open, but closure
  is blocked on that issue bookkeeping.
- Final module names and fixture route names are implementation details. They
  must preserve the interfaces and request/accounting decisions above and do
  not require another proposal decision.
