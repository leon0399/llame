# baro / Mozaik cross-run memory — exploration notes (2026-07-07)

Source: [baro blog, "Agents That Remember: Shared Memory for Autonomous Agent Teams"](https://www.baro.rs/blog/agents-that-remember) (JigJoy, Miodrag Todorović). **Vendor marketing post, single source, no eval numbers** — evidence value is low. Its worth is as a *live specimen*: a shipped 2026 memory system whose design makes several choices the cross-report classifies as mistakes, plus one genuinely good idea.

## What they shipped

baro is a multi-agent coding product (plan → DAG → parallel agent team → PR) on their open-source engine Mozaik. Cross-run memory, live today:

- **Stack:** mem0, backed by Postgres + pgvector; an OpenAI model distills each finished run.
- **Write path:** when a run finishes, its *decision document* is distilled into "a handful of durable facts," embedded, and stored keyed to `ownerId`.
- **Read path:** next run's goal is embedded, past decisions semantically searched, matches injected into the **architect/planner agent's** context (only the planner — workers inherit via the plan).
- **Injection framing (verbatim):** `## Decisions from your past baro runs (reuse these; don't re-decide)` followed by distilled decision bullets.
- Scope: explicitly cross-repo — "same repo or a different one."
- Roadmap (not shipped): intra-run shared memory via broadcast "semantic events" between parallel agents — a coordination bus, not long-term memory.

## The one idea worth adopting

**Decision records as the memory grain for agent runs.** For chat, the natural memory unit is a fact/preference; for durable *runs* (llame's execution model), it's the run's settled decisions. llame's `memory.consolidate` consumer should treat a completed run's decision output — not just conversational turns — as a first-class extraction source. Cheap: `source_kind` already has `agent_inferred`; a run-decision candidate is `origin_run_id` + higher extraction priority.

## Anti-examples (what not to copy)

1. **Imperative recall framing — "reuse these; don't re-decide."** Recalled memories are injected as *instructions*, with no recall-time validation, no invalidation model, no citations. Maximal exposure to the stale-decision / poisoning failure mode: a decision since reversed in the repo is injected as settled. Hermes frames recalled content as *data, not instructions*; Copilot *verifies citations against current state* before use. baro does neither. Confirms the cross-report's recall-framing + citation-verification stance by counterexample.
2. **Scope violation by design.** Recall is keyed only to `ownerId` and deliberately crosses repos. A project-scoped decision ("auth: short-lived JWT, no server sessions") leaks into an unrelated project as a settled constraint — exactly what the scope-inheritance rule (memory scope = conversation/project container; promotion explicit only) exists to prevent. Copilot got this right (repo facts are repo-bound); baro didn't.
3. **Extraction-only, no verbatim fallback.** Distill-and-discard on mem0 — the architecture the controlled ablation (arXiv:2601.00821) shows losing to verbatim retrieval by 15–22pt. Another data point for "mem0's mindshare is disproportionate to its evidence."

## Neutral confirmations

- **Planner-only injection point** matches the eager-injection design (§7 of the cross-report): recall happens at the orchestrator's context-assembly turn; sub-work inherits from the plan rather than each worker running its own recall pass.
- Pipeline shape (async distill after run completes → small fact set → eager semantic recall) is the same L0/L1 two-tier convergence everyone else shipped. Nothing new.
