---
type: Reference
title: "Markdown for Agents (Cloudflare)"
description: "Edge HTML-to-Markdown conversion through Accept content negotiation"
resource: "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/"
observed:
  date: "2026-09-27"
sources:
  - id: cf-md-agents-docs
    resource: "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/"
    title: "Markdown for Agents reference"
  - id: cf-md-agents-blog
    resource: "https://blog.cloudflare.com/markdown-for-agents/"
    title: "Markdown for Agents announcement"
  - id: cf-md-conversion
    resource: "https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/"
    title: "Markdown conversion: how it works"
---

# Markdown for Agents (Cloudflare)

- **Status:** Cloudflare product feature; beta announced 2026-02-12, reference
  page updated 2026-07-13; no cost on Pro, Business, Enterprise and SSL for
  SaaS[^cf-md-agents-blog][^cf-md-agents-docs]

Opt-in per zone or rule: when a client sends `Accept: text/markdown`, the edge
fetches origin HTML and converts it to Markdown on the fly. A vendor feature
over ordinary HTTP content negotiation, not a new format.

**Mechanics**[^cf-md-agents-docs]

1. **Response.** `Content-Type: text/markdown; charset=utf-8` with
   `Vary: Accept`; `ETag`, `Last-Modified` and body-specific encoding headers
   are removed, cache and CORS headers kept.
2. **Token estimates.** `x-markdown-tokens` and `x-original-tokens` estimate
   converted and original sizes.
3. **Content Signals.** An origin `content-signal` header is preserved; absent
   one, Cloudflare adds `ai-train=yes, search=yes, ai-input=yes`.
4. **Output shape.** YAML frontmatter from title, description and Open Graph
   tags, the cleaned body, and JSON-LD in a fenced `json`
   block[^cf-md-conversion]. Only HTML up to 2 MiB is converted.

**llame fit: consumed.** llame's web `read` sends `Accept: text/markdown` on
every request, so an enabled zone is served through the existing `negotiated`
adapter without vendor code; see
[adapter order](../../web-read.md#adapter-order). The result omits
`markdownTokens` and response headers, and `content-signal` is neither
consulted nor reported ([what is not read](../../web-read.md#what-is-not-read)).
Using the token estimate for context budgeting would be a result-contract
change; nothing asks for it yet.

**Caution:** a default `content-signal` is Cloudflare's publisher-use default,
not consent or access control. Token counts are Cloudflare estimates, not a
tokenizer for any given model.

[^cf-md-agents-docs]: [Markdown for Agents reference](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)

[^cf-md-agents-blog]: [Markdown for Agents announcement](https://blog.cloudflare.com/markdown-for-agents/)

[^cf-md-conversion]: [Markdown conversion: how it works](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/)
