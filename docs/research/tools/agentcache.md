---
type: Reference
title: "Agent Cache"
description: "Documentation-site-to-Markdown bundler for coding agents; despite the name it caches no model responses, tool results or prompt prefixes."
resource: "https://agentcache.run/"
tags: [documentation, markdown, web-read, llms-txt, mcp, bundles]
status: draft
generated: { by: "claude-code/claude-opus-5-5", at: "2026-10-08" }
observed:
  date: "2026-10-08"
  revision: "sha256:cfcbe08f46d35771 (agentcache.run/llms.txt); upstream Git revision unavailable"
sources:
  - id: home
    resource: "https://agentcache.run/"
    title: "Product page: bundle layout, CLI and MCP snippets"
  - id: about
    resource: "https://agentcache.run/about"
    title: "Pipeline description, license, managed service"
  - id: ladder
    resource: "https://agentcache.run/blog/acquisition-ladder"
    title: "Six-tier acquisition ladder"
  - id: no-llm
    resource: "https://agentcache.run/blog/why-no-llm-extraction"
    title: "Where LLMs fit in documentation extraction"
  - id: llms-txt
    resource: "https://agentcache.run/llms.txt"
    title: "Agent-facing usage and API summary"
  - id: openapi
    resource: "https://agentcache.run/openapi.json"
    title: "Agent Cache API 1.0.0 (5 paths, no security schemes)"
  - id: privacy
    resource: "https://agentcache.run/privacy"
    title: "Storage and retention"
  - id: context7-compare
    resource: "https://agentcache.run/compare/context7"
    title: "Vendor comparison with Context7"
  - id: llame-prompt-cache
    resource: "../tool-harness/2026-09-26-prompt-cache-boundaries.md"
    title: "Provider prompt caching, explicit cache boundaries, and llame's dynamic context"
---

# Agent Cache

- **Stack:** web app plus REST job API that crawls a documentation site and
  returns a ZIP of Markdown files; a CLI and a stdio MCP server are described
  on the product page.[^home][^openapi]

**Status:** the name suggests an LLM response, tool-result or prompt-prefix
cache. It is none of these. High confidence from the product page, `llms.txt`
and OpenAPI document: "cache" means a local, offline copy of documentation,
and no model call sits on any path.[^about][^llms-txt] This entry belongs with
tools, not [agentic harnesses](../harnesses/index.md): it hosts no agent
execution. Source inspection only; no job was submitted and no code ran. The
GitHub repository the site links (`agentcache/agent-cache`) returned 404 on
the observation date, so every claim rests on the vendor's own pages.[^home]

**What it produces.** One folder per site: Markdown pages, `_map.json` (every
page, structured), and `meta.yaml` (origin, fetch time, GitHub repo if found),
placed under `.agentcache/docs/<name>/docs/`.[^home][^llms-txt] The agent reads
the folder as ordinary files; the suggested instruction is to treat it as the
authoritative source rather than remembered APIs.[^home]

**Study**

1. **Cost-ordered acquisition ladder.** Per the vendor, extraction tries
   `/llms.txt` and `/llms-full.txt`, then the GitHub Markdown tree via raw CDN,
   then a `.md` suffix on page URLs, then `Accept: text/markdown`
   negotiation, then jsdom plus Turndown HTML purification with per-framework
   cleaners, with paid extraction services reserved but stated as unused.[^ladder]
   The adoption percentages on that page (about 8%, 30%, 30%, 3%, 38%) are the
   vendor's samples and unverified. Moderate confidence the order is sound.
   llame's native `read` already negotiates Markdown, follows announced
   alternates, probes a `.md` suffix and `llms.txt` per locator, with admission
   per derived request.[^llame-prompt-cache] The new idea is the GitHub-tree
   tier and whole-site fan-out, which llame's per-locator `read` lacks and
   which would need its own egress and quota admission. Study only; low
   confidence it is worth building.

2. **Determinism without a model.** "Same input, same output" is asserted
   because structure comes from URL topology and no LLM rewrites pages.[^about][^no-llm]
   Unverified: live sites change, JS-rendered pages vary, and the vendor does
   not describe a content hash or version pin. `meta.yaml` records fetch time,
   not a digest, so reproducibility across fetches is a claim, not an
   interface. For llame, any imported bundle needs a recorded source URL,
   revision or digest and coverage (failed pages are "listed, not fatal"[^home])
   so a stale or partial bundle is visible to the model and the owner.

3. **No cache keying or invalidation exists.** Jobs are keyed by an opaque
   `ac-xxxx` id derived from the submitted URL; refresh is a manual re-add.
   No TTL, ETag revalidation or staleness signal is documented.[^llms-txt][^home]
   Provider prompt caching (llame already ships the Anthropic `cacheControl`
   default) is unrelated: its key is the request prefix. Do not cite Agent Cache
   in the [prompt-cache study](../tool-harness/2026-09-26-prompt-cache-boundaries.md).

4. **Isolation: none for the hosted service.** The OpenAPI document declares
   no security schemes; `POST /api/jobs`, `GET /api/jobs` (list of completed
   jobs) and the download routes are unauthenticated, and completed bundles are
   retained indefinitely in Cloudflare R2 with metadata in Turso.[^openapi][^privacy]
   Submitted URLs and their outputs are effectively public to anyone who can
   guess or list ids. High confidence from the spec; the crawler cannot
   authenticate to sites, so private docs are out of scope.[^llms-txt]
   For llame this rules out the hosted service for any owner-scoped or
   credentialed locator. A shared Knowledge or crawl cache would need the
   owner identity in its key and RLS-enforced storage; a global URL-keyed
   cache is only safe for anonymous public pages, and even then a fetch
   made with owner headers or cookies must never populate it.

5. **Self-hosting and licensing.** The product page and OpenAPI state MIT and
   say the web app, CLI and MCP server are on GitHub; the managed service is
   free with no tiers.[^about][^openapi][^context7-compare] Unverified: the
   repository is unreachable, so license text, source and self-host procedure
   are unconfirmed. The CLI and MCP (`list_docs`, `get_doc_map`, `get_doc_page` over the local folder) are marked "coming soon" or "ships when the
   backend does". The npm package `agentcache` (0.4.2, MIT) belongs to an
   unrelated project, a session-memory tool with a different repository, so
   `npm i -g agentcache` from the snippet would not install this product.
   Treat any install path as unavailable.

**llame fit.** Low. llame's web `read` and Knowledge Spaces already cover
fetching and serving Markdown with admission, tenant scoping and bounded
output, so a third-party crawler adds an unauthenticated egress path and
unpinned content. If offline library documentation becomes a requirement,
the transferable pieces are the ladder order and the bundle layout (map plus
provenance metadata), implemented inside an owner-scoped Knowledge import;
fetched pages remain untrusted data. Tool-result caching, if studied, belongs
under native effect fencing and the existing durable observation record, not
under a URL-keyed cache.

**Caution.** Do not adopt the hosted service for private or credentialed
sources, and do not paste bundle contents into model context as trusted
instructions. The product self-describes as "not perfect yet", has a sole
maintainer, and cannot be pinned to a source revision from here.[^home][^about]

[^home]: [Product page](https://agentcache.run/)

[^about]: [About](https://agentcache.run/about)

[^ladder]: [Acquisition ladder](https://agentcache.run/blog/acquisition-ladder)

[^no-llm]: [Where LLMs fit in documentation extraction](https://agentcache.run/blog/why-no-llm-extraction)

[^llms-txt]: [llms.txt](https://agentcache.run/llms.txt)

[^openapi]: [OpenAPI](https://agentcache.run/openapi.json)

[^privacy]: [Privacy](https://agentcache.run/privacy)

[^context7-compare]: [Compare with Context7](https://agentcache.run/compare/context7)

[^llame-prompt-cache]: [llame README, web read](../../../README.md) and [prompt-cache study](../tool-harness/2026-09-26-prompt-cache-boundaries.md)
