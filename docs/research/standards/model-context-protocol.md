---
type: Reference
title: "Model Context Protocol (MCP)"
description: "Revisions after 2025-06-18 and the Skills extension"
resource: "https://modelcontextprotocol.io/specification"
observed:
  date: "2026-09-27"
  revision: "ab3a39c13bd23be691c2760e1c6c5c15a64582e1"
sources:
  - id: mcp-schema-tree
    resource: "https://github.com/modelcontextprotocol/modelcontextprotocol/tree/ab3a39c13bd23be691c2760e1c6c5c15a64582e1/schema"
    title: "MCP schema revisions"
  - id: mcp-changelog-2025-11-25
    resource: "https://modelcontextprotocol.io/specification/2025-11-25/changelog"
    title: "MCP 2025-11-25 changelog"
  - id: mcp-changelog-2026-07-28
    resource: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
    title: "MCP 2026-07-28 changelog"
  - id: mcp-versioning
    resource: "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning"
    title: "MCP versioning and compatibility"
  - id: lf-aaif
    resource: "https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation"
    title: "Linux Foundation announces the Agentic AI Foundation"
  - id: aaif-skills-over-mcp
    resource: "https://aaif.io/blog/skills-over-mcp"
    title: "Skills over MCP"
  - id: sep-2640
    resource: "https://modelcontextprotocol.io/seps/2640-skills-extension"
    title: "SEP-2640 Skills extension"
  - id: ext-skills-spec
    resource: "https://github.com/modelcontextprotocol/ext-skills/blob/b0b3272f1d4c01a79c8171252c70b06dcada18bf/specification/stable/skills.mdx"
    title: "Skills extension specification"
  - id: mcp-client-matrix
    resource: "https://modelcontextprotocol.io/extensions/client-matrix"
    title: "Extension client support matrix"
---

# Model Context Protocol (MCP)

- **Status:** current revision `2026-07-28`; a rolling draft follows
  it[^mcp-versioning]. Contributed to the Linux Foundation's Agentic AI
  Foundation (AAIF), formed 2025-12-09 with MCP, goose and AGENTS.md as
  founding projects[^lf-aaif]. New contributions are Apache-2.0; older ones
  remain MIT.

Only two dated revisions follow `2025-06-18`[^mcp-schema-tree]. llame's
transport choices are studied in
[MCP transport](../tool-harness/2026-08-07-mcp-transport.md) and
[MCP stdio](../tool-harness/2026-08-12-mcp-stdio.md); this note records the
protocol deltas since then.

**2025-11-25**[^mcp-changelog-2025-11-25]

1. **Authorization.** OpenID Connect discovery, incremental scope consent via
   `WWW-Authenticate`, and Client ID Metadata Documents as the recommended
   registration.
2. **Elicitation and sampling.** URL-mode elicitation for out-of-band
   interaction; sampling may carry `tools` and `toolChoice`.
3. **Tasks.** Experimental durable requests with polling and deferred results.
4. **Schema.** JSON Schema 2020-12 as default dialect, icons, tool-name
   guidance; invalid tool input is a tool execution error the model can see.

**2026-07-28, breaking**[^mcp-changelog-2026-07-28]

1. **Stateless core.** `initialize` and `Mcp-Session-Id` are gone; each request
   carries its version and capabilities in `_meta`, and a mandatory
   `server/discover` advertises versions and capabilities.
2. **Multi-round-trip requests.** Server-initiated sampling, elicitation and
   `roots/list` are replaced by results that return `inputRequests` for the
   client to answer on retry.
3. **Subscriptions and tasks.** `subscriptions/listen` replaces GET streams and
   resource subscriptions; SSE resumability is removed. Tasks move to the
   `io.modelcontextprotocol/tasks` extension.
4. **Authorization hardening.** Issuer validation, credentials bound to their
   issuer, and Dynamic Client Registration deprecated in favor of Client ID
   Metadata Documents.
5. **Deprecations.** Roots, Sampling, Logging and HTTP+SSE, under a new
   twelve-month deprecation policy.

**Skills over MCP.** The AAIF post (2026-06-18) names the gap: a server ships
tool names but not the manual for using them, and separately installed skills
drift from their server[^aaif-skills-over-mcp]. It proposed serving Agent
Skills as `skill://` resources behind a `skill://index.json` catalog. The final
design, SEP-2640 (`io.modelcontextprotocol/skills`, merged 2026-09-13), instead
adds `skills/list` and `skills/get`[^sep-2640]. A listing carries verbatim
frontmatter and a `{uri, digest, size}` manifest; hosts verify the bytes, keep
the server identity with the URI, and bind approval to the manifest so that
changed content needs fresh approval[^ext-skills-spec]. `SKILL.md` format stays
owned by Agent Skills. Client support is still sparse[^mcp-client-matrix].

**llame fit: consumed.** Operator MCP servers ship over stdio and Streamable
HTTP; the newer revisions raise three points:

- **Upgrade gap.** The pinned `@modelcontextprotocol/sdk` 1.29.0 negotiates at
  most `2025-11-25`. A server that speaks only `2026-07-28` cannot complete the
  old handshake with it; how many servers keep dual support is unmeasured.
  Watch SDK releases before operators hit this.
- **Skills over MCP: study.** It would feed llame's skill catalog from
  operator MCP servers. The digest-bound approval model fits llame's provenance
  rules; server-supplied instructions are untrusted input and cannot inherit
  the trust of operator-authored skills.
- **Tasks and multi-round-trip requests** overlap Run lifecycle and approval.
  Map them onto Runs, never beside them.

**Caution:** date-based versions hide how breaking `2026-07-28` is. Extensions
are opt-in and version independently of the core.

[^mcp-schema-tree]: [MCP schema revisions](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/ab3a39c13bd23be691c2760e1c6c5c15a64582e1/schema)

[^mcp-changelog-2025-11-25]: [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)

[^mcp-changelog-2026-07-28]: [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

[^mcp-versioning]: [MCP versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

[^lf-aaif]: [Linux Foundation announces the Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)

[^aaif-skills-over-mcp]: [Skills over MCP](https://aaif.io/blog/skills-over-mcp)

[^sep-2640]: [SEP-2640 Skills extension](https://modelcontextprotocol.io/seps/2640-skills-extension)

[^ext-skills-spec]: [Skills extension specification](https://github.com/modelcontextprotocol/ext-skills/blob/b0b3272f1d4c01a79c8171252c70b06dcada18bf/specification/stable/skills.mdx)

[^mcp-client-matrix]: [Extension client support matrix](https://modelcontextprotocol.io/extensions/client-matrix)
