---
type: Research
title: "baro / Mozaik cross-run memory exploration notes"
description: "Reads baro's cross-run memory on the Mozaik engine and extracts one transferable idea, run decisions as the memory grain, plus three anti-examples: imperative recall framing, scope leakage and extract-only storage."
tags: [baro, mozaik, cross-run-memory, anti-patterns, mem0]
status: stable
---

# baro / Mozaik cross-run memory — exploration notes (2026-07-07)

Source: [baro blog, "Agents That Remember: Shared Memory for Autonomous Agent Teams"](https://www.baro.rs/blog/agents-that-remember) (JigJoy, Miodrag Todorović). **Vendor marketing post, single source, no eval numbers**, so evidence value is low. Its worth is as a _live specimen_: a shipped 2026 memory system whose design makes several choices the cross-report classifies as mistakes, plus one genuinely good idea.

## What they shipped

baro is a multi-agent coding product (plan → DAG → parallel agent team → PR) on their open-source engine Mozaik. Cross-run memory, live today:

**Stack:** mem0 on Postgres + pgvector; an OpenAI model distills each finished run. **Write path:** a finished run's _decision document_ is distilled into "a handful of durable facts," embedded, and stored keyed to `ownerId`. **Read path:** the next run's goal is embedded, past decisions semantically searched, matches injected into the **architect/planner agent's** context — only the planner, since workers inherit via the plan. **Injection framing (verbatim):** `## Decisions from your past baro runs (reuse these; don't re-decide)` followed by distilled decision bullets. Scope is explicitly cross-repo ("same repo or a different one"). Roadmap, not shipped: intra-run shared memory via broadcast "semantic events" between parallel agents — a coordination bus, not long-term memory.

## The one idea worth adopting

**Decision records as the memory grain for agent runs.** For chat the natural memory unit is a fact/preference; for durable _runs_ (llame's execution model) it is the run's settled decisions. llame's `memory.consolidate` consumer should treat a completed run's decision output, not just conversational turns, as a first-class extraction source. Cheap: `source_kind` already has `agent_inferred`, and a run-decision candidate is `origin_run_id` with higher extraction priority.

## Anti-examples (what not to copy)

1. **Imperative recall framing — "reuse these; don't re-decide."** Recalled memories are injected as _instructions_ with no recall-time validation, no invalidation model and no citations, which is maximal exposure to the stale-decision/poisoning failure mode: a decision since reversed in the repo is injected as settled. Hermes frames recalled content as _data, not instructions_; Copilot _verifies citations against current state_ before use. baro does neither, confirming the cross-report's recall-framing + citation-verification stance by counterexample.
2. **Scope violation by design.** Recall is keyed only to `ownerId` and deliberately crosses repos, so a project-scoped decision ("auth: short-lived JWT, no server sessions") leaks into an unrelated project as a settled constraint — exactly what the scope-inheritance rule (memory scope = conversation/project container, promotion explicit only) exists to prevent. Copilot got this right (repo facts are repo-bound); baro did not.
3. **Extraction-only, no verbatim fallback.** Distill-and-discard on mem0, the architecture the controlled ablation (arXiv:2601.00821) shows losing to verbatim retrieval by 15–22pt. Another data point for "mem0's mindshare is disproportionate to its evidence."

## Neutral confirmations

Planner-only injection matches the eager-injection design (§7 of the cross-report): recall happens at the orchestrator's context-assembly turn and sub-work inherits from the plan. The pipeline shape (async distill after a run completes → small fact set → eager semantic recall) is the same L0/L1 two-tier convergence everyone else shipped. Nothing new.
