# Protocols and format standards

Noncanonical references for open protocols, file formats and publishing
conventions that agents and harnesses use to exchange tools, tasks, knowledge,
content and UI. A standard can ship a reference implementation or SDK without
becoming an agentic harness.

Each entry's `observed.date` is when its sources were last inspected.
`revision` is present when the standard lives in a Git repository; web-only
publications carry their version in the Status line. Every entry states a
bold `llame fit:` label with one of three values: **consumed** (shipped llame
behavior already uses the standard), **study** or **watch**. No label records
a decision to adopt; llame's specs define whether and how the application uses
a standard.

## Agent protocols

- [Model Context Protocol](./model-context-protocol.md) — revisions after
  `2025-06-18`, the stateless `2026-07-28` break, and the Skills extension.
- [ACP (Agent Client Protocol)](./agent-client-protocol.md) — client-to-coding-agent
  sessions over stdio; candidate local peer executor adapter.
- [A2A (Agent2Agent)](./agent2agent.md) — task protocol between independent
  agents; candidate remote executor adapter.

## Packaging and discovery

- [Agent Plugins](./agent-plugins.md) — package of Agent Skills and MCP server
  configuration, without a trust model.
- [Agentic Resource Discovery and AI Catalog](./agentic-resource-discovery.md) —
  static catalogs and federated search over agents, servers, skills and
  plugins.

## Web content for agents

- [llms.txt](./llms-txt.md) — path-scoped Markdown index and page companions;
  consumed by llame's web `read`.
- [Markdown for Agents](./markdown-for-agents.md) — Cloudflare's edge
  conversion behind `Accept: text/markdown`; consumed without vendor code.
- [WebMCP](./webmcp.md) — page-declared browser tools; input for future
  browser use.

## Knowledge and UI formats

- [Open Knowledge Format](./open-knowledge-format.md) — Markdown/YAML concepts,
  progressive disclosure and optional provenance, verification and freshness
  metadata.
- [json-render](./json-render.md) — catalog-constrained generative UI streamed as
  JSON Patch lines.

See [agentic harnesses](../harnesses/index.md) for execution runtimes and
[tools and extensions](../tools/index.md) for supporting software.
