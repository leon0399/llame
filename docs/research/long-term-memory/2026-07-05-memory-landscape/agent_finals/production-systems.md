# Agent: production-systems — Production memory systems (delivered 2026-07-05T13:55Z)

## Synthesis (production LLM long-term memory, as of July 2026)

**Convergence #1 — everyone ended up with two+ tiers, not one.** Every shipped system separates an explicit/editable layer (user-stated facts, inspectable, deletable) from an implicit/inferred layer built by background synthesis over raw history. ChatGPT: Saved Memories (explicit) + Chat History Reference (implicit, since Apr 2025) + a third "Inferred Profile Context" layer some analysts now describe. Claude.ai converged to the same shape in March 2026 with "Memory Synthesis" (~24h cadence, extractive, user-editable, deletable per-entry) — but it got there from the opposite direction: Claude started retrieval-time-only (`conversation_search` over raw transcripts, zero preloaded profile) and only added write-time synthesis later, while OpenAI started write-time (2024 saved-memories) and is still bolting on synthesis (the June 2026 "Dreaming V3" rewrite, prompted by an internal admission that the original system's time-sensitive accuracy was 9.4%). Gemini (Personal Intelligence, ecosystem-fed) and Grok (X-history-fed, reusable "Skills") both ship the implicit layer but wire it to first-party platform data instead of just chat — a path llame has no equivalent of and shouldn't try to fake.

**Convergence #2 — files as a legitimate memory substrate, not just a stopgap.** Anthropic's API memory tool (Sept 2025, GA since) is deliberately dumb: six file ops (view/create/str_replace/insert/delete/rename), no embeddings, no vector DB, developer owns storage entirely — Anthropic's stated bet is that inspectability beats retrieval sophistication. Claude Code's MEMORY.md/auto-memory follows the identical pattern locally. Letta independently published research ("Is a Filesystem All You Need?", Aug 2025) reaching the same conclusion for agent memory generally. This is the one place OpenAI's approach and Anthropic's diverge hardest: OpenAI's synthesized profile is opaque and un-diffable; Anthropic's philosophy is explicit, greppable, git-diffable, user-auditable.

**Convergence #3 — consolidation moved off the hot path.** Letta's sleep-time agents, Claude's "Dreaming" research preview, and OpenAI's Dreaming V3 all independently landed on: don't extract/dedupe facts inline during the turn; run a slower, stronger model asynchronously over accumulated history. This is a latency/cost optimization as much as a quality one.

**Convergence #4 — temporal/graph modeling is real but not free.** Zep/Graphiti's bi-temporal model (`valid_at`/`invalid_at`, facts invalidated not deleted) solves stale-fact contamination cleanly and is implementable as plain Postgres columns without adopting a graph DB. Mem0's graph variant, by contrast, is a cautionary tale — added Neo4j + multi-stage entity extraction only beat plain vector memory on 2 of 4 LOCOMO categories, with no clear explanation, i.e., graph complexity didn't pay for itself uniformly. Benchmark numbers across vendors (LongMemEval: Mem0 ~49%, Zep ~64%, Letta ~83%, Supermemory ~81-85% self-reported) are inconsistent and self-reported enough to be untrustworthy in isolation.

**Failure modes that matter for a self-hosted multi-tenant product:** memory poisoning (MINJA, >95% injection success against production agents; EchoLeak zero-click; "AI Recommendation Poisoning" via hidden instructions in summarized web content) is a write-time ingestion problem — almost no shipped system validates content at write time, only Hermes Agent's `sanitize_context()` explicitly re-frames recalled memory as untrusted data at _recall_ time. Given llame's tenant-isolation invariant, this is higher stakes than for a single-user assistant.

**Recommendation for llame's stack:** skip Neo4j/graph memory for MVP — no consistent uplift, and it breaks the "apps/api is sole DB owner" invariant. Build an explicit, row-based `memory_facts` table (Memori-style: structured columns, not blobs) scoped by `user_id`/`project_id` and enforced by the existing RLS pattern, not a bespoke ACL. Add `valid_at`/`invalid_at`/`recorded_at` columns cheaply (Zep's bi-temporal idea, no graph DB required). Do extraction as an async pg-boss job (already in the stack) post-turn, not inline — matches sleep-time-compute convergence. Store facts as inspectable/editable rows the user can see and delete (Anthropic philosophy) rather than an opaque synthesized profile (OpenAI philosophy). At inference time, wrap injected memory in explicit "recalled data, not instruction" framing to blunt injection risk, since llame's multi-tenant self-hosted nature makes cross-tenant memory contamination a materially worse failure than for ChatGPT/Claude's single-tenant SaaS deployments.

## Evidence (JSON)

```json
[
  {
    "claim": "Claude's pre-2026 memory was pure retrieval-time search over raw conversations with zero preloaded profile, the opposite of ChatGPT's precomputed-profile model.",
    "evidence_quote": "Claude starts every conversation with a blank slate... memory only activates when you explicitly invoke it... Claude recalls by only referring to your raw conversation history, with no AI-generated summaries or compressed profiles",
    "source_url": "https://www.shloked.com/writing/claude-memory",
    "source_title": "Claude Memory: A Different Philosophy | Shlok Khemani",
    "confidence": "moderate"
  },
  {
    "claim": "Anthropic's API memory tool is a plain client-side file system with six operations and no embeddings/vector DB/knowledge graph.",
    "evidence_quote": "Claude stores memories as files in a directory on your filesystem (typically /memories)... without using embeddings, vector databases, or knowledge graphs—just files",
    "source_url": "https://www.shloked.com/writing/claude-memory-tool",
    "source_title": "Anthropic's Opinionated Memory Bet | Shlok Khemani",
    "confidence": "moderate"
  },
  {
    "claim": "Anthropic's memory tool went GA with reported internal gains of 39% task improvement and 84% token reduction combined with context editing.",
    "evidence_quote": "Anthropic's internal evaluations reported a 39% improvement when combining memory with context editing on agentic search tasks, and 84% token reduction in their 100-turn web search evaluation.",
    "source_url": "https://anthropic.com/news/context-management",
    "source_title": "Managing context on the Claude Developer Platform | Claude by Anthropic",
    "confidence": "moderate"
  },
  {
    "claim": "OpenAI rewrote ChatGPT's memory architecture in June 2026 ('Dreaming V3') after acknowledging the original system's time-sensitive accuracy was extremely poor (9.4%).",
    "evidence_quote": "time-sensitive memory accuracy moving from just 9.4% under the original 2024 memory system to 75.1% under the new system",
    "source_url": "https://www.techtimes.com/articles/317840/20260605/chatgpt-memory-dreaming-update-openai-rewrites-personalization-engine-limits-audit-trail.htm",
    "source_title": "ChatGPT Memory Dreaming Update: OpenAI Rewrites Personalization Engine",
    "confidence": "low"
  },
  {
    "claim": "ChatGPT memory contamination was a known early complaint — old saved details bleeding into unrelated new chats.",
    "evidence_quote": "for many users, it turned into a frustrating hurdle that stifled creativity and led to unreliable responses, with old details derailing new chats",
    "source_url": "https://medium.com/@nirajkvinit/the-double-edged-sword-of-chatgpts-memory-promise-pitfalls-and-practical-fixes-298359dcb1a5",
    "source_title": "The Double-Edged Sword of ChatGPT's Memory",
    "confidence": "low"
  },
  {
    "claim": "Claude.ai rolled out account-wide 'Memory Synthesis' to all plans including free tier on March 2, 2026, distilling conversations roughly every 24 hours into a stored, user-visible/editable profile.",
    "evidence_quote": "Chat Memory relies on 'Memory Synthesis,' where Claude automatically processes conversations, distilling long-term-worthy information roughly every 24 hours... with these summaries stored in a Memory profile",
    "source_url": "https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use",
    "source_title": "Claude Memory 2026: Complete Guide",
    "confidence": "low"
  },
  {
    "claim": "Letta's sleep-time compute separates memory management into an asynchronous background agent that can use a stronger/slower model than the latency-constrained conversational agent.",
    "evidence_quote": "it is useful to make the sleep-time agents stronger models since they are less latency constrained, while the conversational primary agent can use a faster model",
    "source_url": "https://www.letta.com/blog/sleep-time-compute/",
    "source_title": "Sleep-time Compute | Letta",
    "confidence": "moderate"
  },
  {
    "claim": "Letta published research directly asking whether a plain filesystem suffices for agent memory, reflecting a filesystem-centric direction shared with Anthropic's design.",
    "evidence_quote": "Letta even published research specifically framed as 'Benchmarking AI Agent Memory: Is a Filesystem All You Need?' (August 12, 2025)",
    "source_url": "https://www.letta.com/blog/agent-memory/",
    "source_title": "Agent Memory: How to Build Agents That Learn and Remember | Letta",
    "confidence": "low"
  },
  {
    "claim": "Mem0's two-phase pipeline extracts structured facts then resolves conflicts/updates rather than deleting outdated memories, relying on retrieval decay instead of explicit forgetting (except for direct contradictions).",
    "evidence_quote": "Mem0 doesn't explicitly delete outdated information — rather than explicitly deleting old data, Mem0 'forgets' by selectively storing only the most salient facts and preferences... though DELETE operations exist for contradictions",
    "source_url": "https://memo.d.foundation/breakdown/mem0",
    "source_title": "Mem0 & Mem0-Graph breakdown - Dwarves Memo",
    "confidence": "moderate"
  },
  {
    "claim": "Mem0's graph-memory variant added significant architectural complexity (Neo4j, multi-stage entity/relation extraction) but only beat plain vector memory in 2 of 4 evaluated reasoning categories, with no explanation given by the authors.",
    "evidence_quote": "Mem0g only performed better than Mem0 in the Open-Domain and Temporal categories, and the authors did not provide an in-depth analysis of why this was the case",
    "source_url": "https://www.emergentmind.com/topics/mem0-system",
    "source_title": "Mem0: Scalable Memory Architecture",
    "confidence": "moderate"
  },
  {
    "claim": "Mem0 raised a $24M Series A (Oct 2025) and is used by AWS as the exclusive memory provider for its Agent SDK (Strands) as of May 2025.",
    "evidence_quote": "Mem0 raises $24M from YC, Peak XV and Basis Set to build the memory layer for AI apps... in May 2025, AWS selected Mem0 as the exclusive memory provider for its Agent SDK (Strands)",
    "source_url": "https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/",
    "source_title": "Mem0 raises $24M from YC, Peak XV and Basis Set",
    "confidence": "moderate"
  },
  {
    "claim": "Graphiti/Zep's bi-temporal model tracks four timestamps distinguishing when a fact was true in the world vs. when the system ingested/invalidated it, so superseded facts are invalidated rather than deleted.",
    "evidence_quote": "the system tracks four timestamps: t′created and t′expired monitor when facts are created or invalidated in the system, while tvalid and tinvalid track the temporal range during which facts held true",
    "source_url": "https://arxiv.org/html/2501.13956v1",
    "source_title": "Zep: A Temporal Knowledge Graph Architecture for Agent Memory",
    "confidence": "high"
  },
  {
    "claim": "Zep repositioned itself in its v3 launch from 'memory' to a broader 'context engineering' / enterprise 'Context Lake' platform, distinguishing memory from RAG as a technique.",
    "evidence_quote": "RAG retrieves documents from a corpus and adds them to the prompt, while context engineering covers user memory, business data, event streams, temporal validity, governance... RAG is a tactic, context engineering is the practice",
    "source_url": "https://www.getzep.com/solutions/context-engineering/",
    "source_title": "Context Engineering for AI Agents — Zep",
    "confidence": "moderate"
  },
  {
    "claim": "MINJA demonstrates memory-injection attacks against production agents achieving over 95% injection success purely through query-only interaction, no direct memory-store access needed.",
    "evidence_quote": "MINJA research shows over 95% injection success rates against production agents... via query-only interaction, without any direct access to the memory store itself",
    "source_url": "https://arxiv.org/pdf/2605.15338",
    "source_title": "Hidden in Memory: Sleeper Memory Poisoning in LLM Agents",
    "confidence": "low"
  },
  {
    "claim": "Memory poisoning is architecturally distinct from prompt injection because the attack and its trigger are temporally decoupled, persisting past the session that planted it.",
    "evidence_quote": "memory poisoning is a persistence problem where the attack and its effect are temporally decoupled — an instruction planted today executes weeks later, triggered by a completely unrelated interaction",
    "source_url": "https://christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents/",
    "source_title": "Memory poisoning in AI agents: exploits that wait",
    "confidence": "moderate"
  },
  {
    "claim": "Unit 42 demonstrated a real webpage-triggered memory poisoning attack against Amazon Bedrock Agents that persisted across sessions and exfiltrated data silently.",
    "evidence_quote": "a crafted webpage URL, when fetched by the agent, caused malicious XML-structured instructions to be written into session memory, persisting across conversations and silently exfiltrating data on all future interactions",
    "source_url": "https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/",
    "source_title": "Indirect Prompt Injection: Attacks, Defenses, and the 2026 State of the Art",
    "confidence": "low"
  },
  {
    "claim": "OWASP's 2026 agentic-risk taxonomy (ASI06) formally recognizes memory poisoning as a top risk category, and OpenAI/Anthropic/DeepMind have publicly stated prompt injection can't be fully solved at current architecture level.",
    "evidence_quote": "OWASP's ASI06 recognizes this as a top agentic risk for 2026... OpenAI, Anthropic, and Google DeepMind acknowledged in 2025 publications that prompt injection cannot be fully solved within current LLM architectures",
    "source_url": "https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/",
    "source_title": "Indirect Prompt Injection: Attacks, Defenses, and the 2026 State of the Art",
    "confidence": "low"
  },
  {
    "claim": "LongMemEval benchmark scores for memory systems vary wildly across self-reported sources (Mem0 ~49%, Zep ~63.8%, Letta ~83.2%, Supermemory ~81.6-85.4%), indicating benchmark claims should be treated skeptically.",
    "evidence_quote": "Zep ~63.8%, Supermemory ~81.6–85.4% (self-reported higher), Letta ~83.2%, Hindsight ~91.4%, and Mem0 ~49% Mem0 scores 49% on LongMemEval vs. 63-91% for alternatives",
    "source_url": "https://atlan.com/know/best-ai-agent-memory-frameworks-2026/",
    "source_title": "Best AI Agent Memory Frameworks in 2026: Compared and Ranked",
    "confidence": "low"
  },
  {
    "claim": "Memori takes a SQL-native approach, storing memory as normalized relational tables (facts, entities, events, preferences) with explicit temporal versioning, rather than vector chunks or opaque profiles — positioned for enterprise/compliance/multi-tenant use.",
    "evidence_quote": "Memori uses relational databases like Postgres or MySQL as its primary store, with memory kept in normalized tables (facts, entities, events, preferences, policies) with explicit columns instead of free-form text blobs, and temporal versioning where each memory entry is time-aware",
    "source_url": "https://www.mempalace.tech/blog/best-ai-memory-frameworks-2026",
    "source_title": "Best AI Memory Frameworks in 2026 — Ranked & Compared",
    "confidence": "low"
  },
  {
    "claim": "Claude Code's auto-memory (MEMORY.md) is loaded into the system prompt at session start with a hard 200-line/25KB cap, with overflow content moved to on-demand topic files.",
    "evidence_quote": "there's a 200-line hard limit (found verbatim in the bundle: var U_ = \"MEMORY.md\", pZ = 200), and if exceeded Claude only gets the first 200 lines plus a warning",
    "source_url": "https://giuseppegurgone.com/claude-memory",
    "source_title": "Claude Code's Experimental Memory System",
    "confidence": "low"
  }
]
```
