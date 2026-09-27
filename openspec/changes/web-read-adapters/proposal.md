## Why

The native `read` tool already admits HTTP(S) locators, canonicalizes them, evaluates derived requests, pins admitted addresses, and runs a bounded Markdown ladder. Site URLs that need structured first-party data or a documented service route still fall through to HTML extraction: GitHub blobs are JavaScript viewers, issue/PR review threads are not in the page, Telegram embeds hide post fields in widget markup, and x.com is a client shell. Issues #708, #939, and #940 ask for one adapter contract instead of unrelated scrapers; the existing seams are `WebReadDeps`/`WebPipelineDeps` (`apps/api/src/tools/web-read/execute.ts:18-59`, `pipeline.ts:34-43`) and the shared call session (`http-client.ts:72-90`, `436-452`).

This change owns plane 2 of the three-plane read architecture: ordered web service adapters between admitted HTTP(S) source resolution and the generic ladder. It answers the three Decide lists in #708, #939, and #940 while keeping source permission, address admission, selectors, result bounds, and fail-closed configuration in the native read path.

## What Changes

- Define a static, code-owned web adapter contract. `match` is pure and runs on the canonical source URL; `route` is `native`, `service`, or `rewrite`; every derived request is admitted by the `read` group and address policy before I/O; results preserve the source `finalUrl`, report `method: "adapter"`, carry `{ id, route, origin? }`, and state delegated provenance. A failed match falls through; a matched adapter that is refused, non-2xx, rate-limited, unparsable, empty, or otherwise unusable records a bounded note and falls through to the next adapter or generic ladder. `:raw` bypasses adapters and keeps its current meaning.
- Add `tools.webAdapters` to operator config. The final shipped state is absent => `[github, telegram]`; present is an explicit replacement and `[]` disables adapters. Entries are closed, ordered, uniquely identified, and boot-validated. Each service protocol is a code-owned `use` value with an operator-declared origin; `github` and `telegram` are built-ins, while `fxembed` and `rewrite` are opt-in declarations. A process without this key upgrades to contacting `api.github.com` and the Telegram embed for matching URLs, subject to the read policy.
- Add native `github` for public GitHub URLs at `api.github.com`, with no credential by default and an optional interpolated secret token. It reads repository roots as README, issues and pull requests as bounded structured Markdown, blobs as line-preserving file text, and commits as message/author/changed-file summaries. It covers review comments and token-only GraphQL `reviewThreads` resolution state, checks summaries, and reports omissions. Enterprise hosts, writes, Actions, Projects, Discussions, search, and gists remain out of scope.
- Add native `telegram` for one public `t.me/<channel>/<id>` post through Telegram's first-party embed (`embed=1&mode=tme`). It parses server-rendered HTML with the existing `linkedom` dependency and renders author, timestamp, text, quoted forward, and media notes without fetching media. Channel feeds, comments, search, and `t.me/c/...` private locators are not claimed and fall through.
- Add opt-in `fxembed` service protocol for x.com/twitter.com status URLs. The operator supplies an HTTPS origin such as `https://api.fxtwitter.com`; the adapter maps the bounded JSON response to Markdown and records the service origin. It does not invent a reply thread the protocol did not return.
- Add opt-in operator `rewrite` entries with exact canonical host matches and an optional path regex. The target origin is literal and placeholders occur only in the target path/query with defined encoding and per-call same-origin revalidation. The target is fetched once through negotiated/text or local Readability stages, without alternate/suffix/`llms.txt` probes. The runbook shows `api.fxtwitter.com` and `https://x.pcstyle.dev{path}` as x.com examples and states the leak. Operator-declared host-to-target maps are supported; operator-supplied code, parsers, and dynamic loading are not.
- Treat an operator GitHub token as accepted instance-wide authority: every owner on that llame instance can address any repository the token can see. The runbook recommends a fine-grained PAT scoped to intended repositories and presents this as an operator attestation, like configured MCP headers, not tenant-owned authorization.
- Classify GitHub rate limits from `403` with `x-ratelimit-remaining: 0`, `429`, and `retry-after`/`x-ratelimit-reset`. Adapter failures never return an error body to the model; they become a note and fall through, while the shipped status-error contract remains unchanged for the generic read path.

### #708 decisions

1. Delegated origins are operator-configurable through fixed code-owned protocols (`fxembed` first, later service protocols such as a Telegram-API-style bridge) and validated `rewrite` entries; the target is opt-in, independently admitted, credential-scoped, and recorded in provenance.
2. Delegated adapters are off unless declared. The final absent-config default contacts only first-party GitHub and Telegram origins; intermediate stack layers use absent defaults `[]` and then `[github]` before Telegram lands.
3. The source `read` permission is the authority boundary, and each derived adapter locator is independently admitted and address-pinned; no adapter-specific permission group is added.

### #939 decisions

1. GitHub is unauthenticated and public-only by default; an optional operator token is instance-wide authority with explicit documented blast radius: two different llame owners on one instance can each read what the token sees. It is not an owner/repository allowlist feature.
2. The `read.path` policy matches the submitted source URL; adapter API paths are derived locators that require their own admission, so a domain allowlist must also admit `api.github.com` (and any declared service origin) or GitHub falls through without a request.
3. Rate-limit responses are a named adapter note, not a permission refusal, and are never retried by the adapter.
4. Enterprise hosts are out of this slice.
5. The first slice is read-only issues, pull requests, blobs, commits, and repository README; it excludes Actions, Projects, Discussions, search, gists, and all writes. The original `#L10-L40` blob-anchor row is moved to #927: blobs remain line-for-line and use the existing `:N-M` selector here. The GitHub layer MUST post that narrowing comment, with a link to #927, before writing `Closes #939`.

### #940 decisions

1. The first route is the first-party public embed, not Bot API or MTProto credentials.
2. The first slice claims single public posts only; channel feeds, comments, search, and private `t.me/c/...` URLs fall through. The Telegram layer MUST post a narrowing comment moving channel reads and `t.me/s/` paging to a linked follow-up before `Closes #940`.
3. Media is represented by bounded type notes; no media request is made.

## Capabilities

### New Capabilities

None. The adapter contract is a web-source extension of `native-file-tools`, not a second read capability.

### Modified Capabilities

- `native-file-tools`: insert the ordered adapter plane, derived-locator admission and provenance, `adapter` method/envelope, generic-ladder fallthrough, GitHub/Telegram/fxembed/rewrite behavior, and `:raw` bypass semantics while preserving all existing web requirements and scenarios.
- `instance-config`: add the closed `tools.webAdapters` operator setting, absent-defaults and explicit-replacement semantics, secret interpolation, and boot validation.
- `tool-call-permissions`: extend the existing derived-locator decision contract with the distinct `adapter` provenance kind; no new tool identity or permission group is introduced.

## Non-goals

- Dynamic imports, runtime plugin loading, operator-supplied code/parsers, or a universal scraper registry. Operator-declared fixed-origin rewrite maps are in scope and are protected by opt-in configuration, per-target admission/address pinning, credential scoping, and provenance.
- GitHub Enterprise, private Telegram access, Bot API/MTProto sessions, authenticated x.com sessions, timelines, searches, comments, or writes.
- Forced adapter selection (#938); `:raw` remains the only selector escape hatch in this change. Anchor section selection (#927), richer status-body diagnostics (#930), and any new address policy are not reimplemented here; this change consumes the shipped #914 address admission. GitHub fragment anchors (`#L10-L40`) are likewise deferred to #927, and #939 cannot close until its acceptance comment records that narrowed scope.

## Impact

The implementation layers will extend `apps/api/src/tools/web-read/` (adapter types, dispatch, budget, provenance, protocol renderers), instance-config types/schema/loader, and focused fixture-server integration tests in `apps/api/src/tools/web-read.integration.test.ts`. `docs/web-read.md`, the example config, `CHANGELOG.md`, and the packaged `read` description will document defaults, declared origins, token tenancy, x.com routes, and domain-allowlist consequences. Telegram reuses `linkedom` already present in `apps/api/package.json`; no HTTP or parser dependency is added. The result remains the native read object plus web fields, and no database or public HTTP API changes.

## Acceptance

- The final absent `tools.webAdapters` value uses only `github` and `telegram`; the contract layer starts with `[]`, the GitHub layer adds `[github]`, and the Telegram layer adds `[telegram]`; a declared `fxembed` or `rewrite` is the only path that contacts its configured third party.
- `:raw` never invokes an adapter, and a rejected adapter-derived `api.github.com` or service request is not issued; the generic ladder can still run and notes identify the failed adapter.
- GitHub public root/blob/commit/issue/PR URLs render the specified fields, private data is inaccessible without the operator token, token headers never cross an origin or redirect, and rate limits fall through with a rate-limit note.
- Telegram `t.me/durov/300` parses author/date/text/media with `linkedom`; `t.me/c/...` is not claimed.
- `fxembed` maps `https://api.fxtwitter.com/jack/status/20` to the source x.com identity and records the service origin; the `x.pcstyle.dev` rewrite fetches once with `https://x.pcstyle.dev{path}`, uses only local negotiated/text or Readability stages, and records its leak.
- Rewrite boot validation rejects userinfo, non-http(s), malformed placeholders, and targets not bounded to the declared template rules.
