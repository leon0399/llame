# Tool harness

Research on llame's tool loop, MCP transports, code-mode tools, typed judgments,
question-directed reads, permission classification, prompt caching and decision APIs.

## Studies

- [#215 transport research — MCP Streamable HTTP: spec, client libraries, peers](./2026-08-07-mcp-transport.md) - Reads the current MCP spec, the installed ai and @ai-sdk/mcp sources, and peer MCP consumers to name the Streamable HTTP gaps llame must build, and confirms no #214 decision needs reopening.
- [#214 harness audit — llame's tool loop vs. best practice and four peer harnesses](./2026-08-07-214-harness-audit.md) - Audits llame's tool loop against the agents-best-practices references and four peer harnesses, ranking findings by leverage and recording which open decisions were built, deferred, or settled elsewhere.
- [Code-driven tool calling (eval tool): prior art and issue plan](./2026-09-14-code-mode-eval-tool.md) - Compares eval and code-mode tools across peer harnesses, maps llame seams, and records the phase-1 decisions and issue plan for a Bun-backed eval tool.
- [stdio MCP research — config surface, transport gaps, peer practice](./2026-08-12-mcp-stdio.md) - Examines the stdio MCP config surface, process lifecycle, and transport gaps against installed SDKs and four peer products, finding the authorization contract unchanged and the official transport sufficient to adopt.
- [Provider prompt caching, explicit cache boundaries, and llame's dynamic context](./2026-09-26-prompt-cache-boundaries.md) - How provider KV/prefix caches decide what is reusable, where llame's per-turn and per-chat context sits in the request, and whether it prevents cache sharing between conversations.
- [Decision APIs](./2026-10-08-decision-apis.md) - OpenAI /v1/decisions and the decisionapi.net gateway: typed predicate, choice and score answers, refusal, pricing, and llame applications, with egress, determinism and decision-is-not-authorization cautions.

## Research bundles

- [System One and Jev](./2026-09-23-system-one-jev/index.md) - TypeSafe Jev, OMP's JUDGE role, extractive compaction, community implementations and applicability to llame.
- [Question-directed reads](./2026-09-23-question-directed-read/index.md) - Issue #849: Apple LensVLM, interchangeable local and hosted reader models, and explicitly scoped read-only investigation.
- [Permission classifier cascade](./2026-09-24-permission-classifier-cascade/index.md) - Live Jev experiments across ten llame application families, plus Claude Code, Codex Guardian and eve permission-classifier comparisons for #778.
- [Semantic find and JUDGE](./2026-09-24-semantic-find-judge/index.md) - OMP's semantic find cascade and jegrep, with failure, coverage and benchmark limits.
