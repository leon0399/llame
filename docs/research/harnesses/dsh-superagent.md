---
type: Reference
title: "DeepSeek Super-agent (dsh-superagent)"
description: "Router/Worker coding agent for one GitHub repository on DeepSeek Harness: a fail-closed admission gate, Thread subscription with pass-through, steer-batched events, and capped context with read pointers"
resource: "https://github.com/deepseek-ai/dsh-superagent-prototype"
tags:
  [
    harness,
    router-worker,
    subagents,
    triggers,
    channels,
    admission,
    steering,
    background-jobs,
    recall,
  ]
status: stable
generated:
  by: "omp/claude-opus-5-5"
  at: "2026-11-01"
observed:
  date: "2026-11-01"
  revision: "6337fc823ce20251c8de8085948165c81aaa701e"
sources:
  - id: article
    resource: "https://x.com/DeepSeekHarness/status/2116857257245987236"
    title: "Exploring Super-agent Design: Towards a More Autonomous Agent System (machine-translated X article, 2026-11-01)"
  - id: readme-scope
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md#L3-L7"
    title: "Research prototype that differs from the article; one repository, GitHub and optional Feishu"
  - id: license
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/LICENSE#L1-L3"
    title: "MIT License"
  - id: philosophy
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md#L11-L15"
    title: "Act when asked or allowed by a rule; speak only when a person must act"
  - id: master-id
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/runtime.ts#L104-L105"
    title: "One persisted main Session id per state directory"
  - id: worker-id
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L23-L26"
    title: "Worker Session id is `worker-<ticketId>`"
  - id: thread-key
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L12"
    title: "Thread key is source:id"
  - id: trigger-untrusted
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L22"
    title: "Trigger text and meta are untrusted external data"
  - id: thread-aggregate
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L156-L177"
    title: "Thread holds subscriptions, context followers, a debounce buffer, and at most one Eval"
  - id: stage
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/stage.ts#L4-L21"
    title: "Ticket stage is derived: person, working, idle, or ended"
  - id: intake
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts#L19-L52"
    title: "Intake dedupes, filters by scope, and fans a Trigger out to subscribed tickets"
  - id: evals-batch
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts#L94-L119"
    title: "One Eval batches a Thread's pending Triggers under the strongest gate result"
  - id: evals-expire
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts#L56-L69"
    title: "An expired Eval requeues twice, then records unavailable"
  - id: relay-steer
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L103-L105"
    title: "Relays reach the main Session in order as steer messages"
  - id: delivery-steer
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/delivery.ts#L73-L82"
    title: "Delivery dedupes by request id and steers, follows up, or injects"
  - id: router-nowait
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L74-L86"
    title: "The main Session may not sleep, run long commands, or wait on jobs"
  - id: danger
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L152"
    title: "Both roles run with danger-full-access"
  - id: caps
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L112-L128"
    title: "Assignment and trigger caps with a read resource for the rest"
  - id: resources
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/resources.ts#L23-L40"
    title: "orchestrator_read resource graph over tickets, triggers, threads, decisions, and transcripts"
  - id: resource-page
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/resources.ts#L87-L92"
    title: "Text pages default to 4000 characters; lists to 20 items"
  - id: github-config
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/github.ts#L25-L28"
    title: "GitHub poll interval 60-3600 s, default 60; observation switches default off"
  - id: github-poll
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/github.ts#L127-L146"
    title: "GitHub ingestion is a polling loop"
  - id: worker-shell
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/cordis.patch.yml#L44-L74"
    title: "Worker foreground shell and job waits end after 5 s"
  - id: router-preset
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/cordis.patch.yml#L121-L172"
    title: "Router preset keeps bash and read-only fs with the same 5 s caps"
  - id: bg-const
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L31-L32"
    title: "Background work may run 30 minutes after a worker turn"
  - id: bg-kill
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L629-L656"
    title: "Jobs past the limit are killed and the worker is told"
  - id: report-tool
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/executor.ts#L74-L103"
    title: "orchestrator_report records a report and relays it atomically"
  - id: handback
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/executor.ts#L65-L73"
    title: "A worker hands back an out-of-scope message for fresh assessment"
  - id: route-tool
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/main.ts#L125-L129"
    title: "orchestrator_route decides up to 20 candidates per call"
  - id: im-words
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/text.ts#L1-L16"
    title: "IM replies are capped at 100 word-like segments"
  - id: outbox
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts#L26-L32"
    title: "The word cap applies to Feishu replies only"
  - id: assessment-outcome
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L34-L61"
    title: "Code re-validates the model's assessment: every rule, a match, intent evidence, auto mode for inferred"
  - id: eval-mode
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L83-L87"
    title: "Accept mode off, observe, or auto; default observe"
  - id: gate
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L189-L211"
    title: "Human gate: listed and addressed is explicit; table, follow-up, else refuse"
  - id: admission-defaults
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/admission.ts#L8-L13"
    title: "Admission cells and their defaults"
  - id: env-header
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/environment.ts#L1-L4"
    title: "Shims are default-path guardrails, not an OS security boundary"
  - id: env-strip
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/environment.ts#L41-L58"
    title: "Worker environment drops GitHub tokens, git overrides, askpass, and identity"
  - id: shims
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/environment.ts#L75-L116"
    title: "gh and lark-cli shims, blocked-command shims, and an isolated gitconfig with a CLI credential helper"
  - id: repo-guard
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/commands.ts#L94-L98"
    title: "Host GitHub calls are restricted to the configured repository"
  - id: settings-save
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/main.ts#L248-L265"
    title: "The main Session's settings tool accepts the policy block"
  - id: settings-guards
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/settings.ts#L32-L52"
    title: "Panel-only guards cover executor environment and source accounts, not policy"
  - id: http-origin
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/http.ts#L75-L79"
    title: "Management requests pass on loopback Host plus a constant header"
  - id: http-loopback
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/http.ts#L230-L231"
    title: "Management requires a loopback web server"
  - id: merge-prompt
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/prompts/team/delivery.md#L9-L16"
    title: "Auto-merge conditions are prompt text"
  - id: health-board
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/health.ts#L11-L35"
    title: "Component health is a single-writer registry"
  - id: limits
    resource: "https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/limits.ts#L1-L11"
    title: "Worker, Eval timeout, prompt, and admission-context bounds"
  - id: vision-exec
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/VISION.md#L78-L88"
    title: "The harness owns execution; authorization and approvals stay out of prompts"
  - id: vision-child
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/VISION.md#L125-L132"
    title: "Subagents are child Chats and child Runs, not a second session system"
  - id: vision-defer
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/VISION.md#L340-L349"
    title: "Child-agent orchestration and multi-channel bots are deferred"
  - id: spec-singleflight
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/SPEC.md#L94"
    title: "Per-chat single-flight permits one non-terminal Run"
  - id: spec-channel
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/SPEC.md#L413-L417"
    title: "No external messaging channel ships"
  - id: roadmap-b3
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/ROADMAP.md#L55-L61"
    title: "Bounded subagents follow tools, sessions, skills, and todos"
  - id: tool-truncation
    resource: "https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/openspec/specs/tool-calling/spec.md#L549-L552"
    title: "A truncation marker says narrowing the call recovers the content"
---

# DeepSeek Super-agent (dsh-superagent)

- **Stack:** TypeScript bundle for [DeepSeek Harness](./deepseek-harness.md); one SQLite state file; GitHub through `gh`, Feishu through `lark-cli`; MIT.[^readme-scope][^license]

**Status:** Source inspection of `6337fc823ce20251c8de8085948165c81aaa701e`. The program was not run. No model, GitHub account, or Feishu bot was configured. The article's figures were read as published and not reproduced. The article was read through the fxtwitter API because X blocks direct reads.[^article]

The article proposes a "Super-agent": one continuous agent that takes events from chat, GitHub, and other channels and runs many tasks at once. It names five modules: a two-level Router/Worker split, event Triggers, full-duplex multi-channel interaction, separation of compute, state, and execution environments, and a Watchdog. The prototype README says the code differs from the article and that some article designs are future directions.[^article][^readme-scope] The prototype is a proactive coding agent for one GitHub repository. It runs one long-lived main Session as the Router and one Session per work item ("Ticket") as the Worker, in one local process.[^master-id][^worker-id]

llame keeps Chat and Run identity, and VISION plans subagents as inspectable child Chats with child Runs rather than as a second session system.[^vision-child] Child-agent orchestration and multi-channel bots are deferred, and no external channel ships.[^vision-defer][^spec-channel] The findings below map mechanisms to those plans. They do not select one.

**Study**

1. **Article claims against shipped code.** Implemented: the Router/Worker split, Thread subscription with pass-through, batched delivery to the Router, capped context with read pointers, a code admission gate followed by a model assessment, and a 100-word IM cap. Partial: there is no generic asynchronous `start()`/`stop()` tool. Shell commands and job waits end after 5 s and continue as background jobs.[^worker-shell] Absent: no file under `src`, `docs`, or `prompts` names a watchdog or speculative execution. A single-writer health registry and effect retries are the only supervision.[^health-board] Execution is local: GitHub is polled, with no webhooks, and nothing implements cloud compute, endpoint daemons, or bring-your-own-machine placement.[^github-config][^github-poll] The article's Router has no Bash tool. The prototype's Router preset keeps `bash` with read-only file tools.[^router-preset]
2. **Delegation is enforced by structure. The model does not decide it.** The article's ablation ran about 300 group-chat and CI messages per run, about 20 of them work requests, with coding simulated by a tool that only waits. Five runs per design. The Router/Worker design finished tasks at 12.4 min p50 and 15.7 min p95. A single session with a subagent tool and a neutral prompt delegated in none of five runs and reached 29.5 min p95. A delegation-first prompt delegated in four of five, and the fifth run did the work itself and produced the long tail. Removing pass-through left completion time about the same, but raised Router decisions by about 30% and cache-read tokens from 23.2M to 31.8M.[^article] In code, the Router routes up to 20 candidates per call (accept, attach, stop, or ignore). Workers report through `orchestrator_report`, which records the report and queues its relay in one transaction. A Worker hands an out-of-scope message back for fresh assessment.[^route-tool][^report-tool][^handback] The Router may not sleep, run a command past 30 s, or wait on a job past 5 s.[^router-nowait] Moderate confidence for [#765](https://github.com/leon0399/llame/issues/765): a structural rule for whether to delegate removes the prompt-dependent variance the ablation shows. The measurement is synthetic and small. Under VISION, the Router role would be a parent Run dispatching child Runs, not a hidden session.[^vision-child][^roadmap-b3]
3. **Events that arrive during a turn reach the next step together.** A Thread holds at most one Eval. Triggers that arrive meanwhile wait in a debounce buffer and become one batch under the strongest admissible gate result.[^thread-aggregate][^evals-batch] Relays to the Router are ordered effects delivered with `agent.steer`, deduplicated by request id against the session.[^relay-steer][^delivery-steer] The article's stress test raised decision-needing Triggers from about 1 to 40 per minute. Average batch size rose from 1.0 to 2.8, time per request from 2.5 s to 3.9 s, and amortized time per decision fell from 6.4 s to 1.6 s.[^article] High confidence for [#782](https://github.com/leon0399/llame/issues/782): steering delivers queued messages at the next model step rather than starting a new Run. llame's per-chat single-flight answers a second message with 409 today, so steering is a change to that contract.[^spec-singleflight]
4. **Long commands move to the background and wake their owner.** Worker foreground shell commands and job waits end after 5 s, and a job's end wakes the Worker with its result.[^worker-shell] Background work may run 30 minutes after a Worker turn ends. Past that limit its jobs are killed and the Worker is told at its next turn.[^bg-const][^bg-kill] High confidence for [#1051](https://github.com/leon0399/llame/issues/1051): these are concrete bounds for background bash with job handles, including notifying the owner on completion and a hard limit on how long work may outlive a turn.
5. **Context is capped text plus a pointer, over a graph of stable ids.** Worker messages carry assignment text up to 1500 characters and Trigger text up to 600. Longer text becomes a preview with its length and a `read` resource.[^caps] `orchestrator_read` serves tickets, triggers, threads, decisions, reports, and Worker transcripts by id. Text pages default to 4000 characters and lists to 20 items.[^resources][^resource-page] The article calls this Inline & Spill, and recall by following ids from one object to the next Chain of Recall.[^article] llame truncation tells the model that narrowing the call's arguments recovers the omitted content, and it stores no re-readable copy.[^tool-truncation] Moderate confidence for [#915](https://github.com/leon0399/llame/issues/915), [#1503](https://github.com/leon0399/llame/issues/1503), and [#194](https://github.com/leon0399/llame/issues/194): a recorded result with a stable locator, plus ids on tool results and Runs, would give recall something to follow after compaction.
6. **Admission is a fail-closed code gate. The model's verdict is checked again in code.** A Thread key is `source:id`, and Trigger text and metadata are typed as untrusted.[^thread-key][^trigger-untrusted] Intake drops duplicates, records filtered Triggers, and fans a Trigger out to subscribed tickets. Only Triggers no Ticket owns go to an Eval.[^intake] For a human sender, a listed sender who addresses the agent is `explicit`. Otherwise a per-scope admission cell, then a Thread follow-up rule, decides. Anything left is refused with a reason.[^gate] Default cells make an unaddressed listed sender `inferred` and ignore every unlisted sender.[^admission-defaults] The accept mode is `off`, `observe`, or `auto`, default `observe`.[^eval-mode] Code rejects an assessment that does not judge every enabled rule exactly once. It ignores one that settles no direction or matches no rule. An accept without intent evidence throws. An inferred accept outside `auto` is recorded as `would_accept` and starts no work.[^assessment-outcome] An Eval that times out requeues twice, then records `unavailable`.[^evals-expire] High confidence for [#42](https://github.com/leon0399/llame/issues/42): the observe mode and the code re-check of a model decision fit VISION's rule that authorization does not live in prompts.[^vision-exec]
7. **Credentials stay behind account wrappers.** Worker environments drop `GH_TOKEN`, `GITHUB_TOKEN`, git location and config overrides, askpass, and commit identity.[^env-strip] `gh` and `lark-cli` are shims to the deployment's account CLIs. Blocked commands are shims that fail. git uses an isolated config whose credential helper is the account CLI.[^shims] Host GitHub calls are path-guarded to the one repository.[^repo-guard] The file header calls these default-path guardrails and says they are not an OS security boundary.[^env-header] Moderate confidence: this is a pattern for authenticated git and `gh` writes from llame host `bash` without exposing a token to the model.
8. **Reply norms are the product.** The philosophy is to take as little human attention as possible. The agent acts only when asked or when a written rule allows it. It acknowledges once, stays quiet while working, and writes again for a result, a decision, or a failure. It asks one concrete question at a time and stops at a design decision.[^philosophy] Code caps IM replies at 100 word-like segments, counted with a Chinese word segmenter, and applies the cap to Feishu replies only. GitHub comments have no cap.[^im-words][^outbox] Ticket stage is derived. A ticket that needs a person sorts first.[^stage]

**Caution**

The Router can rewrite its own authorization. `orchestrator_settings_save` accepts the `policy` block, which holds allowlists, admission cells, and accept mode. Only its description says it must act on an explicit human request.[^settings-save] Panel-only guards protect the executor environment and source accounts, not policy.[^settings-guards] A prompt-injected comment that persuades the Router to add a sender is therefore an authorization change with no code check. The management API accepts a request with a loopback `Host`, the constant header `x-orchestrator-request: 1`, and no foreign `Origin`, so a Worker shell on the same host can call it.[^http-origin][^http-loopback] Both roles run with `danger-full-access`.[^danger] Auto-merge limits are prompt text.[^merge-prompt] There is no cost or token budget. The bounds cover worker count, Eval timeout, prompt size, and admission-context reads.[^limits] The article's "one continuous entity" shares one context across everyone it serves. In llame that context would be per owner, and work across owners is the agent-to-agent problem the article leaves open.[^article] The README calls the code a research prototype.[^readme-scope]

[^article]: [Exploring Super-agent Design: Towards a More Autonomous Agent System (machine-translated X article, 2026-11-01)](https://x.com/DeepSeekHarness/status/2116857257245987236)

[^readme-scope]: [Research prototype that differs from the article; one repository, GitHub and optional Feishu](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md#L3-L7)

[^license]: [MIT License](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/LICENSE#L1-L3)

[^philosophy]: [Act when asked or allowed by a rule; speak only when a person must act](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md#L11-L15)

[^master-id]: [One persisted main Session id per state directory](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/runtime.ts#L104-L105)

[^worker-id]: [Worker Session id is `worker-<ticketId>`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L23-L26)

[^thread-key]: [Thread key is source:id](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L12)

[^trigger-untrusted]: [Trigger text and meta are untrusted external data](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L22)

[^thread-aggregate]: [Thread holds subscriptions, context followers, a debounce buffer, and at most one Eval](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L156-L177)

[^stage]: [Ticket stage is derived: person, working, idle, or ended](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/stage.ts#L4-L21)

[^intake]: [Intake dedupes, filters by scope, and fans a Trigger out to subscribed tickets](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts#L19-L52)

[^evals-batch]: [One Eval batches a Thread's pending Triggers under the strongest gate result](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts#L94-L119)

[^evals-expire]: [An expired Eval requeues twice, then records unavailable](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts#L56-L69)

[^relay-steer]: [Relays reach the main Session in order as steer messages](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L103-L105)

[^delivery-steer]: [Delivery dedupes by request id and steers, follows up, or injects](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/delivery.ts#L73-L82)

[^router-nowait]: [The main Session may not sleep, run long commands, or wait on jobs](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L74-L86)

[^danger]: [Both roles run with danger-full-access](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L152)

[^caps]: [Assignment and trigger caps with a read resource for the rest](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L112-L128)

[^resources]: [orchestrator_read resource graph over tickets, triggers, threads, decisions, and transcripts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/resources.ts#L23-L40)

[^resource-page]: [Text pages default to 4000 characters; lists to 20 items](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/resources.ts#L87-L92)

[^github-config]: [GitHub poll interval 60-3600 s, default 60; observation switches default off](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/github.ts#L25-L28)

[^github-poll]: [GitHub ingestion is a polling loop](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/github.ts#L127-L146)

[^worker-shell]: [Worker foreground shell and job waits end after 5 s](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/cordis.patch.yml#L44-L74)

[^router-preset]: [Router preset keeps bash and read-only fs with the same 5 s caps](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/cordis.patch.yml#L121-L172)

[^bg-const]: [Background work may run 30 minutes after a worker turn](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L31-L32)

[^bg-kill]: [Jobs past the limit are killed and the worker is told](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts#L629-L656)

[^report-tool]: [orchestrator_report records a report and relays it atomically](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/executor.ts#L74-L103)

[^handback]: [A worker hands back an out-of-scope message for fresh assessment](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/executor.ts#L65-L73)

[^route-tool]: [orchestrator_route decides up to 20 candidates per call](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/main.ts#L125-L129)

[^im-words]: [IM replies are capped at 100 word-like segments](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/text.ts#L1-L16)

[^outbox]: [The word cap applies to Feishu replies only](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts#L26-L32)

[^assessment-outcome]: [Code re-validates the model's assessment: every rule, a match, intent evidence, auto mode for inferred](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L34-L61)

[^eval-mode]: [Accept mode off, observe, or auto; default observe](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L83-L87)

[^gate]: [Human gate: listed and addressed is explicit; table, follow-up, else refuse](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L189-L211)

[^admission-defaults]: [Admission cells and their defaults](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/admission.ts#L8-L13)

[^env-header]: [Shims are default-path guardrails, not an OS security boundary](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/environment.ts#L1-L4)

[^env-strip]: [Worker environment drops GitHub tokens, git overrides, askpass, and identity](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/environment.ts#L41-L58)

[^shims]: [gh and lark-cli shims, blocked-command shims, and an isolated gitconfig with a CLI credential helper](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/environment.ts#L75-L116)

[^repo-guard]: [Host GitHub calls are restricted to the configured repository](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/commands.ts#L94-L98)

[^settings-save]: [The main Session's settings tool accepts the policy block](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/main.ts#L248-L265)

[^settings-guards]: [Panel-only guards cover executor environment and source accounts, not policy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/settings.ts#L32-L52)

[^http-origin]: [Management requests pass on loopback Host plus a constant header](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/http.ts#L75-L79)

[^http-loopback]: [Management requires a loopback web server](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/http.ts#L230-L231)

[^merge-prompt]: [Auto-merge conditions are prompt text](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/prompts/team/delivery.md#L9-L16)

[^health-board]: [Component health is a single-writer registry](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/health.ts#L11-L35)

[^limits]: [Worker, Eval timeout, prompt, and admission-context bounds](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/limits.ts#L1-L11)

[^vision-exec]: [The harness owns execution; authorization and approvals stay out of prompts](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/VISION.md#L78-L88)

[^vision-child]: [Subagents are child Chats and child Runs, not a second session system](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/VISION.md#L125-L132)

[^vision-defer]: [Child-agent orchestration and multi-channel bots are deferred](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/VISION.md#L340-L349)

[^spec-singleflight]: [Per-chat single-flight permits one non-terminal Run](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/SPEC.md#L94)

[^spec-channel]: [No external messaging channel ships](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/SPEC.md#L413-L417)

[^roadmap-b3]: [Bounded subagents follow tools, sessions, skills, and todos](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/ROADMAP.md#L55-L61)

[^tool-truncation]: [A truncation marker says narrowing the call recovers the content](https://github.com/leon0399/llame/blob/64db12c9006d74462e5d63f362901fb08050664f/openspec/specs/tool-calling/spec.md#L549-L552)
