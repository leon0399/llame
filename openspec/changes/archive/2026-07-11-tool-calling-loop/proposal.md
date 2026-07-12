## Why

llame's runs are single-shot today: one model call, one streamed reply. The product promise (README: "durable agent runs", skills, connectors, MCP) requires the assistant to _act_ — call a tool, observe the result, continue reasoning — inside the same durable, replayable run architecture that already survives page refreshes. The tool-calling loop is the single highest-leverage capability on the board: it turns chat into an agent, and every later capability (MCP servers, connectors, skills, todos, memory tools) plugs into this loop rather than reinventing execution.

This is a fresh spec written from requirements (SPEC §9 runs, §13.5 tool safety, §7.5 approval policies, VISION "policy before capability") — deliberately not derived from the existing `stack/split-tool-loop` branch, which will be compared against this spec afterward (same method as `instance-config`, which ended in a redo, and the policy-engine rebase, which vindicated the implementation).

## What Changes

- **Multi-step tool-calling run loop.** Inside the transport-agnostic run executor, a run may now interleave model output with tool invocations: the model requests a tool, the loop executes it, appends the result to the run's context, and continues — up to a hard per-run step cap (fail-closed loop guard; the richer token/cost budget stays #91). All within the existing pg-boss worker + run-event stream, so tool progress is refresh-safe and replayable like every other run event (SPEC §9.4).
- **Tool registry with mandatory safety classification.** Every tool declares the SPEC §13.5 classification (`read_only` … `admin`). **This slice executes `read_only` tools only** — the loop refuses any other class even if somehow registered/listed (fail-closed), because the §7.5 approval machinery ships with the first write-capable tool, not before.
- **Fail-closed operator availability gate.** Which tools are available is operator config-as-code: a `tools` namespace in `llame.config.json` (extending the strict-closed `instance-config` schema — add-when-consumed, as designed). **Default: no tools** — an instance that doesn't configure the allowlist runs exactly as today. No policy engine required: the operator allowlist is the only granting scope that exists (org/user capability grants arrive with the parked policy engine #133/#45, whose deny-overrides-allow then subtracts from a real composition).
- **Tenant isolation inside tool execution.** Tools run _as the run's owner_: every datastore access inside a tool goes through the tenant transaction (`runAs(userId)` / RLS), so a tool can never read across tenants; absent identity fails closed. This is an acceptance criterion with a negative test, not a convention.
- **First tool: internal, read-only, own-data — exactly one.** The initial toolset is a single tool: conversation search over the user's own chats, wired through the same search service the web UI uses. No external-network tools in this slice — a network-fetching tool is an exfiltration channel for context (§7.5 lists that explicitly) and belongs behind the approval framework.
- **Durable, visible tool activity.** Tool calls and results persist as structured message parts and stream as run events; the web chat renders tool activity (call → running → result) consistently with the existing parts rendering (reasoning, text).

## Capabilities

### New Capabilities

- `tool-calling`: the run-loop semantics (multi-step, step cap, ordering, failure handling), the tool registry + §13.5 classification with read-only-only execution, tenant-scoped tool execution, persistence/streaming of tool activity, and the UI rendering contract.

### Modified Capabilities

- `instance-config`: the first-slice setting surface gains the `tools` namespace (operator allowlist, default-empty = fail closed) — the first consumer-driven schema extension, exactly the add-when-consumed path D3 reserved.

## Impact

- **API/worker**: run executor gains the loop; run events gain tool-activity event types; message parts gain tool call/result parts (schema addition to `messages.parts` handling + egress rules — tool parts must respect the existing public-share stripping, which already excludes non-text parts).
- **Operator surface**: `tools` key in `llame.config.json` + schema + example; docs updated.
- **Web**: tool-activity rendering in the chat stream.
- **Out of scope (explicitly)**: §7.5 approval flows and any write/execute/external tool; MCP host and connectors (§13) — the registry's interface must not preclude them, but no MCP in this slice; policy-engine integration (#133 parked — the seam is "availability comes from composition; today composition = operator allowlist"); per-run token/cost budgets (#91 — only the dumb step cap here); org/user tool grants.
- **Supersedes-or-salvages**: PR #142 (`stack/split-tool-loop`, rebased onto master in parallel) — decided by spec-vs-reality comparison after both land.
