---
type: Reference
title: "Hermes Agent"
description: "Recall framing and memory-provider lifecycle"
resource: "https://github.com/NousResearch/hermes-agent"
sources:
  - id: agent-memory-manager-py-l167-l285
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285"
    title: "sanitize_context() and StreamingContextScrubber"
  - id: agent-memory-provider-py-l58-l145
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145"
    title: "MemoryProvider"
  - id: agent-memory-manager-py-l480-l500
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500"
    title: "ordering"
---

# Hermes Agent

- **Stack:** Python; multi-platform gateway; FTS5 session search
- **Observed:** 2026-09-10 @ `6271d772d2dab79ec613c08038ecf3039ad27a0c`

Self-improving agent with agent-curated memory, isolated subagents, and a pluggable memory-provider boundary. The useful comparison is lifecycle and context handling: llame owns Chat/Run identity and isolation, while any future memory implementation would be an adapter behind those boundaries.

**Study**

1. **Recall-time framing and scrubbing.** `sanitize_context()` and `StreamingContextScrubber`[^agent-memory-manager-py-l167-l285] remove fake memory/system framing, handle split tags in streams, and wrap recalled data as reference material. High confidence applicability to llame's model-visible context items; this is a framing control, not a write-time content scan.
2. **Provider lifecycle and boundary ordering.** `MemoryProvider`[^agent-memory-provider-py-l58-l145] defines initialization, prefetch, turn sync, and session callbacks. The manager serializes background writes and queues end-of-session extraction before switching sessions (ordering[^agent-memory-manager-py-l480-l500]). Moderate confidence for future executor or memory adapters; Hermes' session lineage differs from llame's Chat/Run model.

**Caution:** recalled data is described as authoritative reference data inside a known wrapper. That framing does not provide tenant authorization, provenance enforcement, or isolation between users.

[^agent-memory-manager-py-l167-l285]: [`sanitize_context()` and `StreamingContextScrubber`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285)

[^agent-memory-provider-py-l58-l145]: [`MemoryProvider`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145)

[^agent-memory-manager-py-l480-l500]: [ordering](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500)
