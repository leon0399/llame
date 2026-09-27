## Why

The native `read` tool already admits HTTP(S) locators, canonicalizes them, evaluates derived requests, pins admitted addresses, and runs a bounded Markdown ladder. Site URLs that need structured first-party data still fall through to HTML extraction: a GitHub blob page is a JavaScript viewer whose text is not in the document, an issue page buries the body under chrome, and a pull request's review comments are not in the served HTML at all. x.com is a client shell with no server-rendered text. Issues #708 and #939 ask for one adapter contract instead of unrelated scrapers; the existing seams are `WebReadDeps`/`WebPipelineDeps` (`apps/api/src/tools/web-read/execute.ts:18-59`, `pipeline.ts:34-43`) and the shared call session (`http-client.ts:72-90`, `436-452`).

This change owns plane 2 of the three-plane read architecture: ordered web adapters between admitted HTTP(S) source resolution and the generic ladder. It answers the Decide lists in #708 and #939 while keeping source permission, address admission, selectors, result bounds, and fail-closed configuration in the native read path.

## What Changes

- Define a static, code-owned web adapter contract. `match` is pure and runs on the canonical source URL; a URL it accepts is claimed, a URL it rejects is unclaimed and reaches the generic ladder with no adapter request and no note. `route` is `native` or `rewrite`; every derived request is admitted by the `read` group and address policy before I/O; results preserve the source `finalUrl`, report `method: "adapter"`, and carry `adapter: { id, route, origin? }`. A claimed URL whose primary request is refused, non-2xx, rate-limited, unparsable, or empty records a bounded note and falls through to the next matching adapter or the generic ladder; a claimed URL whose primary request succeeded renders what arrived and notes each section a later request could not supply. `:raw` bypasses adapters and keeps its current meaning.
- Add `tools.webAdapters` to operator config: an ordered array of uniquely identified entries whose `use` is `github` or `rewrite`. Absent means `[]`; nothing contacts a third party or a first-party API until an operator lists it. Entries are closed and boot-validated.
- Add the native `github` adapter for public GitHub URLs at `api.github.com`, REST and GET only, with no credential by default and an optional interpolated operator token. It reads issues and pull requests in the layout the oh-my-pi `pr://` view uses, with every comment page loaded and paged by the ordinary `:N-M` selector; blobs as line-preserving file text; directories and the repository root as two-level listings in the local directory shape; and commits as message, author, and changed-file summaries with a `Diff:` line pointing at GitHub's own `.diff` URL. Branches containing `/` resolve through `matching-refs`.
- Add the generic `rewrite` adapter: an operator-declared exact host list, an optional path pattern, and a literal-origin target template with `{path}` and `{query}` placeholders. The target is revalidated per call, admitted, address-pinned, fetched once through the local negotiated/text or Readability stages without probes, and reported with its origin. The runbook shows `https://x.pcstyle.dev{path}` as the x.com example and states the leak. No code in llame knows about X.
- Treat an operator GitHub token as accepted instance-wide authority: every owner on that llame instance can read what the token sees. The runbook recommends a fine-grained personal access token and presents the token as an operator attestation, like configured MCP headers, not tenant-owned authorization; it also states that unauthenticated GitHub allows 60 requests per hour per egress address, shared by every owner.
- Classify GitHub rate limits as `429`, or `403` with `x-ratelimit-remaining: 0` or `retry-after`; `x-ratelimit-reset` only adds reset metadata. Adapter failures never return an error body to the model, and the shipped status-error contract is unchanged for the generic read path.

### #708 decisions

1. Delegated origins are operator-declared `rewrite` entries with a literal target origin; the target is opt-in, independently admitted, and recorded in provenance. No code-owned third-party protocol ships; a rewrite pointed at a service such as `api.fxtwitter.com` is read through the generic text path.
2. Nothing is on by default. Absent `tools.webAdapters` enables no adapter, native or rewrite.
3. The source `read` permission is the authority boundary, and each derived adapter locator is independently admitted and address-pinned; no adapter-specific permission group is added.

### #939 decisions

1. GitHub is unauthenticated and public-only by default; an optional operator token is instance-wide authority with a documented blast radius. It is not an owner/repository allowlist feature.
2. The `read.path` policy matches the submitted source URL; adapter API paths are derived locators that require their own admission, so a domain allowlist must admit `api.github.com` for the GitHub adapter to run (otherwise it falls through with `permission`). The adapter never requests `patch-diff.githubusercontent.com`; it only renders a `Diff:` URL. That host is needed only when the model separately reads the rendered `Diff:` URL through the generic ladder, because the `.diff` URL 302-redirects there.
3. Rate-limit responses are a named adapter note, not a permission refusal, and are never retried.
4. Enterprise hosts are out of this slice.
5. The first slice reads issues, pull requests, blobs, directories, commits, and the repository root, over REST with GET only. It excludes issue and pull request lists (#995), GraphQL review-thread resolution state and `reviewDecision` (#996), Actions, Projects, Discussions, search, gists, and all writes. The original `#L10-L40` blob-anchor row moves to #927: blobs remain line-for-line and use the existing `:N-M` selector. The `github-code` layer MUST post that narrowing comment, linking #927, #995, and #996, before writing `Closes #939`.

## Capabilities

### New Capabilities

None. The adapter contract is a web-source extension of `native-file-tools`, not a second read capability.

### Modified Capabilities

- `native-file-tools`: insert the ordered adapter plane, derived-locator admission and provenance, the `adapter` method and envelope, generic-ladder fallthrough, GitHub and rewrite behavior, and `:raw` bypass semantics while preserving all existing web requirements and scenarios.
- `instance-config`: add the closed `tools.webAdapters` operator setting, absent-means-none and explicit-list semantics, secret interpolation for the GitHub token, and boot validation.
- `tool-call-permissions`: extend the existing derived-locator decision contract with the distinct `adapter` provenance kind; no new tool identity or permission group is introduced.

## Non-goals

- Dynamic imports, runtime plugin loading, operator-supplied code or parsers, code-owned third-party protocols, per-entry request headers, or a universal scraper registry. Operator-declared fixed-origin rewrite maps are in scope and are protected by opt-in configuration, per-target admission and address pinning, and provenance.
- Telegram (#940), GitHub Enterprise, authenticated x.com sessions, timelines, searches, or writes.
- A `json` representation of the adapter document. Each adapter builds a typed document and renders it to Markdown; publishing that document as a representation-slot member is tracked on #833.
- Forced adapter selection (#938); `:raw` remains the only selector escape hatch in this change. Anchor section selection (#927), richer status-body diagnostics (#930), and any new address policy are not reimplemented here; this change consumes the shipped #914 address admission.

## Impact

The implementation layers will extend `apps/api/src/tools/web-read/` (adapter types, dispatch, provenance, the GitHub document and renderer, the rewrite route), instance-config types/schema/loader, and focused fixture-server integration tests in `apps/api/src/tools/web-read.integration.test.ts`. `docs/web-read.md`, the example config, `CHANGELOG.md`, and the packaged `read` description will document the absent-means-none default, declared origins, token tenancy, the x.com rewrite example, and domain-allowlist consequences. No HTTP or parser dependency is added. The result remains the native read object plus web fields, and no database or public HTTP API changes.

## Acceptance

- Absent `tools.webAdapters` enables no adapter; a listed `github` entry is the only path that contacts `api.github.com`, and a listed `rewrite` entry is the only path that contacts its declared origin.
- `:raw` never invokes an adapter, and a rejected adapter-derived `api.github.com` or rewrite request is not issued; the generic ladder can still run and notes identify the failed adapter.
- `github.com/o/r/issues/12` and `github.com/o/r/pull/12` render the specified layouts with every comment loaded; `github.com/o/r`, `/tree/<ref>/dir`, `/blob/<ref>/path`, and `/commit/<sha>` render the specified fields; a branch containing `/` resolves; private data is inaccessible without the operator token; the token never crosses an origin or redirect; rate limits fall through with a rate-limit note.
- `github.com/o/r/pull/12.diff`, list URLs, Actions, Projects, Discussions, search, gists, and Enterprise hosts are unclaimed and behave exactly as before this change.
- A rewrite with target `https://x.pcstyle.dev{path}` fetches once with only local negotiated/text or Readability stages, reports `route: "rewrite"` with its origin, keeps the source URL as `finalUrl`, and records its leak; boot rejects userinfo, non-http(s) targets, placeholders outside the path and query, unknown placeholders, and malformed templates.
