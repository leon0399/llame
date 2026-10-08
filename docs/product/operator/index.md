---
summary: "Index of operator runbooks: enabling tools, permissions, Knowledge, skills, MCP, providers, and scaling"
read_when:
  - you need to configure, restrict, deploy, or troubleshoot a llame capability
---

# Operator

The instance configuration is `apps/api/llame.config.jsonc` (default; override
with `LLAME_CONFIG_PATH`). Without an override, whichever single
`llame.config.<ext>` exists there loads; more than one fails startup. Its format is chosen by the file extension: JSONC
(`.jsonc`/`.json`), YAML with anchors and merge keys (`.yaml`/`.yml`), or TOML
(`.toml`). It and every file it references are read when an API or
worker process starts, so a change applies only after every API and worker
process that accepts or executes Runs restarts on the same configuration. Pages
below state additional ordering where a change needs it.

## Tools and permissions

- [Native files](native-files.md): host executor identity, `read`, `edit`,
  `write`, `bash`, Workspace entry, and permission modes.
- [Web reads](web-read.md): `http(s)://` reads, address pinning, and the web
  threat model.
- [Web adapters](web-adapters.md): each `tools.webAdapters` entry, the URLs it
  claims, its requests, and what an allowlist must admit.
- [Web search](web-search.md): Brave engine configuration, fallback chains,
  deadlines, permissions, and result-storage terms.
- [Tool-call permissions](tool-call-permissions.md): `tools.permissions`
  groups, clause matching, and the recommended policy.
- [Tool prompt templates](tool-prompts.md): replacing tool descriptions and
  reading prompt receipts.
- [MCP tools](mcp-tools.md): remote and stdio servers, Workspace MCP, and
  deployment.

## Context sources

- [Personal Knowledge](knowledge.md): `knowledge.root`, Knowledge Spaces, and
  mounts.
- [Skills](skills.md): `skills.directories`, package format, and catalog
  advertisement.
- [Conversation recall](conversation-recall.md): enabling
  `search_conversations` and `conversation_read`.

## Providers and deployment

- [Codex subscription](providers/codex-subscription.md): `openai-codex`.
- [OpenCode Go](providers/opencode-go.md): `opencode-go`.
- [LiteLLM gateway](providers/litellm-gateway.md): `openai-completions`
  entries for vLLM-served models, token usage, and reasoning effort.
- [Horizontal scaling](scaling.md): API and worker topology, worker profiles,
  and capacity.
