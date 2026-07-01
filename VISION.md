# llame Vision

llame is a self-hosted AI operating layer, not a chat UI with a database bolted on.
This document explains *why* the platform is shaped the way [SPEC.md](SPEC.md) describes, what's next, and what we deliberately won't build yet.
Project overview and quickstart: [README.md](README.md).
Detailed architecture and data model: [SPEC.md](SPEC.md).
Execution order: [ROADMAP.md](ROADMAP.md).

We are early — a chat proof-of-concept exists, the real platform doesn't yet. Iteration is fast and this document will be wrong in places within a few milestones; that's expected.

## Current focus

Per [ROADMAP.md](ROADMAP.md):

- Reducing the chat proof-of-concept to a clean single-model Q&A loop (v0.1).
- Moving that loop off the request thread and into a durable, worker-processed run with a refresh-safe event stream (v0.2).

Next: multi-user identity and policy, BYOK model routing, and projects (v0.3–v0.5) — the governance layer only gets built once there's more than one user and one model to govern.

## Core bets

The architecture in SPEC.md follows from a small number of opinionated bets, not from feature-checklist completeness:

- **Multi-tenant from day one, in the data model only.** Every resource carries ownership/scope columns from the start so nothing is a rewrite later — but the RBAC engine itself ships in v0.3, when there's an actual second user to govern. (SPEC §5–§6)
- **Durable state over prompt tricks.** Todos, goals, memories, artifacts, and tool calls are structured rows, not hidden context that evaporates on refresh. (SPEC §5, §9)
- **Wiki is memory, not a side upload.** A user's or org's existing knowledge base — Obsidian, Notion, a Git repo of docs — is the long-term memory substrate, continuously indexed, not a one-off file attachment. (SPEC §5, §15)
- **BYOK means truly user-owned.** The instance boots with zero model providers configured and still works once a user supplies their own key. (SPEC §5, §14)
- **Policy before capability, deny overrides allow.** A tool, connector, or skill being installed is not the same as it being usable. (SPEC §5, §7)

## Emerging directions (not yet spec'd)

These extend the picture in SPEC.md but haven't been through design review yet. Each needs its own brainstorm → spec → roadmap slot before implementation — this section is a holding pen, not a commitment.

**Assistant personas.** A named persona (system prompt + role framing + scoped knowledge/tools) a user or project can pick or define, the same primitive as this harness's subagent types and OpenClaw's persona presets. Likely builds on the skill/scope model already in SPEC §12 rather than becoming a new subsystem — a persona is closer to "a skill that also sets identity" than to a new agent-hierarchy layer (see non-goals below).

**Machine connector (Cowork/Dispatch-style).** Let a user register their own existing machine as a connector so the assistant can run authorized actions on it directly — same shape as Claude Cowork/Dispatch. This is a connector under SPEC §13, not a new execution model: it still goes through tool classification, approval policy, and sandboxing like any other write/execute-capable tool.

**"Brain" — durable personalized memory surface.** Named after the memory module in PewDiePie's Odysseus AI workspace (a local vector-backed store that recalls client details, preferences, and recurring workflows across sessions, separate from "brain" meaning the underlying LLM). llame already plans a memory layer in SPEC §20 (episodic/semantic/procedural, per the Hermes Agent lesson in §2.1); "Brain" is really the user-facing product surface for that layer — a place a user can see, edit, and trust what the assistant remembers about them, not a new storage architecture.

**Email and calendar as a first-class surface.** Beyond giving the model read access to mail/calendar as tool calls, actually surface them in the UI so the assistant becomes an all-in-one daily-driver toolkit, not just a tool-caller that happens to read your inbox. Write access is a policy-gated action like any connector (see non-goals).

**n8n-style in-app workflows.** Automations (triggered by the assistant, a user, or an event — new mail, a webhook, a schedule) that wire together the app's own primitives: knowledge bases, tools, personas/"assistants," Brain memory, and agents. SPEC §35 already flags a "visual workflow builder" as a post-1.0 candidate; the likely path is integrating with n8n itself (or an equivalent) rather than rebuilding a workflow engine from scratch (see non-goals).

## What We Will Not Build (For Now)

Full non-goals list: [SPEC §4](SPEC.md#4-non-goals). Guardrails specific to the directions above:

- No unsandboxed, arbitrary machine/shell access from chat — the machine connector goes through the same approval and sandbox policy as any other execute-capable tool, no exceptions for "it's the user's own machine."
- No agent-hierarchy-by-default architecture (manager-of-managers, nested planner trees). Personas are prompt + scope, not a new orchestration layer, until evals show a single-loop harness genuinely can't do the job.
- No calendar/email write access without explicit per-action approval — reading your inbox to help is not the same as sending on your behalf.
- No n8n reimplementation. Integrate with n8n (or a comparable existing engine) rather than building a competing workflow runtime.

This list is a guardrail, not a law — a strong technical reason can move something off it, but it needs to be argued, not defaulted into.
