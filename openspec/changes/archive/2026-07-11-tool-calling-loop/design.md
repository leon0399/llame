## Context

Runs today are single-shot: `RunExecutionService` makes one model call and streams text/reasoning to completion (pg-boss worker, run-event bridge, refresh-safe replay — SPEC §9). The product requires an agent loop: model ⇄ tools inside the same durable run. Requirements ground truth: SPEC §13.5 (tool safety classification), §7.5 (approval types — deliberately NOT consumed yet), §9.4 (event stream/replay), VISION "policy before capability, deny overrides allow".

This spec is written from requirements, not from the existing `stack/split-tool-loop` branch (#142, rebased onto master in parallel). After both land, spec-vs-reality decides salvage/partial/redo — the instance-config precedent (redo) and the policy-engine rebase (vindicated) show either outcome is live.

Ordering decision that shapes scope (agreed 2026-07-10): the tool loop ships **before** the policy engine (#133, parked). Rationale: deny-overrides-allow only has meaning once a second scope can _grant_ capability (org/user grants — none exist yet); the operator allowlist in `llame.config.json` is fail-closed policy at the only scope that exists. The registry/gate seam is designed so #133 later replaces "allowlist" with "capability composition minus denies" without touching the loop.

## Goals / Non-Goals

**Goals:**

- Multi-step tool execution inside the existing durable run architecture — no second execution path, no request-thread execution.
- Fail-closed availability at every layer: default-empty operator allowlist; read-only-only execution; refuse-not-crash on anything else.
- Datastore-enforced tenant isolation inside tools (runAs/RLS), proven by negative tests.
- Tool activity as first-class durable data: parts + run events, replayable, rendered in the UI, excluded from public shares.
- A registry interface that MCP servers/connectors (§13) can later implement without reworking the loop.

**Non-Goals:**

- §7.5 approvals and any non-read-only tool (arrives with the first write tool).
- MCP host, connectors, skills-as-tools (later slices; interface-compatible, not implemented).
- Policy engine integration (#133 parked; seam documented above).
- Token/cost budgets (#91) — only the dumb step cap here.
- Org/user tool grants; per-chat tool toggles; UI for managing tools.

## Decisions

### D1. The loop lives in the run executor, transport-agnostically

Extend `RunExecutionService`'s execution step (model call → observe → maybe tool → continue) rather than adding any new service on the HTTP path. Everything rides the existing worker/heartbeat/event-bridge machinery, so refresh-resume and multi-consumer replay come for free. The repo rule "don't couple RunExecutionService to HTTP" stands. Whether the loop is SDK-driven (`streamText` multi-step + step callbacks) or hand-rolled around single-step calls is an implementation-phase choice — the behavior spec is satisfiable by either, the run-event emission requirement will decide it, and the rebased #142's working answer informs it. Step semantics regardless of driver: a step = one model turn that requested tools; parallel calls within a turn = one step, executed concurrently, each with its own parts.

### D2. In-code registry; classification is part of the tool's type

A tool = `{ id, description, inputSchema, classification, execute(ctx, args) }` registered in an api-side registry module. Classification (§13.5 enum) is a required field of the type — an unclassified tool is unrepresentable, and startup validates the registry (fail loud). Deliberate foundation-over-YAGNI (owner-ratified): six of the seven enum values are dead this slice (only `read_only` executes), but the enum is SPEC-mandated vocabulary, costs one union type, and avoids re-touching every tool definition when the first write tool + approvals arrive. `execute` receives a context carrying the tenant transaction handle (D4) and never raw credentials. The interface is deliberately the shape an MCP-backed tool adapter can implement later (id/schema/execute), so §13 slots in as "another registry source", not a new loop.

### D3. Availability = operator allowlist now, composition later

`tools.allowed` (instance config, strict schema, default empty) is the entire availability story this slice. The gate applies in BOTH directions: unlisted/non-read-only tools are not advertised in the model request AND are refused if the model requests them anyway (hallucinated tool names get the same structured refusal). Unknown ids in the allowlist fail boot — a typo must not silently disable a tool. When #133 lands, this gate's input becomes `compose(system ∪ grants) − denies`; the gate itself doesn't change.

### D4. Tools execute inside the owner's tenant transaction

The loop resolves the run's owner once and hands tools a context whose only datastore access path is `runAs(ownerUserId)` — RLS enforces isolation below the tool author's code. No identity → the tool call fails closed with a structured error. This is the same trust posture as the rest of the api: isolation in the datastore, not in conventions.

### D5. Tool activity is parts + events; parts use the AI SDK vocabulary (reference-verified)

Persisted message parts and the UI stream use the **AI SDK tool-part shapes** (`type: "tool-<name>"`, `toolCallId`, `state: input-available → output-available | output-error`, `input`/`output`); internal `run_events` use llame-owned tool event types; the run-stream bridge maps between them — exactly how text/reasoning already work. Verified against the reference checkouts (2026-07-10): vercel/ai-chatbot (our exact stack) persists SDK-native `UIMessage` tool parts verbatim with zero-transform DB→UI rendering; claude-code and open-webui likewise persist their provider's native vocabulary; the only repo with a fully custom vocabulary (opencode) owns its entire LLM abstraction, which we don't. llame's existing split (llame-owned events for durable replay, SDK-shaped parts for persistence/rendering) is already the hybrid of the two sound patterns — tool parts follow it. Results are atomic (no delta-streaming of tool output in this slice; truncation caps result size at ~16KB with a visible truncation notice). The llame-owned event types SHOULD align with SPEC §9.4's canonical `tool.*` event vocabulary (`tool.requested/started/completed/…`), with the step-cap event as a distinct type — never shoehorned into `tool.completed` in a way that loses "this was a cap" semantics. The public-share egress allowlist already strips non-text parts; a pinned test keeps that true for the new part types.

### D6. Failure semantics: observe, don't crash; cap fails closed to answering; timeouts registry-owned

Tool errors become structured error results the model can see (retry/alternate/answer); they never fail the run and never carry stack traces or config values (same redaction posture as instance-config). At `tools.maxStepsPerRun` (built-in default 8, operator-tunable via instance config), the loop stops offering tools from the next turn onward (the cap-reaching step completes atomically) and drives the model to answer from accumulated context; the cap is recorded as a run event AND persisted as a cap-marker part on the assistant message (history renders from parts, not events) AND surfaced in the UI as a small inline notice — degraded behavior must be visible (the repo's disabled-not-hidden convention generalized), and if users see it often the default is wrong and we want that signal. Timeouts: the registry wraps every `execute()` in `AbortSignal.timeout(effective)` where `effective = tool.timeoutSeconds ?? config.tools.callTimeoutSeconds` (global default 15s) — per-tool override at registration, no SDK dependency (the wrapper is ours). Timeout = a structured error result like any other tool failure.

### D6b. No mid-run checkpointing; read-only makes re-execution safe (write-tool landmine)

If the worker dies mid-loop (crash, OOM, deadman expiry), the run fails/expires per existing semantics and completed tool steps are NOT checkpointed — a retry starts a fresh loop and re-executes tools. Deliberately thin: safe precisely because this slice is read-only-only (re-running a search is harmless). **Landmine, spec-pinned: the first write-capable tool MUST introduce checkpoint-or-dedupe before it ships** — re-execution of writes on retry is not acceptable. (Client refresh-mid-run is unaffected: run-event replay covers it, no re-execution involved.)

### D7. First tool: own-data read only; no network egress; ONE search path

Slice ships exactly one tool: conversation search. It SHALL be wired through the **same server-side search implementation the UI's chat search uses** (#143's search service) — not a parallel query path — so any future search upgrade (vector/embedding/hybrid retrieval — #172) lands in the UI and the tool simultaneously; the same holds for scope: today the service is owner-scoped (`searchByOwner`), and if project-shared chats ever broaden it, both surfaces broaden together (with the negative tests re-ratified then). Explicitly no `fetch_url`/web-search style tools: an outbound request with model-controlled parameters is an exfiltration channel for private context (§7.5 names it), which is approval-framework territory regardless of the tool being "read-only" from llame's perspective.

### D8. Prompt-injection posture for tool results

Tool results are untrusted data entering the context (a searched conversation may contain adversarial text). Mitigations in this slice: results are wrapped/framed as data (not instructions) in the model context; result size is capped; tools return structured fields rather than free-form blobs where possible. The deeper injection story (sanitization, provenance framing per the Hermes recall-time pattern) belongs to the memory/knowledge slices — flagged, not solved here.

## Risks / Trade-offs

- **[Model hallucinates tool names/args]** → structured refusal/validation-error results (D3/D6); input schemas validated before execution; never crashes the run.
- **[Tool result injection steers the model]** → D8 mitigations now; full sanitization framework deferred and tracked with memory/knowledge work.
- **[Step cap too blunt]** → deliberately dumb (count only); #91 owns token/cost budgets. Cap value operator-tunable.
- **[Registry grows write tools before approvals exist]** → classification gate refuses execution regardless of registration/allowlist (belt) and review convention keeps them out of the registry (suspenders).
- **[Large tool results bloat context/compaction]** → result-size truncation cap; compaction already handles long contexts; per-model thresholds arrive with #167/#168.
- **[Model without tool support picked while tools are allowlisted]** → provider call errors at request time. Accepted assumption for this slice: all system-catalog models are OpenAI tool-capable — documented, not built around. The proper fix is a `supportsTools` capability flag on catalog entries, which belongs to providers-and-models-as-code (#167).
- **[UI part rendering drifts from persistence shape]** → same part types render live (stream) and historical (persisted) paths; e2e covers both.

## Migration Plan

1. Registry + classification + config-schema extension (`tools.allowed`, `tools.maxStepsPerRun`) — boot-validated, default-empty.
2. Loop in the run executor + parts/events persistence + bridge streaming.
3. First tool (conversation search) + tenant-isolation negative tests + e2e (live + historical rendering, refresh-mid-tool).
4. Web rendering of tool parts.
5. Docs: example config gains a commented `tools` block; SPEC §13 note that the loop implements §13.5 classification with read-only-only execution pre-approvals.
6. Compare against rebased #142; salvage/close per the comparison (separate step, user-driven).

## Open Questions

None — resolved in the 2026-07-10 grill: parts vocabulary = AI SDK shapes for parts/UI + llame-owned run events (reference-verified, D5); first tool = conversation search only, through the UI's search service (D7); `tools.maxStepsPerRun` in instance config, default 8; global `tools.callTimeoutSeconds` (default 15) + per-tool registration override (D6); cap visible in UI (D6); result truncation ~16KB; no mid-run checkpointing, write-tool landmine pinned (D6b).
