---
type: Reference
title: "openfabriq"
description: "Apache-2.0 engine that runs Claude Code agents on one GitHub repository from an applied folder of agents and automations; agents propose typed outputs, and the engine runs the checks and writes only what each automation's `can` allows."
resource: "https://github.com/openfabriq/openfabriq"
tags:
  [harness, software-factory, claude-code, github, automation, output-authority]
status: draft
generated:
  by: "omp/claude-opus-5-5"
  at: "2026-11-18"
observed:
  date: "2026-11-18"
  revision: "2a183bf053a27d52bf9fc733a2db6159773325df"
sources:
  - id: of-sdk
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/package.json#L9"
    title: "Runner depends on @anthropic-ai/claude-agent-sdk 0.3.318"
  - id: of-readme-status
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/README.md#L239"
    title: "0.1.0 is the first public release"
  - id: of-license
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/LICENSE#L1-L3"
    title: "Apache License 2.0"
  - id: of-cla
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/CLA.md#L1-L5"
    title: "The CLA lets the maintainer relicense contributions"
  - id: of-readme-flow
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/README.md#L161-L171"
    title: "Engine flow and the stated guarantees"
  - id: llame-vision-execution
    resource: "https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L78-L88"
    title: "The harness owns execution"
  - id: of-write-applied
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/state/projects.ts#L104-L131"
    title: "apply writes the folder through a staging copy and records a fingerprint"
  - id: of-poll-applied
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/engine.ts#L108-L112"
    title: "Each poll loads the applied copy"
  - id: of-merge-locked
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/merge.ts#L43-L44"
    title: "Merge never brings in CI workflows or the factory folder"
  - id: of-load-errors
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/load.ts#L139-L145"
    title: "Any validation error yields no factory"
  - id: llame-vision-profile
    resource: "https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L273-L279"
    title: "Tool authorization stays control-plane state outside profile files"
  - id: of-output-tools
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/tools.ts#L182-L190"
    title: "Only output tools allowed by can are registered"
  - id: of-can-refuse
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L82-L86"
    title: "A proposal not in can is refused"
  - id: of-per-run
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L34-L42"
    title: "Per-run write caps"
  - id: of-agent-env
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/env.ts#L37-L44"
    title: "Empty gh config and null git configuration for the agent"
  - id: of-secret-paths
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/sandbox.ts#L50-L60"
    title: "Paths no command of a run reads"
  - id: of-hardened-git
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/workspace/hardened-git.ts#L8-L18"
    title: "Engine git commands ignore hooks, fsmonitor and replaced objects"
  - id: llame-vision-credentials
    resource: "https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L242-L246"
    title: "Executors receive proxied operations, not upstream secrets"
  - id: of-check-gate
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L186-L192"
    title: "A failed check refuses every code proposal"
  - id: of-check-rounds
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/harness.ts#L34-L35"
    title: "Two fix rounds when a check fails at the agent stop"
  - id: of-workflow-lock
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L158-L166"
    title: "Commits under .github/workflows/ are refused"
  - id: of-workflow-doc
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/docs/content/docs/factory/workflow.mdx#L50-L63"
    title: "What starts what; comments start nothing"
  - id: of-self-trigger
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/automation-rules.ts#L17-L40"
    title: "Validation refuses an automation whose own output starts it again"
  - id: of-timeline-skip
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/timeline.ts#L70-L72"
    title: "Comments carrying the mark start nothing"
  - id: of-marker
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/markers.ts#L35-L36"
    title: "The engine mark is a substring test"
  - id: of-sdlc
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/examples/02-sdlc/README.md#L7"
    title: "02-sdlc follows Warp's example without a foreman"
  - id: of-verdicts
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/internal-review.ts#L20-L25"
    title: "Internal review verdicts"
  - id: of-reviewer-edit
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/load.ts#L119-L125"
    title: "A reviewer with the edit tool fails validation"
  - id: of-review-rounds
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L197-L207"
    title: "review_rounds reached hands the subject to a person"
  - id: of-match-gate
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/match.ts#L125-L150"
    title: "Only maintainers start GitHub-triggered automations unless from: anyone"
  - id: of-trusted
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/match.ts#L183-L192"
    title: "Sentry, webhooks and strangers start untrusted runs"
  - id: of-subject-fields
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/gh.ts#L58"
    title: "The subject includes every comment"
  - id: of-data-frame
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/prompt.ts#L169-L172"
    title: "Event content is framed as escaped JSON data"
  - id: of-interval
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/engine.ts#L229-L236"
    title: "Polling every 60 seconds; the relay starts only when an automation uses it"
  - id: of-open-issues
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/gh.ts#L139-L142"
    title: "Issue polling asks for open issues updated since the cursor"
  - id: of-first-cursor
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/poll.ts#L68-L78"
    title: "The first poll records state and starts nothing"
  - id: of-max-runs
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/engine.ts#L50"
    title: "Four concurrent runs by default"
  - id: of-recovery
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/scheduler.ts#L82-L94"
    title: "A run that already applied an output is not queued again"
  - id: of-failed-applies
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L302-L304"
    title: "A failed run still has its proposals checked and applied"
  - id: of-cleanup
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L411-L416"
    title: "The working label and worktree are removed in finally"
  - id: of-budget
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/claude.ts#L285"
    title: "usd_per_run is passed as maxBudgetUsd"
  - id: of-unknown-cost
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/claude.ts#L321-L322"
    title: "A session that reached the model with no result is charged its whole budget"
  - id: of-daily-limit
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L177-L184"
    title: "usd_per_day is checked when a run starts"
  - id: of-cost-today
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/state/journal.ts#L177-L183"
    title: "Daily cost sums the journal and counts a missing cost as zero"
  - id: of-reviewer-budget
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/internal-review.ts#L303-L304"
    title: "Each review round gets the run budget minus earlier review spend"
  - id: of-limits
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/schema.ts#L53-L62"
    title: "Maintainers are required; limits default to 5 USD, 30 USD, 45 minutes, 3 review rounds"
  - id: of-locked-down
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/locked-down.ts#L32-L47"
    title: "Project settings only, hooks off, dontAsk, strict MCP config"
  - id: of-sandbox
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/sandbox.ts#L337-L357"
    title: "Agent shell sandbox fails if unavailable and uses a strict network allowlist"
  - id: of-cmd-sandbox
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/workspace/sandboxed-commands.ts#L266-L271"
    title: "Engine commands fail when their sandbox cannot start"
  - id: of-env-names
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/env.ts#L4-L9"
    title: "Name patterns stripped from the agent environment"
  - id: of-security-limits
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/docs/content/docs/reference/security.mdx#L39-L58"
    title: "Known limits of the security model"
  - id: of-tuner
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/examples/17-factory-tuner/openfabriq/agents/tuner/agent.md#L13-L19"
    title: "The tuner may edit only bodies and skills"
  - id: llame-vision-later
    resource: "https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L309-L324"
    title: "Later horizons: workflows, child agents, harness adapters"
  - id: llame-vision-runs
    resource: "https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L119-L139"
    title: "Runs are the unit of execution; peer agents stay adapters"
  - id: of-studio-github
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/studio/src/access/github.ts#L47-L56"
    title: "GitHub sign-in checks write permission across every applied repository"
  - id: of-relay-retention
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/relay/src/relay.ts#L15-L28"
    title: "Relay keeps events 7 days, up to 10,000 events or 100 MiB"
  - id: of-studio-bind
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/studio/src/server.ts#L215"
    title: "The studio listens on 127.0.0.1"
  - id: of-readme-team
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/README.md#L208-L214"
    title: "Team deployment, one engine per factory, Claude Code only"
---

# openfabriq

- **Stack:** TypeScript on Node 24, a pnpm workspace with `core`, `runner`, `relay`, `studio`, `cli` and `docs` packages. The runner drives Claude Code through `@anthropic-ai/claude-agent-sdk` `0.3.318`.[^of-sdk] Tag `v0.1.6`; the README calls 0.1.0 the first public release.[^of-readme-status] **License:** Apache-2.0.[^of-license] The CLA lets the maintainer distribute contributions under another license later.[^of-cla]

**Status:** source and documentation reading at the pinned revision. Nothing was installed or run, and no run, budget, sandbox or relay behavior was exercised. The repository is two days old at inspection and has one maintainer; its own factory opened two of its merged pull requests.

openfabriq calls itself "your AI software factory, as code". A factory is an `openfabriq/` folder in one GitHub repository: `factory.yaml` names the repository, the maintainers whose actions start runs, the setup and check commands, the network, and spending limits; `agents/<name>/agent.md` is a role prompt with a tool list; `automations/<name>/automation.md` binds a trigger to one agent and lists what the engine may write for it (`can`). The engine runs on one machine or server, polls GitHub with `gh`, starts Claude Code in a fresh worktree per run, then runs the checks and applies only the outputs `can` allows.[^of-readme-flow] llame's [VISION](../../../VISION.md) already states the same authority split ("the model proposes tool calls", the harness executes and records),[^llame-vision-execution] so this entry is relevant mainly for how openfabriq makes that split concrete for unattended, event-started work. The wider software-factory comparison is in the [software-factory study](../product-vision/2026-11-18-software-factory-as-code.md).

**Study**

1. **The rules that judge a change are an applied copy, never the branch.** `openfabriq apply` writes the folder to `~/.openfabriq/projects/<owner>/<repo>/factory/` through a `factory.new` staging folder, then records a fingerprint in `state.json`.[^of-write-applied] Each poll loads that copy,[^of-poll-applied] so a pull request that edits `openfabriq/` changes nothing until a person merges it and applies it again, and merge never brings in `openfabriq/**` or `.github/workflows/**` by itself.[^of-merge-locked] `plan` lists security changes first (new commands, maintainers, tools, `can` rights, network sites). Any validation error yields no factory at all, and the engine runs nothing for that repository.[^of-load-errors] The swap is `rm` then `rename`, so a crash between them also leaves no factory: closed, not atomic. High confidence for [#976](https://github.com/leon0399/llame/issues/976): repository-carried configuration can be versioned in the repository and still stay control-plane state, as VISION requires for tool authorization,[^llame-vision-profile] if the control plane activates only an explicitly applied, fingerprinted snapshot and shows its security diff first.
2. **Agents propose typed outputs; the engine writes.** Output tools are an in-process MCP server named `openfabriq`. Only the tools whose action `can` lists and that fit the subject are registered,[^of-output-tools] and `reviewProposals` refuses any proposal whose action is not in `can` anyway.[^of-can-refuse] Per-run caps apply regardless of `can`: 5 issues, 10 comments, 3 change requests, 5 label additions and removals, one close.[^of-per-run] The agent environment gets an empty `GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL=/dev/null`, and a null `GIT_SSH_COMMAND`,[^of-agent-env] and the sandbox denies `~/.ssh`, `~/.config/gh`, `~/.aws`, the Claude credentials file and the macOS keychains.[^of-secret-paths] Engine git commands disable hooks, fsmonitor and replaced objects because the agent can write the shared `.git`.[^of-hardened-git] This is the same shape as GitHub Agentic Workflows' safe outputs (see the study). High confidence for [#995](https://github.com/leon0399/llame/issues/995) and any later GitHub write adapter: forge writes belong to a trusted tool that receives a structured proposal, which matches VISION's proxied-operation rule for executors.[^llame-vision-credentials]
3. **The engine runs the checks, not the agent.** A failed check refuses every code proposal and the comments and labels that accompany it.[^of-check-gate] Before that, the agent's `Stop` hook runs the checks itself and gives the agent two fix rounds.[^of-check-rounds] Commits whose paths start with `.github/workflows/` are refused.[^of-workflow-lock] The lock is that one prefix: composite actions under `.github/actions/`, `CODEOWNERS` and package scripts that CI runs are not covered. Moderate confidence for [#765](https://github.com/leon0399/llame/issues/765): a parent or harness should accept a child's code result only after harness-run verification, the acceptance gate that [Baro](./baro.md) and [oh-my-openagent](./oh-my-openagent.md) also use.
4. **Stages hand off through the forge, not through an orchestrator.** An applied write becomes the next poll's event: a label starts `issue.labeled` automations, a pull request starts `pull_request.opened`, and comments start nothing.[^of-workflow-doc] Validation refuses an automation whose own output would start it again,[^of-self-trigger] and comments that carry the engine's HTML mark are skipped.[^of-timeline-skip] The mark test is a substring check with no author check,[^of-marker] so anyone can paste it to make the engine ignore a comment; the effect is suppression only. The validator is per automation, so a cycle across two automations with disjoint label filters is not rejected; daily cost and review rounds stop it. The `02-sdlc` template says it follows Warp's software-factory example without Warp's foreman agent.[^of-sdlc]
5. **The one in-run loop is `reviewed_by`.** A reviewer agent reads the change in the same checkout before anything leaves the machine and answers `approved`, `needs_changes` or `needs_human`.[^of-verdicts] A reviewer with the `edit` tool fails validation.[^of-reviewer-edit] `needs_changes` within `review_rounds` returns to the author; a later GitHub change request past `review_rounds` hands the subject to a person with a `needs-human` label.[^of-review-rounds] The engine adds `needs-human` and never removes it.
6. **Who may start a run is a property of the event source.** For GitHub events the actor must be a maintainer or the engine's own account, unless the automation says `from: anyone`; default-branch commits and every non-GitHub source (Slack, Linear, Sentry, webhooks) always count.[^of-match-gate] Sentry, webhook and stranger-started runs are untrusted: their commands run without factory secrets, they never merge, and only automations marked `from: factory` that write no code may continue from their writes.[^of-trusted] Every comment on the subject still reaches the agent, including comments from strangers on a public repository.[^of-subject-fields] Event content is framed as escaped JSON inside `<github-data>` with an instruction to treat it as data;[^of-data-frame] the hard limit is the capability set, not the framing. Moderate confidence for [#778](https://github.com/leon0399/llame/issues/778) and [#1488](https://github.com/leon0399/llame/issues/1488): a Run started by an external event needs a provenance-derived trust level that narrows its tools and secrets, separate from the owner's per-Run permission mode.
7. **Durability is files and a journal.** State is JSON and JSONL under `~/.openfabriq/projects/<owner>/<repo>/`. GitHub is polled every 60 seconds by default,[^of-interval] issues are read with `state=open` since a cursor,[^of-open-issues] and the first poll records state and starts nothing.[^of-first-cursor] At most four runs execute at once by default.[^of-max-runs] After a crash, an interrupted run is queued once more, except a run whose journal already shows an applied output, which would write twice.[^of-recovery] There is no idempotency key on GitHub writes, and comments and labels are journaled only after `applyOutputs` returns, so a crash mid-apply can repeat one. A failed run still has its non-code proposals applied.[^of-failed-applies] The working label and worktree are removed in `finally`.[^of-cleanup] llame's pg-boss Runs and fenced effects are stronger here; nothing to adopt.
8. **Budgets are per-run SDK caps plus a start-time daily check.** `usd_per_run` is passed as the SDK's `maxBudgetUsd`,[^of-budget] and a session that reached the model but returned no result is charged its whole budget.[^of-unknown-cost] `usd_per_day` is checked only when a run starts,[^of-daily-limit] from a journal sum that counts a missing cost as zero,[^of-cost-today] so four concurrent runs can each start under the limit and finish over it. Each internal-review round gets `usd_per_run` minus earlier review spend, not minus the author's spend,[^of-reviewer-budget] so one run can cost about twice `usd_per_run`. Defaults are 5 USD per run, 30 per day, 45 minutes and 3 review rounds.[^of-limits] High confidence for [#1758](https://github.com/leon0399/llame/issues/1758) and [#1764](https://github.com/leon0399/llame/issues/1764): a tree budget must reserve before start or settle mid-run; a check at start alone fails open under concurrency.
9. **Claude Code is locked down per run.** The SDK options load project settings only, disable all hooks, use `permissionMode: "dontAsk"`, and allow only the engine's and factory's MCP servers; callers cannot override those keys.[^of-locked-down] The agent shell uses Claude Code's sandbox with `failIfUnavailable` and no unsandboxed escape, and with a strict domain allowlist unless the network is `any`.[^of-sandbox] Engine commands run in a separate sandbox that fails when it cannot start.[^of-cmd-sandbox] Environment scrubbing is a name deny-list,[^of-env-names] so a credential under an unrecognized name, such as `NPM_CONFIG__AUTH`, passes. The docs list the remaining limits: any listed site is an exfiltration path, remote MCP servers are outside `network`, the home folder stays readable, and MCP secrets appear in process command lines.[^of-security-limits]
10. **Self-improvement is a human-gated pull request.** The `17-factory-tuner` template runs a weekly agent that reads 28 days of the factory's pull requests and hand-offs and opens one pull request of at most 60 lines on one agent brief, automation prompt or skill. Its brief forbids headers, `factory.yaml`, scripts and its own brief;[^of-tuner] that restriction is prompt-only, and the enforced parts are the `validate` check, the merge lock on `openfabriq/**`, and a person running `plan` and `apply`. Moderate confidence for VISION's agent-editable configuration: an agent may propose changes to its own instructions when the rights they carry change only through a separate applied step.[^llame-vision-later]

**llame fit**

- High: items 1 and 2 as the authority pattern for any event-started or unattended Run: an owner-applied, fingerprinted rule snapshot, and a trusted writer that applies typed proposals. Both fit the harness-owns-execution principle without new authority in the model.[^llame-vision-execution]
- Moderate: item 3's harness-run acceptance check for child or background code work, and item 6's provenance-derived trust level for externally started Runs.
- Moderate: item 8's failure modes as negative requirements for llame's budget design.
- Low: items 4 and 7. Forge-label handoff and file-journal state fit a single-repository tool; llame owns Chat and Run identity in Postgres, and an orchestration that lives in GitHub labels would make GitHub a second state owner.[^llame-vision-runs]
- Avoid: an engine-wide `gh` login or one studio session across all repositories. Studio GitHub sign-in accepts a writer of any applied repository and grants access to every project's runs.[^of-studio-github]

**Caution:** one engine serves every factory on its machine, and factories share its environment;[^of-security-limits] that is a single trust domain, not owner isolation. In local mode the engine writes with the user's own `gh` login. The relay stores event bodies and integration tokens for up to 7 days.[^of-relay-retention] The studio listens on `127.0.0.1`.[^of-studio-bind] Only Claude Code is supported; Codex is announced.[^of-readme-team] The project is young, and its safety claims are read from code and comments, several of which say the sandbox behavior was measured; none of it was reproduced here.

[^of-sdk]: [Runner depends on @anthropic-ai/claude-agent-sdk 0.3.318](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/package.json#L9)

[^of-readme-status]: [0.1.0 is the first public release](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/README.md#L239)

[^of-license]: [Apache License 2.0](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/LICENSE#L1-L3)

[^of-cla]: [The CLA lets the maintainer relicense contributions](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/CLA.md#L1-L5)

[^of-readme-flow]: [Engine flow and the stated guarantees](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/README.md#L161-L171)

[^llame-vision-execution]: [The harness owns execution](https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L78-L88)

[^of-write-applied]: [apply writes the folder through a staging copy and records a fingerprint](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/state/projects.ts#L104-L131)

[^of-poll-applied]: [Each poll loads the applied copy](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/engine.ts#L108-L112)

[^of-merge-locked]: [Merge never brings in CI workflows or the factory folder](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/merge.ts#L43-L44)

[^of-load-errors]: [Any validation error yields no factory](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/load.ts#L139-L145)

[^llame-vision-profile]: [Tool authorization stays control-plane state outside profile files](https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L273-L279)

[^of-output-tools]: [Only output tools allowed by can are registered](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/tools.ts#L182-L190)

[^of-can-refuse]: [A proposal not in can is refused](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L82-L86)

[^of-per-run]: [Per-run write caps](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L34-L42)

[^of-agent-env]: [Empty gh config and null git configuration for the agent](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/env.ts#L37-L44)

[^of-secret-paths]: [Paths no command of a run reads](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/sandbox.ts#L50-L60)

[^of-hardened-git]: [Engine git commands ignore hooks, fsmonitor and replaced objects](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/workspace/hardened-git.ts#L8-L18)

[^llame-vision-credentials]: [Executors receive proxied operations, not upstream secrets](https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L242-L246)

[^of-check-gate]: [A failed check refuses every code proposal](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L186-L192)

[^of-check-rounds]: [Two fix rounds when a check fails at the agent stop](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/harness.ts#L34-L35)

[^of-workflow-lock]: [Commits under .github/workflows/ are refused](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/outputs/review.ts#L158-L166)

[^of-workflow-doc]: [What starts what; comments start nothing](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/docs/content/docs/factory/workflow.mdx#L50-L63)

[^of-self-trigger]: [Validation refuses an automation whose own output starts it again](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/automation-rules.ts#L17-L40)

[^of-timeline-skip]: [Comments carrying the mark start nothing](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/timeline.ts#L70-L72)

[^of-marker]: [The engine mark is a substring test](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/markers.ts#L35-L36)

[^of-sdlc]: [02-sdlc follows Warp's example without a foreman](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/examples/02-sdlc/README.md#L7)

[^of-verdicts]: [Internal review verdicts](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/internal-review.ts#L20-L25)

[^of-reviewer-edit]: [A reviewer with the edit tool fails validation](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/load.ts#L119-L125)

[^of-review-rounds]: [review_rounds reached hands the subject to a person](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L197-L207)

[^of-match-gate]: [Only maintainers start GitHub-triggered automations unless from: anyone](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/match.ts#L125-L150)

[^of-trusted]: [Sentry, webhooks and strangers start untrusted runs](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/match.ts#L183-L192)

[^of-subject-fields]: [The subject includes every comment](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/gh.ts#L58)

[^of-data-frame]: [Event content is framed as escaped JSON data](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/prompt.ts#L169-L172)

[^of-interval]: [Polling every 60 seconds; the relay starts only when an automation uses it](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/engine.ts#L229-L236)

[^of-open-issues]: [Issue polling asks for open issues updated since the cursor](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/gh.ts#L139-L142)

[^of-first-cursor]: [The first poll records state and starts nothing](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/github/poll.ts#L68-L78)

[^of-max-runs]: [Four concurrent runs by default](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/engine.ts#L50)

[^of-recovery]: [A run that already applied an output is not queued again](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/engine/scheduler.ts#L82-L94)

[^of-failed-applies]: [A failed run still has its proposals checked and applied](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L302-L304)

[^of-cleanup]: [The working label and worktree are removed in finally](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L411-L416)

[^of-budget]: [usd_per_run is passed as maxBudgetUsd](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/claude.ts#L285)

[^of-unknown-cost]: [A session that reached the model with no result is charged its whole budget](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/claude.ts#L321-L322)

[^of-daily-limit]: [usd_per_day is checked when a run starts](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/execute.ts#L177-L184)

[^of-cost-today]: [Daily cost sums the journal and counts a missing cost as zero](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/state/journal.ts#L177-L183)

[^of-reviewer-budget]: [Each review round gets the run budget minus earlier review spend](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/run/internal-review.ts#L303-L304)

[^of-limits]: [Maintainers are required; limits default to 5 USD, 30 USD, 45 minutes, 3 review rounds](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/schema.ts#L53-L62)

[^of-locked-down]: [Project settings only, hooks off, dontAsk, strict MCP config](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/locked-down.ts#L32-L47)

[^of-sandbox]: [Agent shell sandbox fails if unavailable and uses a strict network allowlist](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/agent/sandbox.ts#L337-L357)

[^of-cmd-sandbox]: [Engine commands fail when their sandbox cannot start](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/runner/src/workspace/sandboxed-commands.ts#L266-L271)

[^of-env-names]: [Name patterns stripped from the agent environment](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/core/src/factory/env.ts#L4-L9)

[^of-security-limits]: [Known limits of the security model](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/docs/content/docs/reference/security.mdx#L39-L58)

[^of-tuner]: [The tuner may edit only bodies and skills](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/examples/17-factory-tuner/openfabriq/agents/tuner/agent.md#L13-L19)

[^llame-vision-later]: [Later horizons: workflows, child agents, harness adapters](https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L309-L324)

[^llame-vision-runs]: [Runs are the unit of execution; peer agents stay adapters](https://github.com/leon0399/llame/blob/9423a655bf599cb23307c0b51a2cd2cc952bf58e/VISION.md#L119-L139)

[^of-studio-github]: [GitHub sign-in checks write permission across every applied repository](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/studio/src/access/github.ts#L47-L56)

[^of-relay-retention]: [Relay keeps events 7 days, up to 10,000 events or 100 MiB](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/relay/src/relay.ts#L15-L28)

[^of-studio-bind]: [The studio listens on 127.0.0.1](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/studio/src/server.ts#L215)

[^of-readme-team]: [Team deployment, one engine per factory, Claude Code only](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/README.md#L208-L214)
