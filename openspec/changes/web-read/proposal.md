## Why

The native `read` tool reaches absolute paths, `kb://`, and `skill://` but not
a URL (`apps/api/src/tools/native-files.ts:63-78`), so reading public
documentation needs an operator-configured MCP fetch server that loses the
selectors, result bound, and permission rules `read` already has. Publishers
now serve Markdown for agents directly: Cloudflare Markdown for Agents answers
`Accept: text/markdown`, and llmstxt.org v2 defines the `.md` suffix and the
`Link` alternate this change follows. No inspected harness uses either; each
converts HTML locally (peer survey in `design.md`). Issue #913.

## What Changes

- `read` accepts `http://` and `https://` locators beside absolute paths,
  `kb://`, and `skill://`. No new tool id, `tools.allowed` entry, or
  configuration block: availability and restriction are the `read` permission
  group's `path` clauses. `edit` and `write` reject a web locator with
  `invalid_path`, and a submitted locator that is not its own WHATWG
  serialization is refused with `invalid_path` naming the canonical form, so
  an encoded or uppercase spelling cannot slip past a reject clause. `read`
  becomes eligible for advertisement whenever it is
  allowlisted, since a web locator needs no host authority; absolute paths
  without accepted native authority keep failing closed.
- Publisher Markdown before local rendering: the first request negotiates
  `Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5`; an
  HTML response is followed by its `Link` or `<head>` Markdown alternate, the
  llms.txt suffix probe, a local Readability and Turndown render, an `llms.txt`
  walk only when that render fails the quality gate, then the raw body with a
  note. `:raw` returns the final response body untouched.
- Redirects are followed on any host, up to 20 per call; each hop's resolved
  `Location` is evaluated against the `read` group as if the model had
  submitted it. A rejected hop on the call's own chain ends the call, while one inside a probe's redirect chain disqualifies that candidate with `permission_denied`, the
  fixed hop message, and the locator's origin and path in a bounded
  `rejectedUrl` field; its
  body is never read, and hop decisions reach the runner through the tool
  context and are recorded with the call's decision metadata at settlement.
  A hop with userinfo or a non-web scheme fails `invalid_redirect`. The
  result reports `finalUrl`, not the chain.
- Bounds: 10 s to headers (`headers_timeout`), 30 s per call
  (`call_timeout`), a 5 MiB streamed body cap (`body_too_large`), at most 27
  requests per call (`too_many_redirects` past 20 redirects), no retries.
  A non-2xx first response or hop fails with `http_status` naming the
  status (429 also carries `Retry-After`); a probe's failure only disqualifies
  that candidate.
- Text bodies only (`text/*`, JSON, XML, `+json`/`+xml`); anything else fails
  with `unsupported_content_type` naming the type.
- Result: the native read object plus `finalUrl`, `method`, and `notes` when
  non-empty. No text header, no frontmatter (#917).
- `User-Agent: llame/<version>`, no rotation. `robots.txt` and
  `content-signal` are not consulted. No cache: a selector read refetches.
- The example config keeps `read`'s whole-tool allow and adds two
  `read.path` rejects: `^http://` and grokipedia with
  subdomains and a trailing dot. A new operator runbook, `docs/web-read.md`,
  shows the domain-allowlist alternative.

Not **BREAKING**: no key, tool id, or schema changes; a process that never
sees a web locator behaves as today, except that `read` becomes advertised
wherever it is allowlisted (D13). An operator who copies the updated example
rejects cleartext and grokipedia reads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: "Native tools operate on absolute local regular files"
  admits read-only web locators, keeps mutations out, drops the authority
  condition from `read`'s advertisement, and exempts web reads from executor
  binding and sibling suggestions. Added requirements cover the locator and
  its permission boundary, bounds, text bodies, publisher Markdown, local and
  raw fallbacks, redirects, and the result shape.
- `tool-call-permissions`: "Match submitted string values without
  serialization artifacts" adds web locators matched as submitted text and
  per-hop evaluation; "Safe decision provenance and non-fatal rejection" adds
  hop records and the hop rejection message; "Recommended portable policy
  with explicit replacement" adds F5/F6 and the domain-allowlist alternative.
- `tool-calling`: "Tool registry with mandatory safety classification" admits
  `read` on the allowlist alone. The in-flight `knowledge-submit` change
  modifies the same requirement; whichever finalizes second reconciles, and
  task 4.2 covers both orders.

## Non-goals

- Post-resolution address checks (#914). A hostname rule cannot see the
  resolved address; the design and runbook say so.
- Caches or tool-result snapshots (#915). PDF and image bodies (#916).
  Tool-output format (#917).
- A `web_fetch` tool, a `tools.allowed` gate, a web configuration block,
  retries, `User-Agent` rotation, challenge circumvention, publisher-signal
  compliance, a URL-provenance rule, an extra untrusted-content notice,
  multi-URL aggregation, search, sub-model summarization, site handlers.

## Dependencies and delivery order

`User-Agent` reuses the boot-time version read the in-flight
`opencode-go-provider` change adds to instance config; this change adds no
second read, and the `fetch` layer is created only after that read has
merged (`tasks.md`). Four packages are new to `apps/api`: `@mozilla/readability`,
`turndown`, `turndown-plugin-gfm`, `linkedom` (licenses in `design.md`); the
`fetch` layer's first task confirms Readability runs on linkedom.

```text
master <- web-read/proposal <- web-read/fetch <- web-read/policy <- web-read/finalize
```

- `proposal`: this ledger, design, and the three delta specs. About 1,600
  authored lines. Closes nothing.
- `fetch` (~1,000 lines): locator, `read` admission on the allowlist, HTTP
  client with bounds, negotiation, the local render, `text` and `raw`
  outcomes, result, `read.md` description, unit and fixture-server tests. No
  derived locator is fetched in this layer: a redirect status fails with
  `http_status`, and alternates, suffix probes, and `llms.txt` are absent, so
  `master` never carries a server-chosen request without its admission
  between merges. Closes nothing.
- `policy` (~1,000 lines): derived locators (hops, alternates, suffix,
  `llms.txt`) with their admission and provenance, `rejectedUrl`, example
  rejects, `docs/web-read.md`, changelog, README/AGENTS line. `Closes #913`.
- `finalize`: spec sync and archive only.

## Impact

`apps/api/src/tools/native-files.ts`, new `apps/api/src/tools/web-read/`
modules, `apps/api/src/prompts/tools/read.md`, the candidate resolver
`apps/api/src/knowledge/knowledge-tool-candidate-resolver.ts`, the permission
evaluator, the tool context and completion payload in
`apps/api/src/runs/run-execution.service.ts` with its durable reconstruction
in `assistant-transcript.ts`, the `ToolResult` error variant in
`packages/runtime-safety` (optional `rejectedUrl`),
`apps/api/llame.config.json.example` with its mirror
`apps/api/src/testing/portable-tool-policy.ts`, `apps/api/package.json`,
`docs/web-read.md`, `CHANGELOG.md`, `README.md`, `apps/api/AGENTS.md`. No
migration, HTTP API surface, or database schema change.

## Acceptance

Each row is a delta-spec scenario; `tasks.md` names the owning layer.

- `read https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/`
  returns `method: "negotiated"` after one request.
- `read https://llmstxt.org/` returns `method: "md-suffix"` (the site serves
  `/index.md`); `read https://en.wikipedia.org/wiki/Llama` returns a
  Readability render, and `read https://llmstxt.org/:raw` returns the HTML
  body.
- A 302 to a host matched by a `read` reject ends with `permission_denied`,
  `rejectedUrl` naming that locator, the target body never read, and the hop
  decision recorded with the call's metadata.
- A `read` group whose only allow is
  `{ "field": "path", "regex": "^https://docs\\.example\\.com/" }` admits that
  host and rejects every other URL, local path, and `kb://` locator.
- A body over 5 MiB fails with `body_too_large`; a PDF URL fails with
  `unsupported_content_type`.
- `pnpm exec openspec validate web-read --strict`, `pnpm lint:markdown`,
  `pnpm format:check`, and `git diff --check` pass on this layer.
