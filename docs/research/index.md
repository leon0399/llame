---
okf_version: "0.2"
---

# llame research

Noncanonical research for llame, kept as one
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md)
v0.2 bundle rooted in this directory. [SPEC.md](../../SPEC.md), OpenSpec and
shipped code win any disagreement. Authoring rules are in [AGENTS.md](./AGENTS.md).

## References

- [Agentic harnesses](./harnesses/index.md) - Peer harnesses and protocols ranked by implementation relevance; OMP and OpenClaw are the primary references.
- [Tools and extensions](./tools/index.md) - Plugins, standalone tools, memory services and prompt utilities used by harnesses.
- [Protocols and format standards](./standards/index.md) - MCP, ACP, A2A, Agent Plugins, llms.txt, OKF and related standards.

## Studies

- [Long-term memory](./long-term-memory/index.md) - Cross-chat memory landscape, deep dives and later memory studies.
- [Chat search and episodic recall](./chat-search/index.md) - Conversation search architecture and episodic recall reviews.
- [Tool harness](./tool-harness/index.md) - Tool loop, MCP, code mode, judgments, reads, permissions and prompt caching.
- [Harness transparency](./harness-transparency/index.md) - Disclosing context changes to the model and the owner.
- [Product vision](./product-vision/index.md) - Product direction, local Nodes and federation research.
- [Testing](./testing/index.md) - Test harness and tooling research.

## Records

- [Development pipeline measurements](./development-pipeline.md) - Records measured CI and local timings behind issue #730, showing incremental mutation reuse cut a cold API shard from 76m10s to 2m26s, plus the scope guarantees kept and nine ranked follow-up options. Data: [statistics](./development-pipeline-statistics.json).
- [Model system prompt research provenance](./model-system-prompts.md) - Records that the public system_prompts_leaks corpus served only as comparative research provenance for llame's prompt architecture, with no prompt body copied into runtime assets.
