---
type: Reference
title: "llms.txt"
description: "Path-scoped Markdown index and per-page Markdown companions for agents"
resource: "https://llmstxt.org/"
observed:
  date: "2026-09-27"
  revision: "3700a0a624a4a004c6a246789b37f389940b1b58"
sources:
  - id: llmstxt-org
    resource: "https://llmstxt.org/"
    title: "The /llms.txt file, v2"
  - id: llmstxt-changes
    resource: "https://llmstxt.org/changes.html"
    title: "llms.txt v1 to v2 changes"
  - id: llms-txt-license
    resource: "https://github.com/AnswerDotAI/llms-txt/blob/3700a0a624a4a004c6a246789b37f389940b1b58/LICENSE"
    title: "Apache-2.0 license"
  - id: mintlify-llms-full
    resource: "https://www.mintlify.com/docs/ai/llmstxt"
    title: "Mintlify llms.txt and llms-full.txt"
  - id: google-ai-optimization
    resource: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide#mythbusting"
    title: "Google Search does not use llms.txt"
---

# llms.txt

- **Status:** informal community proposal by Jeremy Howard (Answer.AI), v2
  dated 2026-08-10; v1 was published September 2024; Apache-2.0[^llms-txt-license]

A Markdown file at `/llms.txt`, or at any subpath, indexing the site content
beneath it for model consumption[^llmstxt-org]; the most specific applicable
file wins. Only the H1 is required; a blockquote summary, free Markdown
sections and H2 link lists (`[name](url): notes`) are optional. v2 mostly
codifies observed practice: link relations, path scoping, both
Markdown-companion URL forms and direct agent consumption[^llmstxt-changes].

**Mechanics**

1. **Page companions.** A page's Markdown lives at the same URL with `.md`
   appended (`page.html.md`) or with the extension replaced (`page.md`);
   directory URLs use `index.html.md` or `index.md`[^llmstxt-org].
2. **Discovery links.** HTML `<link>` or an HTTP `Link` header with
   `rel="alternate" type="text/markdown"` announces page Markdown;
   `rel="describedby"` points at the covering `llms.txt`[^llmstxt-org].
3. **`## Optional`.** A convention for skippable secondary links. v2 removed
   its mechanical omission semantics and the context-expansion tool from the
   proposal[^llmstxt-changes].

**llame fit: consumed.** The shipped native web `read` already sends
`Accept: text/markdown`, follows announced alternates, probes a `.md` suffix
and walks `llms.txt` from the deepest path segment to the root; see
[adapter order](../../web-read.md#adapter-order). Two v2 details are not
followed: the suffix probe tries one companion form per URL shape, and a
`describedby` link does not locate the index. Neither gap has a reported
failure; treat them as notes, not work.

**Caution:** `llms-full.txt` is not part of the proposal. It is a platform
convention, for example Mintlify's concatenated full-site file[^mintlify-llms-full],
and must not be assumed present. Publication counts are not consumption
evidence: Google states that Google Search does not use
`llms.txt`[^google-ai-optimization].

[^llmstxt-org]: [The /llms.txt file, v2](https://llmstxt.org/)

[^llmstxt-changes]: [llms.txt v1 to v2 changes](https://llmstxt.org/changes.html)

[^llms-txt-license]: [Apache-2.0 license](https://github.com/AnswerDotAI/llms-txt/blob/3700a0a624a4a004c6a246789b37f389940b1b58/LICENSE)

[^mintlify-llms-full]: [Mintlify llms.txt and llms-full.txt](https://www.mintlify.com/docs/ai/llmstxt)

[^google-ai-optimization]: [Google Search does not use llms.txt](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide#mythbusting)
