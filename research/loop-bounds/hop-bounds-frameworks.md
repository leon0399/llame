# Message-loop bounds in four agent frameworks

Checked 2026-11-23 against `main` of each repo and the versioned docs linked below. Where a default is not stated by the source, it is marked "unstated".

## AutoGen / AG2

Two code lines share the AutoGen name: new `autogen-agentchat` (0.4+, `microsoft/autogen`) and AG2 / old `pyautogen` (`ag2ai/ag2`, previously `microsoft/autogen` v0.2.x).

### New AutoGen — `MaxMessageTermination` (message-count bound)

- Mechanism: `MaxMessageTermination` termination condition for any team.
- What is counted: chat messages in the delta since the condition was last called; `BaseAgentEvent` only if `include_agent_event=True` (default `False`).
- Default: **none** — `max_messages` is a required constructor argument (`__init__(self, max_messages: int, include_agent_event: bool = False)`).
- At the limit: returns `StopMessage(content="Maximum number of messages N reached, current message count: M")`; the team stops and `TaskResult.stop_reason` carries that string. No exception is raised to the model. Calling a terminated condition again raises `TerminatedException("Termination condition has already been reached")`. The condition resets automatically after each `run()`/`run_stream()`.
- Owner control: constructor argument; `reset()` restores the count. `&`/`|` compose conditions.
- Reset on new user message: conditions reset per run, not per message; a new task inside the same run shares the budget.
- Citations: <https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html>; source <https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py>.

### New AutoGen — team `max_turns` (agent-turn bound)

- Mechanism: `max_turns` on `BaseGroupChat` and therefore `RoundRobinGroupChat`, `SelectorGroupChat`, `Swarm`.
- What is counted: agent turns/responses, checked after each agent response (one termination check per response even if it contains several inner messages).
- Default: **`None` = no limit**. Docstring: "Defaults to None, meaning no limit"; without a termination condition the group chat "will run indefinitely". Same default on `RoundRobinGroupChat`, `SelectorGroupChat`, and `Swarm`.
- At the limit: publishes a `GroupChatTermination` carrying `StopMessage(content="Maximum number of turns N reached.")`, resets `_current_turn = 0`, and stops. No exception; invalid `max_turns <= 0` raises `ValueError("The maximum number of turns must be greater than 0.")` at construction.
- Owner control: constructor argument per team; `team.reset()` clears team state. The turn counter is per manager instance, and a manager is built per run.
- Reset on new user message: counter resets when a limit fires and is built fresh per run; a new `run(task=...)` starts at 0.
- Citations: `_base_group_chat_manager.py` lines 60-61 and 212-224 (<https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat_manager.py#L60-L61>); `_round_robin_group_chat.py#L115-L116`; `_selector_group_chat.py#L385-L386`; `_swarm_group_chat.py#L143-L144`.

### New AutoGen — `max_tool_iterations` on `AssistantAgent`

- Mechanism: `AssistantAgent(max_tool_iterations=...)`.
- What is counted: sequential tool-call iterations (model call → tool calls → another model call) inside a single agent run.
- Default: **1** (`max_tool_iterations: int = Field(default=1, ge=1)`), i.e. tool calls execute once and the result is returned.
- At the limit: the loop breaks to the summary/reflection step; no exception, no error string to the model. Values `< 1` raise `ValueError`.
- Owner control: constructor argument (examples use 5); can be dumped/loaded via agent config.
- Reset on new user message: per `on_messages`/run invocation; a new agent call gets a fresh budget.
- Citations: `_assistant_agent.py#L84`, `#L144`, `#L703`, `#L1113-L1223` (<https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py#L84>).

### New AutoGen — exceptions

- `TerminatedException` is raised only when a termination condition that already fired is called again; a normal limit hit is reported as a `StopMessage`/`TaskResult.stop_reason`, not an exception. Citation: `_terminations.py` (class docstrings + `raise TerminatedException`) and the termination tutorial's `TaskResult(... stop_reason='Maximum number of messages 3 reached...')` output.

### AG2 / old AutoGen — `max_consecutive_auto_reply`

- Mechanism: `ConversableAgent.max_consecutive_auto_reply` (per recipient/sender).
- What is counted: consecutive auto replies from that agent to a given sender (`_consecutive_auto_reply_counter[sender]`, with a per-sender limit dictionary).
- Default: **100** via class attribute `MAX_CONSECUTIVE_AUTO_REPLY = 100` when the argument is `None`. Documented as "no limit provided, class attribute MAX_CONSECUTIVE_AUTO_REPLY will be used".
- At the limit: with `human_input_mode="NEVER"` the agent returns `reply = "exit"` and the chat stops (old AutoGen: `return True, None`, no message). AG2 additionally sets `termination_reason = "Maximum number of consecutive auto-replies reached"` and emits `TerminationEvent`. With `"TERMINATE"` it instead asks the human for input.
- Owner control: constructor argument, or `update_max_consecutive_auto_reply(value, sender=None)`; `max_consecutive_auto_reply(sender)` reads it. `0` means no auto reply.
- Reset on new user message: the counter is reset to 0 whenever a human reply arrives (or the limit is 0) and when the chat stops; `initiate_chat` restarts the conversation by default, and `clear_history=False` continues it.
- Citations: old AutoGen `microsoft/autogen` v0.2.40 `autogen/agentchat/conversable_agent.py#L62`, `#L172-L177`, `#L1827-L1845` (<https://github.com/microsoft/autogen/blob/v0.2.40/autogen/agentchat/conversable_agent.py#L62>); AG2 v0.9.9 `ag2/agentchat/conversable_agent.py#L141`, `#L275-L279`, `#L2571-L2573`, `#L2624-L2627` (<https://github.com/ag2ai/ag2/blob/v0.9.9/autogen/agentchat/conversable_agent.py#L141>); FAQ <https://docs.ag2.ai/latest/docs/user-guide/FAQ/>.

### AG2 / old AutoGen — `GroupChat.max_round` and `GroupChatManager`

- Mechanism: `GroupChat(max_round=...)`, driven by `GroupChatManager.max_consecutive_auto_reply` and the manager's round loop.
- What is counted: conversation rounds; the manager appends one message per round and stops at `max_round` even with no termination message.
- Default: **10** rounds (`max_round: int = 10`); `GroupChatManager.max_consecutive_auto_reply` defaults to **`sys.maxsize`** ("unlimited consecutive auto reply by default").
- At the limit: the loop breaks; AG2 sets `termination_reason = f"Maximum rounds ({groupchat.max_round}) reached"`. No exception.
- Owner control: `max_round` field; `max_consecutive_auto_reply` manager argument; `update_max_consecutive_auto_reply`.
- Reset on new user message: per `initiate_chat`/group-chat session.
- Citations: v0.2.40 `autogen/agentchat/groupchat.py#L114`, `#L1013-L1014`, `#L1155-L1164`; AG2 v0.9.9 `autogen/agentchat/groupchat.py#L133`, `#L1063`, `#L1212-L1215` (<https://github.com/ag2ai/ag2/blob/v0.9.9/autogen/agentchat/groupchat.py#L133>).

### AG2 / old AutoGen — `initiate_chat(max_turns=...)`

- Mechanism: pairwise chat limit, distinct from auto replies.
- What is counted: conversation turns between two agents, "one conversation round trip", auto and human replies alike.
- Default: **`None`** — "If max_turns is set to None, the chat will continue until a termination condition is met. Default is None."
- At the limit: AG2 emits `TerminationEvent(termination_reason=f"Maximum turns ({max_turns}) reached")`; old AutoGen returns the chat result without raising.
- Owner control: `initiate_chat(..., max_turns=N)`.
- Reset: each `initiate_chat` call; restarts by default.
- Citations: v0.2.40 `conversable_agent.py#L1011-L1013`; AG2 v0.9.9 `conversable_agent.py#L1496-L1498`, `#L1385-L1388`.

## CrewAI

Source layout on `main` is `lib/crewai/src/crewai/` (checked 2026-11-23).

### `max_iter` on `Agent` / `Crew`

- Mechanism: per-agent (and per-executor) iteration cap.
- What is counted: agent reasoning/action iterations (`AgentExecutorState.iterations`), one per model→tool/step loop.
- Default: **25**. `BaseAgent.max_iter: int = Field(default=25, ...)` and `AgentExecutor.max_iter: int = Field(default=25)`. Note a documentation discrepancy: the current docs table says "Default is 20" (<https://docs.crewai.com/en/concepts/agents>, v1.15.44), while the code says 25. The code is authoritative for the installed package.
- At the limit: `has_reached_max_iterations(iterations, max_iter)` routes to `force_final_answer`; `handle_max_iterations_exceeded` prints "Maximum iterations reached. Requesting final answer." and makes one more LLM call, returning an `AgentFinish`. No exception; `EmptyLLMResponseError` is possible if that final call and its retry are empty.
- Owner control: `Agent(max_iter=...)`, `Agent.max_iter` field (and per-agent JSONC `settings.max_iter`).
- Reset on new user message: iterations reset to 0 when the executor starts a task / after feedback (`self.state.iterations = 0`); there is no user-message-driven reset.
- Citations: `agents/agent_builder/base_agent.py#L272-L274` (<https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/agents/agent_builder/base_agent.py#L272-L274>); `agents/agent_executor.py#L223`, `#L2516-L2526`, `#L3588-L3599`; `utilities/agent_utils.py#L361-L412` (<https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/utilities/agent_utils.py#L361-L412>).

### `max_rpm`

- Mechanism: requests-per-minute throttle, on `Agent` and `Crew`.
- What is counted: model requests per minute per controller.
- Default: **`None`** (disabled) on both `Agent` (`max_rpm: int | None = Field(default=None, ...)`) and `Crew` (`max_rpm: int | None = Field(default=None, ...)`).
- At the limit: does not raise; logs "Max RPM reached, waiting for next minute to start." and blocks with `time.sleep(60)`.
- Owner control: `Agent(max_rpm=...)`, `Crew(max_rpm=...)`; when the crew sets one, it is injected into each agent's controller.
- Reset: the controller resets its counter on a 60 s timer / after the wait.
- Citations: `agents/agent_builder/base_agent.py#L260-L264`; `crew.py#L326-L330`, `#L658-L659`, `#L774-L776`; `utilities/rpm_controller.py#L46-L74` (<https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/utilities/rpm_controller.py#L46-L74>).

### `max_execution_time`

- Mechanism: wall-clock cap for one task execution.
- What is counted: seconds of task execution.
- Default: **`None`** (no timeout) — `max_execution_time: int | None = Field(default=None, ...)`.
- At the limit: raises `TimeoutError("Task '<desc>' execution timed out after N seconds. Consider increasing max_execution_time or optimizing the task.")`; the worker is cancelled.
- Owner control: `Agent(max_execution_time=...)` / JSONC settings.
- Reset: per task execution; not user-message-driven.
- Citations: `agent/core.py#L270-L273`, `#L1063-L1067`, `#L1116-L1118` (<https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/agent/core.py#L270-L273>).

### `allow_delegation` and delegation depth

- Mechanism: `Agent.allow_delegation` enables the "Delegate work to coworker" tool; delegation is a tool call that creates a `Task` for the coworker and calls `selected_agent.execute_task(...)`.
- What is counted: no dedicated delegation/hop counter exists on `Agent` or `Crew` (field lists inspected at `base_agent.py:188-275`). Delegation calls consume the delegator's `max_iter` iterations; the delegated agent then runs under its own `max_iter` (default 25). So depth is bounded only transitively by per-agent iteration caps, not by a chain-length setting. [INFERENCE from the two mechanisms combined]
- Default: `allow_delegation = False` (delegation off).
- At the limit: the delegator hits `max_iter` and is forced to a final answer as above; the tool returns an error string for unknown coworkers (`agent_tool_unexisting_coworker`) rather than raising to the model.
- Owner control: `Agent(allow_delegation=True)` and `max_iter`.
- Reset: same as `max_iter` (per task execution).
- Citations: `base_agent.py#L265-L274`; `tools/agent_tools/delegate_work_tool.py` and `base_agent_tools.py` (`_execute` → `Task(..., agent=selected_agent)` → `selected_agent.execute_task(...)`) (<https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/tools/agent_tools/base_agent_tools.py>).

## LangGraph

### `recursion_limit`

- Mechanism: run-level recursion/step budget on `invoke`/`stream` config.
- What is counted: **super-steps** — "The recursion limit caps how many super-steps one run may execute." Parallel nodes in one super-step count once; a node's internal function calls do not.
- Default: **10,007** from LangGraph 1.1.4 (`DEFAULT_RECURSION_LIMIT = _DefaultRecursionLimit(getenv("LANGGRAPH_DEFAULT_RECURSION_LIMIT", "10007"))`); **10,000** for 1.0.6–1.1.3. Older LangChain/LangGraph material still documents 25: the `RunnableConfig.recursion_limit` reference says "If not provided, defaults to `25`", and `langgraph_sdk` says the same, but LangGraph's runtime constant overrides that. Do not use 25 as the current default.
- At the limit: raises `GraphRecursionError` with message `"Recursion limit of {N} reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key."` (error code `GRAPH_RECURSION_LIMIT`). Caught outside the graph, or avoided inside with `RemainingSteps`.
- Owner control: pass `recursion_limit` as a **top-level** config key, `graph.invoke(inputs, {"recursion_limit": 1000})` (not under `configurable`); or bind it with `graph.with_config(recursion_limit=...)` (Runnable config kwargs); or set env `LANGGRAPH_DEFAULT_RECURSION_LIMIT`.
- Reset on new user message: the budget is recomputed at the start of each run — `self.step = checkpoint_metadata["step"] + 1; self.stop = self.step + config["recursion_limit"] + 1` — so every `invoke`/`stream` call gets a full budget even on a resumed thread. A new user message submitted as a new `invoke` therefore gets a fresh budget [INFERENCE from the code path; docs only describe a per-run limit].
- Citations: <https://docs.langchain.com/oss/python/langgraph/graph-api#recursion-limit>; `libs/langgraph/langgraph/_internal/_config.py#L40-L41` (<https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/_internal/_config.py#L40-L41>); `libs/langgraph/langgraph/pregel/main.py#L3108-L3117`; `libs/langgraph/langgraph/pregel/_loop.py#L1930-L1931`; stale-25 references <https://reference.langchain.com/python/langchain-core/runnables/config/RunnableConfig/recursion_limit> and <https://reference.langchain.com/python/langgraph-sdk/schema/Config/recursion_limit>; `with_config` <https://reference.langchain.com/python/langchain-core/runnables/base/Runnable/with_config>.

### Proactive counter (`RemainingSteps`, `langgraph_step`)

- Mechanism: managed state value `RemainingSteps` (Python) and `config["metadata"]["langgraph_step"]` for routing before the limit.
- What is counted: steps remaining before `recursion_limit`, and the current step.
- Default: derived from `recursion_limit` (so 10,007 by default).
- At the limit: nothing raised if the graph routes to a completion path first; otherwise `GraphRecursionError` as above.
- Owner control: same `recursion_limit` config; pattern documented for conditional routing.
- Citations: <https://docs.langchain.com/oss/python/langgraph/graph-api-control-flow#impose-a-recursion-limit> and `#handle-recursion-with-remainingsteps`.

## OpenAI Agents SDK

Python package `openai-agents` (`openai/openai-agents-python`).

### `max_turns` on `Runner.run` / `run_sync` / `run_streamed`

- Mechanism: turn cap on the agent loop.
- What is counted: turns, where "A turn is defined as one AI invocation (including any tool calls that might occur)". Handoffs re-enter the loop and therefore consume a turn; there is no separate handoff-cap field.
- Default: **10** — `DEFAULT_MAX_TURNS = 10` in `src/agents/run_config.py`, used as the default for `max_turns` on all three Runner methods.
- At the limit: raises `MaxTurnsExceeded(f"Max turns ({max_turns}) exceeded")` (`AgentsException` subclass), unless an error handler handles it. Pass `max_turns=None` to disable the limit.
- Owner control: per-call argument `Runner.run(..., max_turns=N)`; `None` disables. `RunConfig` has no `max_turns` field — it carries model/provider/session/handoff-history/tracing/tool-execution settings instead (`model`, `model_provider`, `model_settings`, `handoff_input_filter`, `nest_handoff_history`, `handoff_history_mapper`, guardrails, `session_settings`, `call_model_input_filter`, `tool_execution`, `reasoning_item_id_policy`, tracing fields).
- Reset on new user message: the count is scoped to one `Runner.run*` call, so a new user message / new run starts a fresh count; resuming via `RunState` continues a paused run, not a new one [INFERENCE from the per-call scoping].
- Citations: <https://openai.github.io/openai-agents-python/running_agents> ("If we exceed the `max_turns` passed, we raise a `MaxTurnsExceeded` exception. Pass `max_turns=None` to disable this turn limit."); <https://openai.github.io/openai-agents-python/ref/run/> (`max_turns` table row, default `DEFAULT_MAX_TURNS`); `src/agents/run_config.py#L50` (<https://github.com/openai/openai-agents-python/blob/main/src/agents/run_config.py#L50>); `src/agents/run.py#L281`, `#L1586` (`MaxTurnsExceeded(f"Max turns ({max_turns}) exceeded")`); exceptions <https://openai.github.io/openai-agents-python/ref/exceptions/>.

### Handoff / agent-loop limits

- Mechanism: none beyond `max_turns`. The loop is: call LLM → final output (end) | handoff (swap agent and re-run loop) | tool calls (run, append, re-run loop). A handoff is a loop iteration, so ping-pong between agents is bounded only by `max_turns`.
- What is counted: loop iterations (= `max_turns` turns).
- Default: 10 (same `DEFAULT_MAX_TURNS`).
- At the limit: `MaxTurnsExceeded`.
- Owner control: `max_turns`; `RunConfig.handoff_input_filter` / `nest_handoff_history` shape handoff inputs but do not limit count.
- Citation: <https://openai.github.io/openai-agents-python/running_agents#the-agent-loop>.

### `MaxTurnsExceeded` details

- Type: `class MaxTurnsExceeded(AgentsException)`, "Exception raised when the maximum number of turns is exceeded"; message preserved on `.message`.
- Citation: <https://openai.github.io/openai-agents-python/ref/exceptions/#agents.exceptions.MaxTurnsExceeded>; `src/agents/exceptions.py#L331-L338`.

### Quick comparison

| Framework / mechanism | Counts | Default | On limit |
|---|---|---|---|
| new AutoGen `MaxMessageTermination` | chat messages (delta) | none (required arg) | `StopMessage` / `stop_reason`, no raise |
| new AutoGen team `max_turns` | agent turns | `None` (no limit) | `StopMessage` "Maximum number of turns N reached.", no raise |
| new AutoGen `max_tool_iterations` | tool-call iterations per agent run | 1 | summary/reflect step, no raise |
| AG2/old `max_consecutive_auto_reply` | consecutive auto replies per sender | 100 | stop; `"exit"`; AG2 `TerminationEvent` |
| AG2/old `GroupChat.max_round` | rounds | 10 | break; AG2 "Maximum rounds (N) reached" |
| AG2/old `initiate_chat(max_turns)` | round trips | `None` | AG2 `TerminationEvent` "Maximum turns (N) reached" |
| CrewAI `max_iter` | agent iterations | 25 in code (docs say 20) | forced final answer, no raise |
| CrewAI `max_rpm` | model req/min | `None` | sleep 60 s |
| CrewAI `max_execution_time` | seconds | `None` | `TimeoutError` |
| CrewAI `allow_delegation` | delegation tool calls | `False`; no depth cap | bounded by `max_iter` [INFERENCE] |
| LangGraph `recursion_limit` | super-steps | 10,007 (>=1.1.4; 10,000 for 1.0.6-1.1.3; docs elsewhere still say 25) | `GraphRecursionError` |
| OpenAI `max_turns` | AI invocations/turns (incl. handoffs) | 10 | `MaxTurnsExceeded` |
