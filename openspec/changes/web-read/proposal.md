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
  `invalid_path`. `read` becomes eligible for advertisement whenever it is
  allowlisted, since a web locator needs no host authority; absolute paths
  without accepted native authority keep failing closed.
- Publisher Markdown before local rendering: the first request negotiates
  `Accept: text/markdown, text/html;q=0.8, text/plain;q=0.7, */*;q=0.5`; an
  HTML response is followed by its `Link` or `<head>` Markdown alternate, the
  llms.txt suffix probe, a local Readability and Turndown render, an `llms.txt`
  walk only when that render fails the quality gate, then the raw body with a
  note. `:raw` returns the first response body untouched.
- Redirects are followed on any host up to 20 hops; each hop's URL is
  evaluated against the `read` group as if the model had submitted it. A
  rejected hop ends the call with `permission_denied` naming the hop URL and
  its body is never read; hop decisions are recorded with the call's decision
  metadata at settlement. The result reports `finalUrl`, not the chain.
- Bounds: 10 s to headers, 30 s per call across hops and probes, a 5 MiB
  streamed body cap (`body_too_large`), no retries; 429 returns an error
  carrying `Retry-After`, other non-2xx statuses an error naming the status.
- Text bodies only (`text/*`, JSON, XML, `+json`/`+xml`); anything else fails
  with `unsupported_content_type` naming the type.
- Result: the native read object plus `finalUrl`, `method`, and `notes` when
  non-empty. No text header, no frontmatter (#917).
- `User-Agent: llame/<version>`, no rotation. `robots.txt` and
  `content-signal` are not consulted. No cache: a selector read refetches.
- The example config keeps `read`'s whole-tool allow and adds two `read.path`
  rejects: `^http://` and grokipedia with subdomains. A new operator runbook,
  `docs/web-read.md`, shows the domain-allowlist alternative.

Not **BREAKING**: no key, tool id, or schema changes; a process that never
sees a web locator behaves as today. An operator who copies the updated
example rejects cleartext and grokipedia reads.

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
  modifies the same requirement; whichever finalizes second reconciles.

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
second read. Four packages are new to `apps/api`: `@mozilla/readability`,
`turndown`, `turndown-plugin-gfm`, `linkedom` (licenses in `design.md`); the
`fetch` layer's first task confirms Readability runs on linkedom.

```text
master <- web-read/proposal <- web-read/fetch <- web-read/policy <- web-read/finalize
```

- `proposal`: this ledger, design, and delta specs. About 1,400 authored
  lines. Closes nothing.
- `fetch` (~1,200 lines): locator, HTTP client with bounds and hop loop
  (no per-hop policy yet), adapters and quality gate, result, `read.md`
  description, unit and fixture-server tests. Closes nothing.
- `policy` (~800 lines): per-hop evaluation and provenance, example rejects,
  `docs/web-read.md`, changelog, README/AGENTS line. `Closes #913`.
- `finalize`: spec sync and archive only.

## Impact

`apps/api/src/tools/native-files.ts`, new `apps/api/src/tools/web-read/`
modules, `apps/api/src/prompts/tools/read.md`, the permission evaluator and
provenance path, `apps/api/llame.config.json.example`, `apps/api/package.json`,
`docs/web-read.md`, `CHANGELOG.md`, `README.md`, `apps/api/AGENTS.md`. No
migration, API surface, or schema change.

## Acceptance

Each row is a delta-spec scenario; `tasks.md` names the owning layer.

- `read https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/`
  returns `method: "negotiated"` after one request.
- `read https://llmstxt.org/` returns a Readability render;
  `read https://llmstxt.org/:raw` returns the HTML body.
- A 302 to a host matched by a `read` reject ends with `permission_denied`
  naming that URL, the target body is never read, and the hop decision is
  recorded with the call's metadata.
- A `read` group whose only allow is
  `{ "field": "path", "regex": "^https://docs\\.example\\.com/" }` admits that
  host and rejects every other URL, local path, and `kb://` locator.
- A body over 5 MiB fails with `body_too_large`; a PDF URL fails with
  `unsupported_content_type`.
- `pnpm exec openspec validate web-read --strict`, `pnpm lint:markdown`,
  `pnpm format:check`, and `git diff --check` pass on this layer.
