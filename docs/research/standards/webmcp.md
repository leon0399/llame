---
type: Reference
title: "WebMCP"
description: "Page-declared tools for browser agents; input for future browser use"
resource: "https://github.com/webmachinelearning/webmcp"
observed:
  date: "2026-09-27"
  revision: "729ae01e68fc8aebfcd876cb05930b5bb0dd7e20"
sources:
  - id: webmcp-spec
    resource: "https://github.com/webmachinelearning/webmcp/blob/729ae01e68fc8aebfcd876cb05930b5bb0dd7e20/index.bs"
    title: "WebMCP specification source"
  - id: webmcp-declarative
    resource: "https://github.com/webmachinelearning/webmcp/blob/729ae01e68fc8aebfcd876cb05930b5bb0dd7e20/declarative-api-explainer.md"
    title: "WebMCP declarative API explainer"
  - id: webmcp-security
    resource: "https://github.com/webmachinelearning/webmcp/blob/729ae01e68fc8aebfcd876cb05930b5bb0dd7e20/security-privacy-questionnaire.md"
    title: "WebMCP security and privacy questionnaire"
  - id: chrome-webmcp
    resource: "https://developer.chrome.com/docs/ai/webmcp"
    title: "WebMCP in Chrome"
  - id: chrome-webmcp-secure
    resource: "https://developer.chrome.com/docs/ai/webmcp/secure-tools"
    title: "WebMCP tool security"
  - id: cloudflare-webmcp
    resource: "https://blog.cloudflare.com/webmcp/"
    title: "Give any website a WebMCP interface"
  - id: cloudflare-browser-run-webmcp
    resource: "https://developers.cloudflare.com/changelog/post/2026-04-15-br-webmcp/"
    title: "Browser Run adds WebMCP support"
  - id: webmcp-issue-288
    resource: "https://github.com/webmachinelearning/webmcp/issues/288"
    title: "Agent that both invokes tools and automates the page"
---

# WebMCP

- **Status:** W3C Web Machine Learning Community Group draft (CG-DRAFT, no
  version number); editors from Microsoft and Google; Chrome origin trial from
  Chrome 149 plus a local testing flag[^webmcp-spec][^chrome-webmcp]

A browser API through which a page registers tools for an agent acting in that
page. Despite the name, it defines no MCP wire: how the browser exposes page
tools to its agent (MCP, proprietary function calling, other) is
implementation-defined[^webmcp-spec].

**Mechanics**

1. **Imperative.** `document.modelContext.registerTool()` takes a name,
   description, JSON Schema `inputSchema`, async `execute(input, {signal})`
   and hints: `readOnlyHint`, `untrustedContentHint`,
   `consequentialHint`[^webmcp-spec]. Same-origin by default; cross-origin
   exposure needs `exposedTo` plus the caller's opt-in, and frames need the
   `tools` Permissions Policy[^webmcp-security].
2. **Declarative.** Annotated `<form toolname tooldescription>` elements
   compile to a JSON Schema; omitting `toolautosubmit` leaves submission to the
   user. Schema synthesis details are still open[^webmcp-declarative].
3. **Lifetime.** Registrations are document-scoped and vanish on navigation;
   a page must be loaded before its tools exist.
4. **Cloudflare.** An edge bridge injects scripts that register WebMCP tools,
   including one that proxies an origin's real MCP server under the visitor's
   session[^cloudflare-webmcp]. Browser Run exposes page tools to agents over
   CDP with optional human confirmation[^cloudflare-browser-run-webmcp].

**llame fit: study for future browser use.** llame has no browser automation;
the headless render inside web `read` is not WebMCP support. A future browser
executor could prefer page-declared tools over DOM and screenshot actuation,
while llame keeps browser session identity, provenance and approvals. Page tool
metadata and results are untrusted model input, like fetched web
text[^chrome-webmcp-secure].

**Caution:** `consequentialHint` is a page's claim, not user consent. An agent
that both calls tools and drives the DOM can click a page's own approval
control ([issue 288](https://github.com/webmachinelearning/webmcp/issues/288)[^webmcp-issue-288]),
so approval must stay in llame's permission path. Authenticated page tools
inherit the page session's full authority. The draft changes weekly.

[^webmcp-spec]: [WebMCP specification source](https://github.com/webmachinelearning/webmcp/blob/729ae01e68fc8aebfcd876cb05930b5bb0dd7e20/index.bs)

[^webmcp-declarative]: [WebMCP declarative API explainer](https://github.com/webmachinelearning/webmcp/blob/729ae01e68fc8aebfcd876cb05930b5bb0dd7e20/declarative-api-explainer.md)

[^webmcp-security]: [WebMCP security and privacy questionnaire](https://github.com/webmachinelearning/webmcp/blob/729ae01e68fc8aebfcd876cb05930b5bb0dd7e20/security-privacy-questionnaire.md)

[^chrome-webmcp]: [WebMCP in Chrome](https://developer.chrome.com/docs/ai/webmcp)

[^chrome-webmcp-secure]: [WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

[^cloudflare-webmcp]: [Give any website a WebMCP interface](https://blog.cloudflare.com/webmcp/)

[^cloudflare-browser-run-webmcp]: [Browser Run adds WebMCP support](https://developers.cloudflare.com/changelog/post/2026-04-15-br-webmcp/)

[^webmcp-issue-288]: [Agent that both invokes tools and automates the page](https://github.com/webmachinelearning/webmcp/issues/288)
