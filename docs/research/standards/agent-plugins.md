---
type: Reference
title: "Agent Plugins"
description: "Vendor-neutral package of Agent Skills and MCP server configuration"
resource: "https://agent-plugins.org"
observed:
  date: "2026-09-27"
  revision: "ff8ab5e392cc87bd88d87c060815a87490e51003"
sources:
  - id: agent-plugins-spec
    resource: "https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/spec/1.0.0.md"
    title: "Agent Plugins specification 1.0.0"
  - id: agent-plugins-governance
    resource: "https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/GOVERNANCE.md"
    title: "Agent Plugins governance"
  - id: agent-plugins-future
    resource: "https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/FUTURE_CONSIDERATIONS.md"
    title: "Agent Plugins future considerations"
  - id: agent-plugins-clients
    resource: "https://agent-plugins.org/compatible-clients"
    title: "Compatible clients"
  - id: agent-plugins-mcp
    resource: "https://agent-plugins.org/plugin-authors/mcp-servers"
    title: "MCP servers in a plugin"
  - id: google-agent-plugins
    resource: "https://developers.googleblog.com/agent-plugins-package-your-skills-tools-and-more/"
    title: "Agent Plugins: package your skills, tools and more"
  - id: claude-code-plugins
    resource: "https://code.claude.com/docs/en/plugins"
    title: "Claude Code plugins"
---

# Agent Plugins

- **Status:** v1.0.0 published 2026-07-24, v1.1.0 working draft; individual
  Technical Steering Committee with maintainers from Amazon, Cursor, Microsoft,
  OpenAI and Vercel; spec CC BY 4.0, schemas Apache-2.0[^agent-plugins-spec][^agent-plugins-governance]

A directory package with a root `plugin.json`. The portable core bundles
exactly two component types: Agent Skills under `skills/<name>/SKILL.md` and MCP
servers in a root `mcp.json`[^agent-plugins-spec]. Google announced on
2026-08-06 that it joins as a core maintainer[^google-agent-plugins]; the
pinned maintainers file does not list that person yet.

**Mechanics**[^agent-plugins-spec]

1. **Manifest.** Closed schema: `$schema` and `name` required; `version`,
   author and repository metadata optional. Unknown top-level fields are
   ignored; other violations reject the plugin.
2. **MCP.** `mcp.json` accepts `stdio`, `streamable-http` or deprecated `sse`.
   Remote URLs must be HTTPS except loopback; headers are literal, non-secret
   data; stdio gets only `PLUGIN_ROOT` and `PLUGIN_DATA`
   placeholders[^agent-plugins-mcp]. No portable credential field exists.
3. **Failure isolation.** A bad manifest rejects the package; a bad skill or
   server entry skips only that component.
4. **Extensions.** Agents, commands, hooks and rules stay client-specific under
   reverse-domain `extensions` namespaces.
5. **Adoption.** Listed clients include VS Code, GitHub Copilot, Cursor,
   ChatGPT and Codex, Kiro, Hermes Agent, OpenClaw and OpenHands[^agent-plugins-clients].
   Claude Code keeps its own `.claude-plugin/plugin.json` layout and is not
   listed[^claude-code-plugins].

**llame fit: study.** Both components map onto shipped surfaces: the skill
catalog and operator MCP servers, whose `.mcp.json`-shaped `mcpServers` map
already uses the same transport names. An operator-installed plugin could feed
both, with llame's allowlist, permission groups and runtime tool resolution
unchanged. Owner-installed plugins would be a new tenancy surface.

**Caution:** the core defines no installer, registry, permission model, sandbox,
provenance or signing; those remain future considerations[^agent-plugins-future].
A plugin can start arbitrary stdio processes, so on a multi-user host the
missing trust model is the whole problem, not a detail.

[^agent-plugins-spec]: [Agent Plugins specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/spec/1.0.0.md)

[^agent-plugins-governance]: [Agent Plugins governance](https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/GOVERNANCE.md)

[^agent-plugins-future]: [Agent Plugins future considerations](https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/FUTURE_CONSIDERATIONS.md)

[^agent-plugins-clients]: [Compatible clients](https://agent-plugins.org/compatible-clients)

[^agent-plugins-mcp]: [MCP servers in a plugin](https://agent-plugins.org/plugin-authors/mcp-servers)

[^google-agent-plugins]: [Agent Plugins: package your skills, tools and more](https://developers.googleblog.com/agent-plugins-package-your-skills-tools-and-more/)

[^claude-code-plugins]: [Claude Code plugins](https://code.claude.com/docs/en/plugins)
