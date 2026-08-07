# #214 harness audit — llame's tool loop vs. best practice and four peer harnesses

Noncanonical research. Date: 2026-08-07. Scope: issue #214 (catalog-driven dynamic
tool execution), read forward into #215 (remote Streamable HTTP MCP).

Method: audited `apps/api/src/tools/`, `apps/api/src/runs/`,
`apps/api/src/chats/context-builder.ts`, and
`apps/api/src/compaction/compaction.service.ts` against the
`agents-best-practices` skill references, then verified each contested point
against four peer harnesses cached under `~/.cache/checkouts/`:

| harness                           | revision       | dated      | why comparable                                                                                  |
| --------------------------------- | -------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `anomalyco/opencode`              | `fab213312927` | 2026-07-18 | same stack — TypeScript, Vercel AI SDK, Drizzle. Closest architectural analogue.                |
| `openclaw/openclaw`               | `347ee4589503` | 2026-07-18 | closest **vision** analogue — self-hosted personal assistant, file-first memory, multi-channel. |
| `yasasbanukaofficial/claude-code` | `a371abbe75ff` | 2026-04-05 | best-in-class agent harness; MCP host conventions.                                              |
| `open-webui/open-webui`           | `ecd48e2f7182` | 2026-07-01 | closest self-hosted multi-user product comp.                                                    |

Peer citations are to those checkouts at those revisions, not to this repo. Every
file-and-line citation below is only reproducible against the pinned revision — the
caches are machine-local and move when refreshed. llame-side citations are against
this branch's merge base.

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

```text
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

A note on that quoted phrase, kept verbatim from the issue: **"injection-safe"
overclaims, and this document does not adopt it.** Structural typing, explicit
untrusted-data labelling, and tag balancing reduce _structural_ confusion — they mark
what the content is and stop a value closing a boundary it did not open, or forging
one. None of them prevents a model from following instructions that appear inside
correctly-typed, correctly-labelled untrusted text. The honest word is
**injection-resistant**, and the guarantee is structural containment plus a provenance
label, not immunity. Everywhere below, read the projection's properties as
mitigations.

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

llame already has machinery the peers lack: the
`CONVERSATION_CHECKPOINT_START/END` envelope (`context-builder.ts:109-113`) and
the tag-balance sanitizer in `instance-config/authored-text.ts`. The defensible
position is therefore **stricter than opencode, looser than today**:

- replay tool observations in the conventional tool-call/tool-result representation,
  which is what the model is trained on and what gives the replayed result its
  structural identity;
- label the replayed result content as tool output whose instruction-like text is not
  authoritative, and escape-proof it with the sanitizer — the two controls no audited
  peer has;
- bound them (per-call and per-turn);
- make them compaction-clearable on opencode's `time.compacted` model;
- keep provider-native metadata and reasoning out, as today.

An earlier draft of this section proposed carrying observations as fenced prose inside
the flattened message shape instead. That was rejected: models are trained on the
tool-call/tool-result pair, the model SDK already provides it portably, and llame's
flattened `{ role, content: string }` is a self-imposed narrowing that already costs
three casts.

This is genuine improvement over the comps, not catch-up.

Implication for the issue — and a caution against over-reading the peers. Peer
behavior is evidence about choices made under _different_ constraints. opencode
is a coding agent replaying file reads and diffs, where losing the payload is
fatal to the next step. llame's shipped toolset is one conversation-search tool
whose results the assistant naturally restates in its answer text. That is a
materially different continuity profile, and it is why #214 made the experiment
the gate rather than assuming the answer.

**Superseded — the gate was resolved without the eval.** This section originally
argued for keeping acceptance item 4 as the decision gate and treating the projection
as conditional. Two arguments retired that, neither of which is in the peer evidence
above:

- **The reader can see what the model cannot.** The shipped spec requires the chat UI
  to render tool activity including _the result_. So the user is looking at output the
  model has already discarded, with nothing signalling the gap. "What was the second
  result?" is the ordinary next turn for a search tool, and today it yields a
  hallucination or a silent re-run returning different hits. That is a product defect,
  not a continuity subtlety, and no eval was needed to see it.
- **The boundary was arbitrary.** The loop already replays tool results _within_ a
  turn — step 2 sees step 1's result, under a step cap of 8. Nothing about the
  information changes at the turn edge; that is simply where `partsToText` runs.

`add-dynamic-tool-catalog` therefore specifies replay outright rather than measuring
first, and adds the half most implementations drop: a call that was refused, cancelled,
timed out or errored is replayed accompanied by a well-formed result reporting that
outcome, rather than omitted — so history never shows a run in which every tool call
worked. The projection's properties are as designed above — carried in the
conventional tool-call/tool-result representation, every call paired with a result,
labelled untrusted and escape-proofed in its content, bounded, frozen once projected,
and compaction-clearable.

### F2. Loop invariant violated: a tool call can receive no result

`agents-best-practices/references/agentic-loop.md` invariant 1: "Every tool call
receives exactly one corresponding result." Invariant 7: "Errors, denials,
cancellations, and timeouts become structured observations."

llame's abort path breaks both, in two opposite directions at once:

```text
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
history-drops inconsistency above.

**Superseded on sequencing.** This paragraph originally argued F2 was _not_ downstream
of F1, reasoning that a fenced-text projection emits no `tool_use` block, so opencode's
"every tool_use needs a tool_result" constraint would never apply to llame. That
reasoning died with the text projection. `add-dynamic-tool-catalog` replays in the
conventional tool-call/tool-result representation, so the pairing rule does apply —
and applies for a stronger reason than provider validation: the pair is the trained
shape. F2 is therefore a **prerequisite** of F1, not independent of it. Settling is
what guarantees every replayed call has an outcome to pair with, and it is the branch
below replay in the implementation stack.

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
envelope stays well-formed; what breaks is inside it. The model receives **valid
JSON** — the damage is semantic, not syntactic. Every field the tool declared is
gone, collapsed into one `preview` string holding a prefix of the result's own
serialization, cut at an arbitrary offset that lands mid-token far more often than
not. The model must now parse a fragment of JSON out of a JSON string, and the
`status` and shape it was given a schema for no longer exist.

This never fired in practice because the only tool is `search_conversations`,
which returns small structured rows. A remote MCP web-search result routinely
exceeds 16 KB, so #215's own acceptance example ("a browser chat invokes a
generic MCP search tool **and uses its result**") walks straight into it.

There is a second, quieter defect in the same line. `json.slice(0, 16000)` cuts at a
UTF-16 **code-unit** index, not a code-point boundary, so a cut landing between the
halves of a surrogate pair emits a lone surrogate — an ill-formed string on any emoji
or non-BMP CJK payload. openclaw imports `sliceUtf16Safe` / `truncateUtf16Safe` from
its normalization core precisely to avoid this
(`embedded-agent-runner/tool-result-truncation.ts:7`).

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

The fix splits, and **neither half is in #214**. The corruption itself — cutting
the payload's own serialization at an arbitrary UTF-16 index and replacing the
declared fields with a flat string — is #294, independently. The richer policy
on top of it (a declared per-tool result limit derived from the model's
`contextWindowTokens`, which llame already carries per model, and a notice telling
the model how to retry) needs a widened tool contract, so it waits on whichever
change adds one. #214 adds no per-tool result limit.

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

The reference's split of _risk class_ from _side-effect class_ is what #214
asks for, and SPEC §13.5's seven-value enum cannot express it alone: it is a second
axis, whose failure mode has a name in the reference's own error taxonomy
(`non_idempotent_retry_blocked`). The shipped `tool-calling` spec already has a
requirement waiting for it — "No mid-run tool-state checkpointing (read-only slice;
write-tool landmine)".

**Correction — this finding originally argued the field had to land in #214
because "after #215 every added field is a snapshot-format change". That is false.**
The snapshot persists only `{ id, description, inputSchema }`; `classification` is
already read from the live registry at bind time, and a replay-safety field would
live in the same place. Adding it later is a plain field change with no migration
and no format break.

With the urgency argument gone, `add-dynamic-tool-catalog` does **not** model replay
safety. No tool in #213, #214, or #215 is non-read-only, so the field would
have one legal value in practice and the gate reading it would never fire. The
shipped landmine requirement covers the hazard instead, strengthened there to name
queue retry as the concrete re-execution path. The remaining gaps in the table above
(output schema, retry policy, per-tool result limit, declared resource scope) stay
open and belong to whichever change first has a tool that needs them, rather than
to #214.

### F7. `tools.allowed` boot validation blocks #215 — decide it in #214

`apps/api/src/instance-config/config-loader.ts:20` statically imports
`getRegisteredToolIds()`, and `openspec/specs/tool-calling/spec.md` says
normatively: _"Unknown tool ids in the allowlist SHALL fail boot (strict config
validation)."_ A runtime-discovered MCP id cannot satisfy that.

If #214 leaves this alone, #215 must reopen `instance-config` — which defeats
the stated purpose of #214 ("so later first-party writes do not reopen the tool
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

**Superseded in part.** This section originally observed that the context boundary was
already enforced — no tool payload, reasoning, or cap notice reaches a later turn or
compaction input, because compaction consumes the same `buildContext` — and concluded
that acceptance items 3 and 4 were characterization tests plus one experiment rather
than a new stripping layer.

The observation still holds as a description of current behavior. The conclusion does
not: `add-dynamic-tool-catalog` reverses that boundary rather than characterizing it,
and item 4's experiment was retired (see F1). There is no experiment to budget for. The
mechanism work is F1's replay, F2's settling, and F4's truncation — and the stripping
that was to be pinned in place is instead being replaced.

## Cross-harness summary

| question                                          | opencode                          | openclaw                         | claude-code         | open-webui     | llame today                             | llame after #214                  |
| ------------------------------------------------- | --------------------------------- | -------------------------------- | ------------------- | -------------- | --------------------------------------- | --------------------------------- |
| tool results replayed to later turns              | yes, graded                       | yes                              | yes                 | yes            | **no**                                  | **yes, graded**                   |
| replayed in the conventional call/result form     | yes                               | yes                              | yes                 | yes            | n/a                                     | **yes**                           |
| unsuccessful calls replay as unsuccessful         | yes                               | yes                              | yes                 | drops the pair | n/a                                     | **yes**                           |
| replayed result labelled untrusted in its content | no                                | no                               | no                  | no             | n/a                                     | **yes — only one**                |
| replayed content escape-proofed                   | no                                | no                               | no                  | no             | n/a                                     | **yes — only one**                |
| compaction clears payload, keeps call             | yes                               | yes                              | —                   | —              | n/a                                     | **yes**                           |
| projection frozen for cache stability             | no                                | **yes**                          | —                   | —              | n/a                                     | **yes**                           |
| model switch keeps observations                   | yes, strips provider metadata     | —                                | —                   | —              | n/a                                     | **yes, strips provider metadata** |
| dangling tool call on interrupt                   | synthesize error                  | synthesize + **marker**          | synthesize error    | drop the pair  | **neither — live hangs, history drops** | **synthesize + marker**           |
| cancelled rendered distinctly in UI               | not examined                      | not examined                     | not examined        | not examined   | no                                      | **yes**                           |
| repair text is provider-specific                  | no                                | **yes**                          | —                   | —              | n/a                                     | n/a — the SDK maps per provider   |
| MCP tool id form                                  | `server_tool`, `[^A-Za-z0-9_-]→_` | —                                | `mcp__server__tool` | —              | undecided                               | decided, built in #215            |
| remote tool descriptions sanitized                | no                                | no                               | no                  | no             | n/a                                     | deferred → #215                   |
| tool output truncation                            | payload + marker                  | tiered + 30% share + UTF-16-safe | capped              | capped         | **broken**                              | **still broken → #294**           |
| tool payload redaction on persist                 | no                                | **yes**                          | —                   | —              | **no**                                  | deferred → #215                   |
| failing component degrades in isolation           | —                                 | **yes, quarantine + health**     | —                   | —              | n/a                                     | deferred → #215                   |

Reading the last column, across sixteen rows: #214 moves llame from trailing on the
two rows that matter most to matching best-in-class on **eight**, leading on **two**
that no peer does — labelling replayed result content as untrusted, and escape-proofing
it — and leaving **five** visibly open: four to #215 (id form, description
sanitization, payload redaction, degrade-in-isolation) and one to #294 (truncation).
One row (provider-specific repair text) is not applicable rather than open.

Three cells are worth arguing with rather than skimming. **"still broken → #294"** is
the uncomfortable one: after #214, results are replayed into every later turn _while_
oversized payloads still collapse into a mangled `preview` string, and #215's
web-search payloads hit both at once — a reason to sequence #294 before #215 rather
than treating it as unrelated cleanup. **"n/a — the SDK maps per provider"** is a
consequence of using the SDK's portable parts: openclaw needs provider-specific repair
text because it hand-builds provider-native blocks, and llame does not.
**"not examined"** is honest rather than modest — this audit covered peer replay and
persistence, never their rendering, so those cells record absence of evidence, not
evidence of absence.

openclaw is the closest peer on **vision**, and on this axis it is also the most
advanced implementation: it leads on five of the twelve rows. Reading it changed
F2, F4, and F8, and produced F10 outright. It is the peer to keep re-reading
as #214 and #215 land — not opencode, despite the shared stack.

## Decisions taken, and where they landed

All four open decisions were resolved when `add-dynamic-tool-catalog` was written.
Full rationale is in that change's `design.md`; the outcomes:

1. **F7 boot-validation split** — namespace-split chosen, deferred to #215.
2. **F8 bind-drift policy** — withdraw-and-continue chosen, deferred to #215. The
   canonicalization fix (F-adjacent, D2 in that design) lands in #214 because
   JSON-Schema tools create the false-drift bug there.
3. **F1 observation projection** — **built, not gated.** The measurement was retired
   by the user-visible asymmetry (the UI renders tool results the model has lost) and
   by the within-turn/across-turn inconsistency. #214 specifies replay directly,
   including unsuccessful calls.
4. **F10 redaction** — deferred to #215, against the recommendation above. #214 has
   no tool that can carry a credential, and no shared redaction helper exists to
   build on.

`add-dynamic-tool-catalog` implements only what has a consumer today: JSON-Schema
input schemas, the comparison fix, cooperative cancellation, tool settling on
termination (#293), and tool-observation replay — whose consumer is the shipped
conversation-search tool plus any user asking a follow-up about what it returned.

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

### Externally supplied tool descriptions and schema prose are neutralized

Deferred because it is no cheaper now than later — it changes a string's value, not
the snapshot format — and #214's test tool is authored in-repo.

**Scope, precisely:** this covers a tool's own **declaration** text — its description
and the `description` strings inside its schema — which flows into the hashed snapshot
and the owner-visible receipt. It is a different surface from the escape-proofing of
replayed **result content**, which #214 does implement. Both reuse the same sanitizer
on different inputs; conflating them would leave the declaration surface unprotected
while looking done.

Re-validate: confirm `instance-config/authored-text.ts` still enforces both rules (a
value cannot close a boundary it did not open; a reserved structural name is never
emitted) before reusing it, and confirm the neutralization point is where the tool
entry is built, so hashing, the receipt, and the provider request all observe the
same neutralized form. Evidence: F5.

### Also inherited

- The tool-observation projection **already exists** after #214, built against
  conversation-search rows. #215 extends it to its own payloads rather than inventing
  it, and inherits its properties: the conventional tool-call/tool-result
  representation with every call paired, content labelled untrusted and escape-proofed,
  bounded, frozen once projected, compaction-clearable. The labelling and
  escape-proofing are the controls that matter once remote output is replayed on every
  later turn.
- #294 (tool-result truncation) is independent, but the context-window-derived caps
  it defers depend on a per-tool result limit that #214 did **not** add.
- Re-read openclaw before starting. It led five of the twelve comparison rows and
  changed three findings here; it remains the most relevant peer for this work.
