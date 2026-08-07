# #214 harness audit — llame's tool loop vs. best practice and four peer harnesses

Noncanonical research. Date: 2026-08-07. Scope: issue #214 (catalog-driven dynamic
tool execution), read forward into #215 (remote Streamable HTTP MCP).

Method: audited `apps/api/src/tools/`, `apps/api/src/runs/`,
`apps/api/src/chats/context-builder.ts`, and
`apps/api/src/compaction/compaction.service.ts` against the
`agents-best-practices` skill references, then verified each contested point
against four peer harnesses cached under `~/.cache/checkouts/`:

| harness                           | why comparable                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `anomalyco/opencode`              | same stack — TypeScript, Vercel AI SDK, Drizzle. Closest architectural analogue.                |
| `openclaw/openclaw`               | closest **vision** analogue — self-hosted personal assistant, file-first memory, multi-channel. |
| `yasasbanukaofficial/claude-code` | best-in-class agent harness; MCP host conventions.                                              |
| `open-webui/open-webui`           | closest self-hosted multi-user product comp.                                                    |

Peer citations are to those checkouts, not to this repo.

openclaw turned out to hold the single most relevant peer module in this whole
audit — `src/agents/session-tool-result-guard.ts`, whose docstring is "Caps large
tool results, repairs missing results, applies redaction, and emits transcript
update events". That is four of this document's findings in one file. It is cited
throughout below and is the reason F10 exists at all.

---

## Current state, accurately

The **declaration** path is already JSON-Schema-driven end to end. Snapshots store
`ModelToolDeclaration { id, description, inputSchema: JSONSchema }`;
`run-execution.service.ts:660` builds the toolSet with `jsonSchema(...)`;
`compaction.service.ts:43` does the same for schema-only declarations. "Make tools
dynamic" is mostly done.

The static part is the **executor** side, in three places:

| #   | site                                                 | coupling                                                                                                          |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/api/src/tools/types.ts:58`                     | `inputSchema: z.ZodTypeAny`                                                                                       |
| 2   | `apps/api/src/tools/runner.ts:120`                   | `tool.inputSchema.safeParse(args)`                                                                                |
| 3   | `apps/api/src/runs/snapshot-tool-execution.ts:83-92` | rebuilds `asSchema(executor.inputSchema).jsonSchema` and requires `canonicalJson` byte-equality with the snapshot |

Site 3 is the trap — see F8.

---

## Findings, ranked by leverage

### F1. llame is the only harness that strips tool results from later turns

`partsToText` (`apps/api/src/chats/context-builder.ts:141`) keeps only
`type === 'text'`; `buildContext` (`:182`) additionally drops `role === 'tool'`.
Tool activity is durable for UI and audit, and never re-enters model context —
not on the next turn, not on a model switch, not as compaction input.

All four peers replay tool calls **and** results:

- **opencode** — `packages/opencode/src/session/message-v2.ts:290-360` emits
  `tool-<name>` parts with `state: "output-available"`, carrying `input` and
  `output`, for every completed tool part in history.
- **openclaw** — the whole `session-tool-result-guard.ts` module exists to keep
  `role: "toolResult"` transcript messages consistent for replay.
- **open-webui** — `backend/open_webui/utils/middleware.py:2000-2028`
  (`process_messages_with_output`) reconstructs OpenAI-style `tool_calls` plus
  `role: "tool"` result messages for the next request.
- **claude-code** — retains tool_use/tool_result blocks in the transcript it
  replays.

Two of them go beyond a binary keep/drop.

opencode runs a **three-tier lifecycle**:

```
fresh          → full output, truncated to toolOutputMaxChars with an explicit
                 "[Tool output truncated for compaction: omitted N chars]" marker
                 (message-v2.ts:49-53)
post-compaction→ call + input + tool name PRESERVED,
                 output replaced by "[Old tool result content cleared]"
                 (message-v2.ts:293-295; marker set at compaction.ts:281 via
                 part.state.time.compacted)
model switch   → tool parts KEPT; only providerMetadata / provider-native
                 reasoning stripped, gated on a per-message `differentModel`
                 comparison (message-v2.ts:245)
```

That middle tier is exactly the "smallest provider-neutral, injection-safe tool
observation projection" #214 hypothesizes as a conditional deliverable — already
shipped by a peer on our own stack. The model keeps "I called `search` with query
X" while the payload is gone.

openclaw goes further and names the concept the same way #214 does. Its
`ToolResultPromptProjectionState`
(`src/agents/embedded-agent-runner/session-prompt-state.ts:5-10`) is per-session
state holding:

```ts
replacements: Map<string, AgentMessage>; // projected substitute for a tool result
frozen: Set<string>; // once projected, never re-projected
ambiguousBaseKeys: Set<string>; // collision handling
sourceTextByKey: Map<string, string[]>; // the text the projection came from
```

`frozen` is the part worth stealing. A projection that can be recomputed per turn
mutates the replayed prefix and destroys prompt-cache reuse; freezing it on first
projection makes the shortened form **stable** for every later turn. That matters
more in llame than in openclaw, because the prompt-cache contract is explicit here
(`context-builder.ts:5-8`, "byte-identical across turns").

**But do not simply copy any of them.** llame's strip is deliberate and the
docstring says so (`context-builder.ts:74-81`: "visible user/assistant text
only"). Once #215 lands, replaying tool output means replaying **untrusted remote
MCP server output into every subsequent turn, permanently** — one poisoned search
result becomes a persistent instruction in the context of every later turn in that
chat. None of the four peers fence or label replayed tool output as untrusted
data; openclaw redacts it (F10) and bounds it (F4), which is adjacent but not the
same control.

llame already has the machinery the peers lack: the
`CONVERSATION_CHECKPOINT_START/END` envelope (`context-builder.ts:109-113`) and
the tag-balance sanitizer in `instance-config/authored-text.ts`. The defensible
position is therefore **stricter than opencode, looser than today**:

- replay tool observations, but fenced and explicitly labelled as untrusted
  historical data, never as assistant-authored claims and never as
  provider-native tool blocks;
- bound them (per-call and per-turn);
- make them compaction-clearable on opencode's `time.compacted` model;
- keep raw provider-native metadata and reasoning out, as today.

This is genuine improvement over the comps, not catch-up.

Implication for the issue — and a caution against over-reading the peers. Peer
behavior is evidence about choices made under _different_ constraints. opencode
is a coding agent replaying file reads and diffs, where losing the payload is
fatal to the next step. llame's shipped toolset is one conversation-search tool
whose results the assistant naturally restates in its answer text. That is a
materially different continuity profile, and it is why #214 made the experiment
the gate rather than assuming the answer.

So: keep acceptance item 4 as the decision gate. What this audit buys is that the
_shape_ of the fix no longer has to be invented if the gate opens — pre-specify
it in `design.md`, name the experiment in `tasks.md`, and make the projection a
conditional task. Do **not** write the projection into the spec delta as an
unconditional requirement.

### F2. Loop invariant violated: a tool call can receive no result

`agents-best-practices/references/agentic-loop.md` invariant 1: "Every tool call
receives exactly one corresponding result." Invariant 7: "Errors, denials,
cancellations, and timeouts become structured observations."

llame's abort path breaks both, in two opposite directions at once:

```
tool.requested ──▶ bridge emits tool-input-available ──▶ UI renders "running"
      │
      ├─ LIVE:    run-stream-bridge.ts:272-295 closes text and reasoning on every
      │           terminal event; an open tool part is never closed
      │           → the UI shows the tool running forever
      │
      └─ HISTORY: run-execution.service.ts:187 filters unsettled 'pending-tool'
                  entries out of the persisted parts
                  → after refresh the call never happened
```

Live says "still running", reload says "nothing happened". Neither is true.

Peer behavior — three of four synthesize a result rather than dropping the call:

- **openclaw** has the most complete treatment, in
  `src/agents/session-transcript-repair.ts:189-213`. `makeMissingToolResult`
  builds a `role: "toolResult"` with `isError: true` **and** a
  `details[SYNTHETIC_MISSING_TOOL_RESULT_DETAIL_KEY] = true` marker, with
  `isSyntheticMissingToolResult` (`:215`) reading it back. Two things follow that
  the other harnesses miss:
  - a repaired result stays **distinguishable from a genuine tool failure** in
    the durable record — without the marker, "we cancelled this" and "the tool
    errored" become the same audit row;
  - the repair **text is provider-specific**: the comment at `:192-196` notes
    OpenAI Responses/Codex replay must match upstream Codex's "aborted"
    `function_call_output` normalization, while other providers keep OpenClaw's
    explicit diagnostic text. The repair string is a provider-compat concern, not
    free-form prose.
- **opencode** (`message-v2.ts:349-359`) emits `state: "output-error"`,
  `errorText: "[Tool execution was interrupted]"` for any part still `pending` or
  `running`, with the comment: _"Anthropic/Claude APIs require every tool_use to
  have a corresponding tool_result."_
- **claude-code** (`src/utils/messages.ts:207-208`) keeps canonical constants
  `INTERRUPT_MESSAGE = '[Request interrupted by user]'` and
  `INTERRUPT_MESSAGE_FOR_TOOL_USE`, selected at `:550` by whether a tool use was
  in flight.
- **open-webui** (`middleware.py:2041-2072`, `sanitize_tool_pairs`) takes the
  other route: drop assistant `tool_calls` with no matching result, and drop
  `role: "tool"` messages with no matching call. Pairing is enforced; the record
  of the attempt is lost.

Recommend synthesizing: emit a terminal `tool.completed` with
`status: 'error', type: 'cancelled'` on the abort path so live stream, persisted
history, and audit converge on one truth — and carry openclaw's synthetic marker,
so a cancelled call is never mistaken for a tool that genuinely failed. This
satisfies #214 acceptance item 7.

openclaw also shows what this machinery grows into, which is worth knowing before
choosing a shape. `sanitizeToolCallInputs` returns a
`ToolCallInputRepairReport { messages, droppedToolCalls, droppedAssistantMessages }`
(`session-transcript-repair.ts:285-294`) and accepts `allowedToolNames` — replay
drops tool calls naming tools that are no longer permitted, and **counts** what it
dropped rather than silently rewriting history. That is the same decision F8 faces
for bind drift, resolved the same way: degrade the individual call, report the
degradation.

F2 stands on its own merits — acceptance item 7, plus the live-hangs /
history-drops inconsistency above — and is **not** downstream of F1. opencode's
"Anthropic requires every tool_use to have a tool_result" constraint binds it
because it replays provider-native tool blocks. If llame's projection (F1) is a
fenced text item inside the existing `ModelMessage { role, content: string }`
shape, no `tool_use` block exists to dangle and that API constraint never
applies. Sequence F2 on its own.

### F3. Tool id namespacing — `:` is illegal, use `mcp__server__tool`

A colon-separated id (`mcp:tavily:search`) does not survive contact with the
provider: OpenAI function names are constrained to `^[a-zA-Z0-9_-]{1,64}$`, and
the toolSet key becomes the function name.

Peers:

- **opencode** — `packages/opencode/src/mcp/catalog.ts:117-119`:
  `sanitize = (v) => v.replace(/[^a-zA-Z0-9_-]/g, "_")`, and
  `toolName = sanitize(client) + "_" + sanitize(name)`. Note it separately keeps
  a **percent-escaped** `clientName` for resource URIs (`:117` region, escaping
  `%` then `:`) so `server:uri` keys stay unambiguous — two different naming
  domains, deliberately.
- **claude-code** — `src/services/mcp/mcpStringUtils.ts:11`: _"Expected format:
  `mcp__serverName__toolName`"_, with `buildMcpToolName`, `mcpInfoFromString`,
  and `getToolNameForPermissionCheck` around it.

Recommend `mcp__<server>__<tool>`: provider-legal, unambiguous under a
double-underscore separator, and already the convention users see in the wider
ecosystem. The boot-validation split (F7) keys off that prefix.

### F4. Result truncation is broken for anything that returns real payloads

`apps/api/src/tools/runner.ts:46-60` `JSON.stringify`s the entire result, and if
it exceeds 16 000 chars replaces it with
`{ status, truncated: true, message, preview: json.slice(0, 16000) }`. The
envelope stays well-formed; what breaks is inside it. The `preview` string holds
the result's own serialization **cut mid-token** at a byte offset, so the model
gets valid JSON wrapping an unparseable fragment of the actual payload — and the
result's real structure (`status`, and every field the tool declared) is gone,
replaced by a flat string.

This never fired in practice because the only tool is `search_conversations`,
which returns small structured rows. A remote MCP web-search result routinely
exceeds 16 KB, so #215's own acceptance example ("a browser chat invokes a
generic MCP search tool **and uses its result**") walks straight into it.

There is a second, quieter defect in the same line. `json.slice(0, 16000)` cuts at
a UTF-16 code-unit index, which can split a surrogate pair and emit a lone
surrogate — a malformed string on any emoji or non-BMP CJK payload. openclaw
imports `sliceUtf16Safe` / `truncateUtf16Safe` from its normalization core
precisely to avoid this (`embedded-agent-runner/tool-result-truncation.ts:7`).

Peer truncation, in ascending order of sophistication:

- **opencode** truncates the tool's own **output text** and appends a marker
  outside the payload (`message-v2.ts:49-53`).
- **openclaw** treats the cap as a function of the model rather than a constant
  (`embedded-agent-runner/tool-result-truncation.ts:44-60`):
  - tiered ceilings — `DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS = 16_000`, rising to
    32 000 and 64 000 for larger context windows;
  - `MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3` — "a single tool result should not
    consume more than 30% of the context window even without other messages";
  - a `minKeepChars: 2_000` floor so a cap can never shrink a result to
    uselessness (`session-tool-result-guard.ts:44-53`);
  - a notice that carries both the omitted count and the **recovery action** —
    `[... N more characters truncated; rerun with narrower args if needed]`
    (`context-truncation-notice.ts`). Telling the model how to recover is free and
    llame's `Result truncated to N characters.` does not do it.

`tools-and-permissions.md` is blunter still: "Do not return huge raw blobs.
Summarize, paginate, filter."

Fix belongs in #214: truncation becomes a declared per-tool result limit applied
to the payload with a UTF-16-safe cut, derived from the model's
`contextWindowTokens` — which llame already carries per model in config — rather
than one hardcoded constant, and the notice tells the model how to retry.

### F5. Untrusted tool descriptions enter a hashed, immutable snapshot

With #215, an MCP server supplies `description` and per-field JSON Schema
`description` strings. Those flow into the model's tool specification — and in
llame specifically into `resolveEffectiveContext`'s canonicalized, hashed,
**immutable** `toolDeclarations` (`runs/effective-context-resolver.ts:86-101`)
and into the owner-visible receipt.

`skills-and-connectors.md`: _"Tool annotations and descriptions from external
servers can be wrong or malicious. The harness must not blindly trust them."_

None of the four peers sanitize this. llame already has the right primitive for
it — `instance-config/authored-text.ts`, built for owner-authored personalization
text, with its two rules (a value can never close a tag it did not open; reserved
tag names are never emitted). Applying it to dynamic tool descriptions is cheap
now and expensive after the snapshot format is frozen.

### F6. The `Tool` contract is missing the fields a non-first-party tool needs

`tools-and-permissions.md` lists the tool contract fields. Against
`apps/api/src/tools/types.ts`:

| field                         | llame                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| name / purpose / input schema | present (`id`, `description`, `inputSchema`)                  |
| risk class                    | present (`classification`, SPEC §13.5)                        |
| timeout                       | present (`timeoutSeconds`)                                    |
| error format                  | present (`ToolResult` discriminated union)                    |
| **output schema**             | absent — `{ status: 'success' } & Record<string, unknown>`    |
| **side-effect class**         | absent — this _is_ #214's "replay safety, modeled separately" |
| **retry policy**              | absent                                                        |
| **result-size limit**         | global constant only (`RESULT_TRUNCATE_CHARS`), not per-tool  |
| **resource scope**            | implicit in `ToolContext.userId`, not declared                |

The reference's split of _risk class_ from _side-effect class_ is exactly what
#214 asks for and what SPEC §13.5's seven-value enum cannot express alone: a
second axis, whose failure mode has a name in the reference's own error taxonomy
(`non_idempotent_retry_blocked`). The shipped `tool-calling` spec already has a
requirement waiting for this — "No mid-run tool-state checkpointing (read-only
slice; write-tool landmine)".

#214 is the last cheap moment to widen this record. After #215, every added field
is a snapshot-format change.

### F7. `tools.allowed` boot validation blocks #215 — decide it in #214

`apps/api/src/instance-config/config-loader.ts:20` statically imports
`getRegisteredToolIds()`, and `openspec/specs/tool-calling/spec.md` says
normatively: _"Unknown tool ids in the allowlist SHALL fail boot (strict config
validation)."_ A runtime-discovered MCP id cannot satisfy that.

If #214 leaves this alone, #215 must reopen `instance-config` — which defeats
#214's own stated purpose ("so later first-party writes do not reopen the tool
contract"). It is a `tool-calling` + `instance-config` spec delta either way, so
it belongs in this change.

Options, with the recommendation first:

1. **Split validation by id namespace.** Statically-registered ids stay strict at
   boot. `mcp__<server>__<tool>` ids validate at boot only that `<server>` is a
   declared MCP server; the tool itself resolves at discovery and is
   unavailable — fail-closed and recorded — until it does. #215 becomes purely
   additive.
2. Keep strict boot validation, requiring operators to declare every MCP tool id
   and schema up front. Preserves the current fail-loud contract verbatim, but
   makes discovery decorative.
3. Make boot await discovery. One strict gate, but an offline MCP server becomes
   a startup failure — directly contradicting #215's "offline or malformed
   servers degrade only their own tools".

### F8. Snapshot/live declaration drift currently fails the whole run

`runs/snapshot-tool-execution.ts:83-92` rebuilds the live declaration and throws
`ModelContextExecutionError` on any `canonicalJson` mismatch. For an in-code
registry that is right: drift means someone redeployed mid-run, and failing loud
is correct. For a remote MCP server that re-advertises a tweaked schema between
bind and execute, it means **one upstream edit kills unrelated runs**.

Two further hazards at the same site: a dynamic tool whose schema already _is_
JSON Schema still round-trips through `asSchema(...)`, so byte-identity is not
guaranteed even absent upstream change; and canonicalization must be defined once
and shared by snapshot-time and bind-time for both schema kinds.

Options, recommendation first:

1. **Withdraw the tool, continue the run.** Drop only the mismatched tool from
   the turn's toolSet; a model request for it takes the existing
   `onUnavailableToolCall` refusal path (recorded, non-fatal). Emit a run event
   recording the withdrawal, so the receipt's over-claim is visible rather than
   silent. Matches #215's degrade-only-their-own-tools requirement.
2. Keep failing the run.
3. Split by origin: native tools fail the run (drift is a deploy bug), dynamic
   tools withdraw and continue (drift is expected upstream churn). Most faithful
   to what each failure actually means; two behaviors to document and test.

Option 1 has independent peer support in two places. openclaw's replay repair
drops individual disallowed tool calls and **reports the count**
(`ToolCallInputRepairReport`, F2 above) rather than failing. More broadly,
openclaw generalizes degrade-don't-fail into a first-class mechanism: its
context-engine **quarantines** a failing pluggable runtime — recording
`{ engineId, owner, operation, reason, failedAt }` into a health store that
sibling processes can read (`src/context-engine/quarantine-health.ts:1-40`) —
instead of failing the request. That is the shape #215's "offline or malformed
servers degrade only their own tools" wants, and #214 is where the seam for it
gets cut. Note openclaw's explicit no-TTL decision: a quarantine lasts the
recorder's process lifetime, so liveness alone owns expiry. Worth copying the
reasoning, since a TTL'd withdrawal would silently re-advertise a broken tool.

### F9. The two production `as unknown as` casts

`apps/api/CLAUDE.md` assigns both to #214; the issue's acceptance list mentions
neither.

- `compaction/compaction.service.ts:406` — `result.toolCalls` off the AI SDK
  type. In scope: it is `ModelClient`-boundary typing, and #214 is already at
  that boundary.
- `chats/chat-loop.service.ts:166` — bridge `Response` adapted to
  `ReturnType<ModelClient['streamText']>`. Unrelated to tools; folding it in is
  scope creep. Recommend an explicit deferral note so the CLAUDE.md/issue
  mismatch does not rot.

### F10. Tool inputs and results are persisted and streamed with no redaction

Surfaced only by openclaw; I had no equivalent finding before reading it.

`session-tool-result-guard.ts:16-20` imports `isSensitiveFieldKey`,
`redactSensitiveFieldValueWithConfig`, and `redactToolPayloadTextWithConfig` from
its logging layer and applies them **on the transcript write path** — redaction is
part of persisting a tool result, not merely part of logging it.

llame has no equivalent. `run-execution.service.ts:625-649` writes the tool's
`input` verbatim into the `tool.requested` run event and the full result object
into `tool.completed`, and both land in durable, owner-visible `run_events` plus
message parts. Today that is harmless: the one tool takes a query string and
returns the owner's own chat rows.

With #215 it stops being harmless. That issue requires: _"Never expose configured
secret headers in logs, diagnostics, persisted errors, or test output."_ A remote
MCP server that echoes a request header into an error body, or a tool whose
arguments carry a token, writes that value into `run_events` — durable, replayed
to the client on every reconnect, and outside the redaction posture the rest of
the codebase already maintains for instance-config.

The gap is on the **#214 side of the boundary** even though the requirement is
written in #215: run-event emission and tool-result persistence are this issue's
code. A redaction hook on that write path costs little now; retrofitting it means
rewriting durable rows that have already shipped.

---

## What the audit does _not_ change

The context boundary the issue asks to audit is **already enforced** for the
narrow reading: no tool payload, reasoning, or cap notice reaches a later turn or
compaction input, because compaction consumes the same `buildContext`.
Acceptance items 3 and 4 are characterization tests plus one experiment, not a
new stripping layer. Budget accordingly — the mechanism work is F1's projection,
F2's settling, and F4's truncation, not the stripping.

## Cross-harness summary

| question                                   | opencode                          | openclaw                          | claude-code         | open-webui    | llame today                             |
| ------------------------------------------ | --------------------------------- | --------------------------------- | ------------------- | ------------- | --------------------------------------- |
| tool results replayed to later turns       | yes, graded                       | yes                               | yes                 | yes           | **no**                                  |
| tool result fenced/labelled untrusted      | no                                | no                                | no                  | no            | n/a                                     |
| compaction clears tool payload, keeps call | yes                               | yes, via frozen projection        | —                   | —             | n/a                                     |
| projection frozen for cache stability      | no                                | **yes**                           | —                   | —             | n/a                                     |
| model switch keeps tool parts              | yes, strips provider metadata     | —                                 | —                   | —             | n/a                                     |
| dangling tool call on interrupt            | synthesize error                  | synthesize + **synthetic marker** | synthesize error    | drop the pair | **neither — live hangs, history drops** |
| repair text is provider-specific           | no                                | **yes**                           | —                   | —             | n/a                                     |
| MCP tool id form                           | `server_tool`, `[^A-Za-z0-9_-]→_` | —                                 | `mcp__server__tool` | —             | undecided                               |
| remote tool descriptions sanitized         | no                                | no                                | no                  | no            | n/a                                     |
| tool output truncation                     | payload + marker                  | tiered + 30% share + UTF-16-safe  | capped              | capped        | **envelope stringify-slice (broken)**   |
| tool payload redaction on persist          | no                                | **yes**                           | —                   | —             | **no**                                  |
| failing component degrades in isolation    | —                                 | **yes, quarantine + health**      | —                   | —             | n/a                                     |

openclaw is the closest peer on **vision**, and on this axis it is also the most
advanced implementation: it leads on five of the twelve rows. Reading it changed
F2, F4, and F8, and produced F10 outright. It is the peer to keep re-reading as
#214 and #215 land — not opencode, despite the shared stack.

## Decisions taken, and where they landed

All four open decisions were resolved when `add-dynamic-tool-catalog` was written.
Full rationale is in that change's `design.md`; the outcomes:

1. **F7 boot-validation split** — namespace-split chosen, deferred to #215.
2. **F8 bind-drift policy** — withdraw-and-continue chosen, deferred to #215. The
   canonicalization fix (F-adjacent, D2 in that design) lands in #214 because
   JSON-Schema tools create the false-drift bug there.
3. **F1 observation projection** — gated on the continuity measurement, as the issue
   specifies. #214 runs the measurement and records the outcome.
4. **F10 redaction** — deferred to #215, against the recommendation above. #214 has
   no tool that can carry a credential, and no shared redaction helper exists to
   build on.

`add-dynamic-tool-catalog` implements only what has a consumer today: JSON-Schema
input schemas, the comparison fix, cooperative cancellation, tool settling on
termination (#293), and the boundary characterization plus continuity measurement.

## Handoff to #215: what was deferred and how to re-validate it

Each item below was **decided** against the evidence in this document and
**deliberately not built**, because its only consumer is a tool sourced from outside
this codebase. Do not re-litigate the decision; do re-check its premise, because
each rests on something that can move.

### Dynamic tool ids use `mcp__<server>__<tool>`

Deferred because #214 contributes no tool from a named external source.

Re-validate: that supported providers still constrain function names to
`[A-Za-z0-9_-]` and that the AI SDK still uses the toolset key as the function name.
If either changed, the separator choice is reopened — but a colon is still wrong for
any provider that rejects it, so prefer widening only if every target provider
allows it. Evidence: F3, plus `mcp/catalog.ts` (opencode) and `mcpStringUtils.ts`
(Claude Code) in the cached checkouts.

### `tools.allowed` boot validation splits by id form

Deferred because there is no id form to split on until a dynamic source exists.

Re-validate: read the shipped `instance-config` spec at that time — this change
leaves it untouched, so its "registered tool ids" phrasing is still in force and
must be amended by #215's own delta. Confirm the two rejected alternatives still
fail for the same reasons: strict validation makes discovery decorative, and
awaiting discovery at boot makes an offline server a startup failure, which
contradicts #215's own degrade-only-their-own-tools requirement. Evidence: F7.

### Declaration drift withdraws the tool, not the Run

Deferred because, once #214's comparison fix lands, drift can only mean a redeploy
landed mid-run — where failing the Run is correct.

Re-validate **first**: confirm that fix actually shipped (a JSON-Schema tool rebinds
without being reported as drifted). If it did not, this decision's premise is gone
and false drift is the real problem to solve, not withdrawal policy. Then confirm
withdrawal is still recorded rather than silent, and keep the no-TTL rule — a timer
would silently re-advertise a tool whose declaration still does not match. Evidence:
F8, plus openclaw's quarantine (`context-engine/quarantine-health.ts`).

### Tool payloads are redacted on the persistence path

Deferred because #214's only tool takes a query string and returns the owner's own
rows, and because no shared redaction helper exists in this codebase.

Re-validate: check whether a redaction helper has appeared since (there was none as
of this audit — `runner.ts`'s "same redaction posture as instance-config" names a
practice, not a utility). Scope it to call **arguments** as well as results; the
shipped spec's "no secrets in the recorded result" covers only the latter. Note the
requirement is written in #215 already ("never expose configured secret headers in
logs, diagnostics, persisted errors, or test output") but the write path it applies
to is `run_events` emission, which is #214's code — so this is a #215 requirement
landing on #214's surface. Evidence: F10, plus openclaw's
`session-tool-result-guard.ts`.

### Externally supplied tool metadata is neutralized

Deferred because it is no cheaper now than later — it changes a string's value, not
the snapshot format — and #214's test tool is authored in-repo.

Re-validate: confirm `instance-config/authored-text.ts` still enforces both rules (a
value cannot close a boundary it did not open; a reserved structural name is never
emitted) before reusing it, and confirm the neutralization point is where the tool
entry is built, so hashing, the receipt, and the provider request all observe the
same neutralized form. Evidence: F5.

### Also inherited

- The continuity measurement's **outcome** (from #214 task 4.1). If it came back
  "insufficient", the projection is #215's to build, and its shape is designed in F1
  — provider-neutral, fenced and labelled untrusted, bounded, and frozen once
  projected so the replayed prefix stays cacheable.
- #294 (tool-result truncation) is independent, but the context-window-derived caps
  it defers depend on a per-tool result limit that #214 did **not** add.
- Re-read openclaw before starting. It led five of the twelve comparison rows and
  changed three findings here; it remains the most relevant peer for this work.
