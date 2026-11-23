# How agent systems bound message loops between agents

Research for llame (issue #1759 territory: authority and loops of a Run started by a `write`).
Compiled 2026-11-23. Sources: local clones (primary source) first, then official docs/specs. Every
default below is either read in source at the pinned commit or quoted from a primary doc; `[INFERENCE]`
marks a conclusion I derived rather than read.

## 0. Pins and method

| Repo | Checkout | Commit |
| --- | --- | --- |
| openclaw/openclaw | `~/.cache/checkouts/github.com/openclaw/openclaw` | `5d8c25101e6` (2026-11-12) |
| can1357/oh-my-pi | `…/can1357/oh-my-pi` | `de397d59d3aea002ebd2acb52ffeac64644f7cf7` |
| openai/codex | `…/openai/codex` | `e58bf8f5233b` (2026-11-11) |
| sst/opencode | `…/sst/opencode` | `51fcace74ab2` (2026-11-11) |
| NousResearch/hermes-agent | `…/NousResearch/hermes-agent` | `56ac7b5d51` (2026-11-11) |
| wolfqing/OpenGrokBot | `…/wolfqing/OpenGrokBot` | `b59c517` |
| CopilotKit/OpenDuet | `…/CopilotKit/OpenDuet` | `f52288f` |
| leepokai/Codync | `…/leepokai/Codync` | `df80259` |
| raghavpillai/openteam | `…/raghavpillai/openteam` | `bf73324` |

Claude Code is closed source: facts come from `code.claude.com/docs` pages fetched 2026-11-23 (v2.1.x
line). A2A is the released 1.0.0 spec at `a2a-protocol.org/latest/specification`. Framework defaults
were read from GitHub `main` (`microsoft/autogen`, `ag2ai/ag2`, `crewAIInc/crewAI`,
`langchain-ai/langgraph`, `openai/openai-agents-python`) with the file:line recorded.

**Counting units differ and that is the whole difficulty.** A "hop" in bot products is one *send by a
bot*, so a 20-round two-agent discussion is ~40 hops. A "turn" in SDKs is one *model invocation,
including its tool calls*. A "super-step" in LangGraph is one graph tick, and parallel nodes share it.
A "round" in a group chat is one pass over all participants. A "depth" counts *spawned layers*, not
messages at all. Any comparison that mixes them is wrong by an order of magnitude.

## 1. Master table — per-loop (agent↔agent) bounds

The mechanism asked about: what stops two agents from talking forever.

| System | Mechanism | Counted unit | Default | At the limit | Reset |
| --- | --- | --- | --- | --- | --- |
| **Hermes Agent** (`message_agent`, Bot Mode) | `gateway.bot_loop_guard.max_hops` chain gate carried in the author envelope | one `message_agent` send inside one chain (a fan-out is one hop; a human turn starts hop 1) | **4**; also `max_events` **20** per `window_seconds` **300**, `cooldown_seconds` **600** | Send **refused before delivery**; model-facing refusal text: "This bot-to-bot exchange already reached its limit of N messages … Do not retry; finish your turn and tell your user where it stands." | A human message deletes the chain state (`new chain starts with their message`); also config edit |
| **Hermes** (reply rule) | `bot_replies_expect_reply` | whether an answer to a reply is allowed | **false** | A bot answering the reply it just got is `notify_only` (`wake="none"`, `[no reply needed]` marker) and a turn started by such a message cannot message that bot back | Config true |
| **Hermes** (dupe rule) | same-ask dedupe keyed on `(recipient, sha256(body))` | identical ask inside one chain | always on | Per-recipient refusal: "You already sent this exact message to that bot in this exchange …" | New chain |
| **Codync** (`message_bot`) | host-side chain counter on the reply notice | handoffs in a chain (A asks B, B's answer makes A ask C …) | **8** | "the ninth handoff must never be queued" (`team_e2e.rs:254`); host refuses | Not documented; a new chain starts with a fresh request |
| **Codync** (pair rate) | per-pair budget | messages between one pair | **burst of 5**, then **one every 2 minutes**; identical text twice in **10 minutes** refused | Refused at the receiving computer's host | Time |
| **OpenGrokBot** (`message_bot`) | `MAX_HOPS` | dispatches in a chain | **2** ("one dispatch plus one reply; more is echo") | Refused; returned to the calling bot *as a sentence*, not an exception | New operator message |
| **OpenDuet** (handoff) | `BOT_HANDOFF_MAX_DEPTH`, `BOT_HANDOFF_MAX_PER_RUN` | depth of the handoff chain; handoffs per run | **1** and **3** | Refusal sentence written to the caller + audit event `agent.handoff_refused` | New run |
| **OpenTeam** (channel rounds) | `GROUP_MAX_ROUNDS`, `GROUP_MAX_MEMBER_TURNS`, `GROUP_MAX_MESSAGES_PER_TURN` | rounds, member turns, messages per turn | **3**, **10**, **3** (members 6) | Round loop stops | New round/task |
| **OpenClaw** (`sessions_send`) | **none** — replaced by a reply-once rule | — | reply is delivered once, "your response will not be sent back to the target session" (`sessions-send-tool.a2a.ts:207`) | No loop can form through `sessions_send` itself | n/a |
| **OpenClaw** (retired knob) | `session.agentToAgent.maxPingPongTurns` | agent-to-agent reply turns | was **5**, max **20** (`CHANGELOG/2026.5.12.md:37`) | — | **Retired**: listed as a retired legacy key in `src/commands/doctor/shared/legacy-config-migrations.runtime.retired-media.ts:157`; no runtime effect |
| **oh-my-pi** (IRC) | **none** | — | — | Nothing bounds peer ping-pong; `wakeRelay` messages are answers that never wake, broadcasts draw no automatic reply (`tui/src/tools/irc.ts` per `docs/research/.../oh-my-pi-yield-and-messaging.md` §4.2) | n/a |
| **Codex CLI** | **none** for messages; `send_input` is queue-only, `followup_task` triggers a turn | — | — | No message-count or hop cap on `send_input`/`followup_task`; only depth/thread caps (§3) | n/a |
| **OpenCode** | **none** for follow-ups; depth caps spawning only | — | `experimental.subagent_depth` **1** | Follow-up to an existing subagent `sessionID` is unlimited; new nesting past depth 1 refused (§3) | n/a |
| **Claude Code** (cross-session) | burst refusal + rate limit + queue caps — **not** a chain cap | sends in a window; queued inbound | burst refuse at **30 recent**; queue **50** accepted; hold **100**; `dialogExpiry` **5 min**; message **1,048,576** chars | Burst: "Too many messages to this session just now: 30 were sent recently …"; slow exchanges are **unbounded** ("two sessions that answer each other slowly enough not to be throttled can exchange thousands of messages"); a long exchange pauses sending until **the owner types a prompt** | Human prompt |
| **Google A2A** | **none** | — | — | Only terminal task states reject messages (`UnsupportedOperationError`); `messageId` dedupe is an optional server MAY | n/a |
| **AG2 / old AutoGen** | `max_consecutive_auto_reply` (per sender) | consecutive auto replies from A to B | **100** | `human_input_mode="NEVER"` → `reply="exit"` and the chat stops; other modes prompt the human; AG2 sets `termination_reason="Maximum number of consecutive auto-replies reached"` + `TerminationEvent` | A human reply resets the counter to 0 |
| **new AutoGen** | `MaxMessageTermination(max_messages=N)` / team `max_turns` | chat messages / agent turns | `max_messages` **required** (no default); `max_turns` **None = no limit** | `StopMessage` with a count string → `TaskResult.stop_reason`; no exception to the model | Conditions reset per `run()`; a new `run(task=…)` starts fresh |
| **CrewAI** | **no pair/chain counter**; delegation is a tool call charged to `max_iter` | — | `max_iter` **25** in code (docs say 20); `allow_delegation` **False** | Delegator is forced to a final answer after `max_iter`; delegated agent runs under its own `max_iter` [INFERENCE: depth is bounded only transitively] | Per task execution |
| **LangGraph** | `recursion_limit` | super-steps of the graph run | **10,007** (≥1.1.4); 10,000 (1.0.6–1.1.3); stale docs still say 25 | `GraphRecursionError("Recursion limit of N reached without hitting a stop condition …")` | Per `invoke`/`stream` (fresh budget each run); top-level `{"recursion_limit": N}` or env |
| **OpenAI Agents SDK** | `max_turns` on `Runner.run*` | turns = one AI invocation incl. its tool calls; **handoffs consume turns** | **10** | `MaxTurnsExceeded("Max turns (N) exceeded")` | Per run; `max_turns=None` disables |

## 2. Second table — per-run and per-agent turn/tool budgets (not pair loops, but the thing most systems actually have)

| System | Mechanism | Counted unit | Default | At limit | Reset |
| --- | --- | --- | --- | --- | --- |
| Claude Code | subagent `maxTurns` frontmatter | agentic turns | **not documented** (harness-level `max_turns` default is "No limit") | Output marked partial and resumable (v2.1.246+); SDK emits `error_max_turns` | Per invocation |
| Claude Code | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | subagents running | **20** | `Concurrent subagent limit reached`, told not to retry | Count drop |
| oh-my-pi | `MAX_YIELD_TOOL_ERRORS`; yield reminder ladder | consecutive thrown `yield` calls; turns without a tool call | **6**; **3** reminders then forced `toolChoice: yield` | Child fails with "stopping to avoid an infinite submit loop"; no-yield child exits with `SUBAGENT_WARNING_MISSING_YIELD` | Successful yield |
| oh-my-pi | `wait` ladder / poll guard | back-to-back idle waits | 5s→10s→30s→60s→300s, reset after 60s gap | Notice appended ("stop polling"); `useless:true` for the loop guard | Activity |
| Codex CLI | `agent_max_threads` / V2 residency capacity | live agent threads | **6** | `CodexErr::AgentLimitReached { max_threads }` | Closing agents; V2 evicts a resident to make room, else errors |
| Codex CLI | rollout budget | tokens | config-set | `CodexErr::SessionBudgetExceeded` | New budget window |
| Hermes | `delegation.max_iterations` | child tool-calling iterations | **250** (`tools/delegate_tool.py:106`) | Child exits with `exit_reason="max_iterations"`, result flagged `truncated`, parent told "TRUNCATED: hit max_iterations — work may be incomplete" | New delegation |
| Hermes | heartbeat staleness | idle / stuck-on-tool cycles | 450 s idle, 1200 s in-tool | Wait ends with a stale verdict; child keeps unwinding so its real result can still land | Progress |
| new AutoGen | `AssistantAgent.max_tool_iterations` | sequential tool iterations in one run | **1** | Falls through to the summary/reflect step; no error | Per run |
| CrewAI | `max_rpm` / `max_execution_time` | requests/min; seconds | `None` / `None` | Sleeps 60 s / raises `TimeoutError` | Timer |
| OpenClaw | `tools.loopDetection.ping_pong` | alternating tool-call pairs inside one agent | warning **10**, critical **20** | Warning injected; at critical "Session execution blocked to prevent resource waste" | Progress evidence |

## 3. Third table — depth and fan-out (the only bound most coding harnesses have)

| System | Mechanism | Counted unit | Default | At limit | Reset |
| --- | --- | --- | --- | --- | --- |
| Codex CLI (V1) | `[agents] max_depth` → `DEFAULT_AGENT_MAX_DEPTH` (`core/src/config/mod.rs:284`) | nesting layers | **1** | Tool error to model: "Agent depth limit reached. Solve the task yourself." (`tools/handlers/multi_agents/spawn.rs:76-82`) | Config; ignored by V2 |
| Codex CLI (V2) | residency capacity = `max_concurrent_threads_per_session - 1` | resident threads | derived from config (unset → backend default) | `AgentLimitReached`; V2 unloads a resident first, errors only if it cannot | Closing/eviction |
| OpenClaw | `subagents.maxSpawnDepth` (`config/agent-limits.ts:25`) | spawn layers | **5** (schema max 5); children/agent **5** (max 20); concurrent **8** | Spawn refused at the depth/admission check | Config |
| oh-my-pi | `task.maxRecursionDepth` (`task/settings.ts:502-511`) | subagent spawn levels | **2** | Spawn refused: "Cannot spawn another agent at task depth N; maximum depth is M." (`task/structured-subagent.ts:335-339`) | Config |
| OpenCode | `experimental.subagent_depth` (`packages/core/src/tool/plugin/subagent.ts:135`) | ancestor sessions with a `parentID` | **1** | `ToolFailure`: "Subagent depth limit reached (N). Increase \"experimental.subagent_depth\" to allow nested subagents." | Config |
| Hermes | `delegation.max_spawn_depth` (`tools/delegate_tool_config.py:23`) | delegation layers | **1** (flat: parent 0 → child 1) | `delegation_depth_exceeded` ("the gateway owner refused a subagent this deep") | Config; oneshot children **2**, concurrent **10** |
| Claude Code | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | subagent layers | **3** | `Agent` tool is **withheld** from a subagent at the limit (fork variant returns an error instead); teammates cannot spawn teammates at all | Env/settings |

## 4. Per-system detail worth keeping

**Hermes is the only production coding harness here with a real hop counter.** It is explicit that
the counter must not live in the model: "The hop number rides in the delivery's author envelope
(`hops`), which only the runtime writes, so the model cannot reset it" (`agent/bot_chain.py:1-14`).
The chain state is keyed by session id, not on the agent, "because a gateway may rebuild the agent
between turns, and a lost count would hand the chain a fresh budget", and it is carried across a
compression rotation (`carry_chain`). Each side also counts its own bot turns, "so a lane that
carries no envelope (the Desktop relay) is still capped". Refusals are per recipient, not per call, so
one bad target does not block the others. `gateway.bot_loop_guard.enabled: false` turns all of it off.

**OpenClaw removed its counter and kept a structural rule instead.** `maxPingPongTurns` existed with
default 5 and a max of 20 (`CHANGELOG/2026.5.12.md:37`, "for longer agent-to-agent reply chains") and
is now a retired key with no runtime effect. What remains is (a) a result reply is delivered **once**
and "your response will not be sent back to the target session", and (b) `tools.loopDetection`
catches an agent talking to *itself* in tool calls (warn 10 / critical 20). Group chats (several agents
in one channel) are bounded separately and very tightly: `maxRounds` **1**, `maxTurns`
`participants.length` (`src/auto-reply/group-thread-config.ts:38-39`), with schema maxima of 4 rounds,
32 turns, 16 agents (`zod-schema.messages.ts:92-96`).

**oh-my-pi deliberately has no ping-pong bound.** Its loop work went into *liveness* rules instead:
a relay message is an answer and never a wake source ("or two idle peers ping-pong forever"), a
broadcast draws no automatic reply, a non-parent peer message to a subagent gets its own turn rather
than extending a finished one, and `wait` returns early with an explanation when the asked agent is
blocked on the caller, waiting on the user, or finished without replying. Prior note:
`docs/research/product-vision/2026-11-07-agent-execution-substrate/oh-my-pi-yield-and-messaging.md`
§4.4, §6.3 ("nothing bounds ping-pong between two woken agents beyond provider cost").

**Codex splits queue from wake and bounds threads, not messages.** `send_input` is queue-only and
"does not trigger a new turn"; `followup_task` triggers one. Depth 1 means only the root can spawn, so
a peer chain cannot form at all — the only repeating exchange is root↔child, and that is unbounded.
V2 ignores `max_depth` and bounds residency instead (unload a resident, else `AgentLimitReached`).

**Claude Code is honest about the failure mode.** Docs state the quiet case plainly: two sessions that
answer each other slowly enough not to be throttled "can exchange thousands of messages without a
prompt from you"; a long exchange then pauses sending until a human types in the session, and long
reply chains stop mid-chain for the same reason. There is no hop setting anywhere on the
cross-session pages. Agent-team teammates are told to debate each other on purpose, so no reply-once
rule exists there either.

**A2A leaves the loop open by design.** No max messages, turns, hops, depth, or nesting anywhere in
1.0.0; continuation is via `contextId`/`taskId`; the only stop is a terminal task state. Idempotency is
a server MAY keyed on `messageId`. `historyLength` bounds response size, never exchange count.

## 5. What would cut a 20-round technical discussion between two agents

A "round" = one message each way, so ~40 agent-authored messages. Sorted by how early the bound bites:

| System | Where a 20-round (≈40 message) exchange dies |
| --- | --- |
| OpenGrokBot (`MAX_HOPS=2`) | **round 1.** One dispatch + one reply is the whole budget. |
| OpenDuet (`maxPerRun=3`, `maxDepth=1`) | after **3 handoffs per run**; no chain depth at all. |
| Hermes (`max_hops=4`) | **round 2** (hops 1–4 = two exchanges). A human message restarts the chain. |
| OpenTeam (`rounds 3 × turns 10 × messages/turn 3`) | **round 3** of the channel loop (up to 10 member turns each, so long if one turn batches messages). |
| Codync (chain 8, pair burst 5 then 1/2min, dupe 10min) | **round 4** by the chain cap; earlier by the pair rate (5 fast, then one per 2 minutes → 20 rounds takes ~30+ minutes even if allowed). |
| OpenAI Agents SDK (`max_turns=10`, handoffs consume turns) | **round 5.** |
| LangGraph (`recursion_limit=10007` super-steps) | never for 20 rounds; a pair loop dies in the thousands. |
| AG2 (`max_consecutive_auto_reply=100` per sender) | **round 100** — 20 rounds fits comfortably; two agents *can* burn 200 messages before stopping. |
| new AutoGen (`max_turns=None`, no termination) | **never**, unless the author adds `MaxMessageTermination`. |
| CrewAI (`max_iter=25` per task) | during the agent's 26th iteration; with tool calls per round, well before round 20. No pair counter, so a delegation chain resets the budget per agent. |
| Codex / OpenCode / oh-my-pi / Claude Code / A2A | **never** (depth 1 or 3 prevents peer chains; root↔child and cross-session exchanges are uncapped). |

Two consequences I draw from that table:

1. **Every system that bounds hops aggressively is a *bot* product, and every one of them is sized
   for "one delegation plus one answer", not for discussion.** 2, 3, 4, 8 are all "did the recipient
   act, and did it say so" budgets. A 20-round technical discussion is out of scope for that design,
   and forcing it through those caps produces the exact refusal text Hermes ships: *finish your turn
   and tell your user where it stands.*
2. **Every system built for engineering work has no hop bound at all**, and instead relies on the
   human being present plus one of: reply-once (OpenClaw), queue-vs-wake separation (Codex, omp),
   no nesting (Codex depth 1, OpenCode depth 1, Hermes depth 1), or liveness/deadlock checks (omp
   `wait`, OpenClaw `no_reply`). Claude Code documents the resulting exposure explicitly.

For llame, that suggests three separable decisions rather than one "max hops" number:

- **Hop count is a *delegation* budget, not a *discussion* budget.** If llame wants both, they must be
  different counters: a chain budget that a human/owner turn resets (Hermes/Codync) *and* a
  no-progress breaker keyed on content (Hermes duplicate-ask; Codync "same words twice in 10
  minutes"), because a legitimate 20-round review genuinely repeats "no, that is still wrong" many
  times.
- **The unit must be a host-written field that travels with the message** (Hermes `hops`, OpenDuet
  signed `depth`), since llame's Runs are durable and a counter in Run memory is lost across
  suspend/resume — the same argument OpenDuet makes for signing `depth` into its assertion.
- **Refusal shape matters more than the number.** Hermes refuses the *send* with an instruction to
  the model ("do not retry; finish your turn and tell your user"), OpenClaw refuses with a receipt
  outcome, OpenGrokBot returns a sentence and keeps the run speaking. A hard exception to the model
  (OpenAI `MaxTurnsExceeded`, LangGraph `GraphRecursionError`) is the least usable form in an
  agent-to-agent path because the sender has no way to end gracefully.

## 6. Cross-check against llame's own prior notes

- `docs/research/product-vision/2026-11-07-agent-execution-substrate/oh-my-pi-yield-and-messaging.md`
  §4.4/§6.3: omp has no per-pair counter; the missing pieces for llame are "a per-pair message/step
  budget in the cost tree and a 'last N exchanges with no tool use' breaker". The survey above
  confirms no coding harness has the former and none has the latter either — that breaker would be
  novel, not borrowed.
- `…-substrate/agent-communication.md` §2/§6.1 item 4 already concluded: "combine the three that
  work: recursion depth and children per Run, a hop count carried in provenance for bot-to-bot, and a
  deterministic dedupe key". This survey adds the defaults and the failure shapes: Hermes 4,
  Codync 8, OpenGrokBot 2, OpenDuet 1/3, OpenTeam 3×10×3, and the human-reset rule in each.
- `docs/research/standards/agent2agent.md` matches the A2A finding: the protocol bounds nothing; a
  hop budget can only come from the implementation that owns `contextId`.

## 7. Evidence gaps

- Claude Code teammate `SendMessage` limits: docs only, and the docs publish no hop/chain number
  (the burst `30`, queue `50`, hold `100`, `1 MiB`, `12 h` numbers are from the errors/cross-session
  pages, not the teams page).
- CrewAI: the delegation-depth claim is `[INFERENCE]` from `max_iter` being the executor loop plus
  delegation being an ordinary tool; no source line states a depth cap because none exists.
- AG2 `max_consecutive_auto_reply` was read at `microsoft/autogen` v0.2.40 (the last 0.2 line); the
  AG2 fork's `ag2/agentchat/conversable_agent.py` paths were reported by a sub-check at v0.9.9 but not
  read by me directly — treat AG2 specifics (TerminationEvent text) accordingly.
- LangGraph's pre-1.0.6 default of 25 is not stated by any current doc I could reach; the docs only
  speak for 1.0.6 onward, and only reference page docstrings still say 25 (stale).
- OpenClaw `maxPingPongTurns`: only the changelog (default 5, max 20) and the retired-key list were
  readable; the runtime that enforced it is gone, so its exact counting unit (turns per pair? per
  chain?) cannot be recovered from this checkout.
