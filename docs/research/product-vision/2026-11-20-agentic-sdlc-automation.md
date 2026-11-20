---
type: Research
title: "Agentic SDLC automation: issues, runs, claims and pull requests"
description: "Reads vendor issue-to-PR agents, spec-driven frameworks, factory engines and GitHub platform mechanics, then states what each source says about units of work, triggers, claims, stacks and human handoff, and what that implies for llame."
tags:
  [
    product-vision,
    agentic-sdlc,
    github,
    triggers,
    claims,
    stacked-pull-requests,
    spec-driven,
  ]
status: draft
generated:
  by: "omp/deepseek-v4.1-flash"
  at: "2026-11-20"
observed:
  date: "2026-11-20"
sources:
  - id: copilot-kickoff
    resource: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task"
    title: "Starting a task with Copilot cloud agent: assignment always creates a pull request"
  - id: copilot-automations
    resource: "https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations"
    title: "Creating Copilot automations: triggers, actor filters, app-event filtering, write scope"
  - id: copilot-concepts
    resource: "https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/about-automations"
    title: "Automation concepts: personal and shared identity, billing, cost caps"
  - id: copilot-risks
    resource: "https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations"
    title: "Copilot cloud agent risks: one branch, one pull request, no self-approval"
  - id: copilot-issues
    resource: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/copilot-for-github-tasks/use-copilot-to-create-or-update-issues"
    title: "Copilot authors a parent issue with sub-issues"
  - id: agent-hq
    resource: "https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/"
    title: "Agent HQ: several agents assigned to one issue"
  - id: codex-github
    resource: "https://learn.chatgpt.com/docs/third-party/github.md"
    title: "Codex on GitHub: review mentions, automatic review toggle"
  - id: codex-linear
    resource: "https://learn.chatgpt.com/docs/third-party/linear.md"
    title: "Codex and Linear: delegate, triage rules, runs as the issue creator"
  - id: claude-action
    resource: "https://code.claude.com/docs/en/github-actions"
    title: "Claude Code GitHub Action: interactive and automation modes, trigger inputs"
  - id: claude-routines
    resource: "https://code.claude.com/docs/en/routines.md"
    title: "Claude scheduled tasks: GitHub triggers, per-event sessions, identity"
  - id: devin-stacks
    resource: "https://docs.devin.ai/work-with-devin/stacked-prs.md"
    title: "Devin stacked pull requests: 2 to 100, ordered bottom to top"
  - id: devin-automations
    resource: "https://docs.devin.ai/product-guides/automations.md"
    title: "Devin automations: concurrent runs, queue depth, duplicate prevention"
  - id: devin-outposts
    resource: "https://docs.devin.ai/cloud/outposts/orchestration.md"
    title: "Devin Outposts: atomic claim returns 409"
  - id: devin-managed
    resource: "https://docs.devin.ai/work-with-devin/advanced-capabilities.md"
    title: "Devin Managed Devins: fan out to child sessions"
  - id: devin-identity
    resource: "https://docs.devin.ai/integrations/gh.md"
    title: "Devin GitHub identity modes and organisation-level permissions"
  - id: jules-tasks
    resource: "https://jules.google/docs/running-tasks"
    title: "Jules: the jules label starts a task"
  - id: jules-changelog
    resource: "https://jules.google/docs/changelog/2026-10-29"
    title: "Jules turndown notice"
  - id: cursor-automations
    resource: "https://cursor.com/docs/cloud-agent/automations"
    title: "Cursor automations: issue label changed, PR stacked trigger, fork restrictions"
  - id: factory-trigger
    resource: "https://github.com/Factory-AI/droid-action/blob/main/src/github/validation/trigger.ts"
    title: "droid-action trigger logic disables the assignee and label triggers"
  - id: factory-delegations
    resource: "https://docs.factory.com/delegations/index.md"
    title: "Factory delegations: Slack, Linear, Jira, Teams, no GitHub delegation"
  - id: linear-agents
    resource: "https://linear.app/developers/agents"
    title: "Linear agents: delegation sets the delegate, not the assignee"
  - id: linear-interaction
    resource: "https://linear.app/developers/agent-interaction"
    title: "Linear agent sessions and typed activities, including elicitation"
  - id: github-token
    resource: "https://docs.github.com/en/actions/concepts/security/github_token"
    title: "GITHUB_TOKEN: events it authors do not create workflow runs"
  - id: speckit-issues
    resource: "https://github.com/github/spec-kit/blob/a4d571229e164e440f8950cac034607bae7b7518/extensions/github/commands/speckit.github.taskstoissues.md"
    title: "Spec Kit taskstoissues: one issue per task, dedupe by task ID in the title"
  - id: speckit-dogfood
    resource: "https://github.com/github/spec-kit/blob/a4d571229e164e440f8950cac034607bae7b7518/.github/workflows/bug-fix.md"
    title: "Spec Kit dogfood workflow: a labeled issue, unresolved clarifications stop the run"
  - id: bmad-tree
    resource: "https://github.com/bmad-code-org/BMAD-METHOD/blob/e435a22574fe55722841086e5566420178b98df3/docs/plan/set-up-the-ticket-tree.md"
    title: "BMAD ticket tree: tracker issues carry sub-issues and blocked-by relations"
  - id: agentos
    resource: "https://github.com/buildermethods/agent-os/blob/e892e61d322759165e7d9173e92c1010406c9f4d/CHANGELOG.md"
    title: "Agent OS retired spec writing, task breakdown and implementation orchestration"
  - id: kiro-specs
    resource: "https://kiro.dev/docs/specs/"
    title: "Kiro specs: requirements, design, tasks, dependency waves inside one workspace"
  - id: assignees
    resource: "https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/assigning-issues-and-pull-requests-to-other-github-users"
    title: "Issues and pull requests accept up to ten assignees"
  - id: speckit-workflows
    resource: "https://github.com/github/spec-kit/blob/a4d571229e164e440f8950cac034607bae7b7518/docs/workflows/overview.md"
    title: "Spec Kit workflows: review gates, resumable runs, verdict inputs"
  - id: openspec-team
    resource: "https://github.com/Fission-AI/OpenSpec/blob/0c737dc1b543249b38b0f4716816fcf493d894dd/docs/team-workflow.md"
    title: "OpenSpec: one change, one owner, archive conflicts in specs/"
  - id: openspec-archive
    resource: "https://github.com/Fission-AI/OpenSpec/blob/0c737dc1b543249b38b0f4716816fcf493d894dd/openspec-parallel-merge-plan.md"
    title: "OpenSpec parallel archive: a modified requirement loses the other change's scenarios"
  - id: bmad-dispatch
    resource: "https://github.com/bmad-code-org/BMAD-METHOD/blob/e435a22574fe55722841086e5566420178b98df3/docs/build/autonomous-development-loops.md"
    title: "BMAD Build Auto: one ticket per invocation, an orchestrator owns dispatch"
  - id: kiro-tasks
    resource: "https://kiro.dev/docs/web/using-the-agent/creating-tasks/"
    title: "Kiro agent: label or /kiro comment, 10 concurrent tasks, needs attention"
  - id: tessl-factory
    resource: "https://docs.tessl.io/introduction-to-tessl/build-your-first-factory.md"
    title: "Tessl factory: fixed label, 90 second debounce, stop on label removal"
  - id: gha-concurrency
    resource: "https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency"
    title: "Actions concurrency: one running and one pending, queue single or max"
  - id: ghaw-concurrency
    resource: "https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/reference/concurrency.md"
    title: "gh-aw concurrency policy: per-entity groups, queue max, job discriminator"
  - id: ghaw-label
    resource: "https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/reference/triggers.md"
    title: "gh-aw label_command removes its label at activation"
  - id: ghaw-queue
    resource: "https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/reference/work-queue.md"
    title: "gh-aw work queue: git-backed claims, claim handles, expires_at, no lease"
  - id: ghaw-plan
    resource: "https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/patterns/research-plan-assign-ops.md"
    title: "gh-aw plan to assign: up to five sub-issues under a parent tracking issue"
  - id: stacks-ga
    resource: "https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available"
    title: "Stacked pull requests generally available, stacked webhook action"
  - id: stacks-rules
    resource: "https://docs.github.com/en/pull-requests/reference/stacked-pull-requests"
    title: "Stack rules: base-of-stack evaluation, linear history, same repository"
  - id: sub-issues
    resource: "https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues"
    title: "Sub-issues: 100 per parent, eight levels"
  - id: of-automations
    resource: "https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/docs/content/docs/factory/automations.mdx"
    title: "openfabriq automations: events, filters, remove_labels, concurrency scope"
  - id: of-tickets
    resource: "https://github.com/openfabriq/openfabriq/tree/2a183bf053a27d52bf9fc733a2db6159773325df/examples/26-webflow-to-astro"
    title: "openfabriq open-tickets: readiness re-derived from files, at most five"
  - id: pr-stack-skill
    resource: "https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills"
    title: "Copilot pr-stack skill: one child session per layer"
  - id: gh-blog-stack
    resource: "https://github.blog/engineering/turn-one-giant-ai-generated-pull-request-to-a-reviewable-stack"
    title: "One agent per layer, gh stack for mechanics, review bottom-up"
  - id: copilot-best-practices
    resource: "https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results"
    title: "Treat the assigned issue as a prompt, include acceptance criteria"
---

# Agentic SDLC automation

**Question:** how do current systems turn an issue into an agent run and a pull request, what does one unit of work contain, who claims it, and which of those mechanics fit llame?

**Status:** noncanonical. The sources were read on 2026-11-20: vendor documentation, framework repositories at pinned commits, and the GitHub platform reference. Nothing was run. No agent, workflow or factory described here was installed, executed or probed, so every statement is a reading of published behaviour, not an observation. Claims the sources do not settle carry `[unverified]`, and reasoning of my own carries `[inference]`. [VISION.md](../../../VISION.md) and [ROADMAP.md](../../../ROADMAP.md) own direction.

## The shape every system shares

Read together, the systems differ in naming but not in structure. Every one is the same five-stage pipeline:

1. An event arrives: an issue event, a comment, a label, an assignment, a schedule, a webhook or an API call.
2. Admission checks decide whether the event may start work: actor role, write access, bot allowlist, a search or payload filter.
3. A durable run record carries a state machine. It is a Copilot session,[^copilot-concepts] a Claude session or task run,[^claude-routines] a Devin session,[^devin-automations] or a Linear `AgentSession`.[^linear-interaction]
4. The run produces a branch and a pull request, or several branches and several pull requests.
5. A person decides at merge, and branch protection or an extra-approval rule enforces the gate rather than the agent's own restraint.[^copilot-risks]

The systems genuinely differ in four places. One is whether the run record can hold more than one pull request.[^devin-stacks] Another is whether the tracker models delegation separately from ownership.[^linear-agents] The third is which event surface starts a run. The fourth is whether a plan is approved before code exists.[^kiro-tasks]

## Issue-to-PR vendor agents

| System                 | Issue trigger                                            | One unit produces                      | Stacks            | Claim and dedupe                                 | Actor                                         |
| ---------------------- | -------------------------------------------------------- | -------------------------------------- | ----------------- | ------------------------------------------------ | --------------------------------------------- |
| Copilot cloud agent    | assignment, automations, API                             | one branch, one pull request per task  | no                | session per task, "Anyone except Copilot" filter | Copilot, human as co-author                   |
| Codex                  | `@codex review` on GitHub, delegate or mention in Linear | a task, a human opens the pull request | reads stacks only | chat per issue                                   | App, or the issue creator's account in Linear |
| Claude Code Action     | label, assignee, trigger phrase                          | one branch per run                     | no                | one run per event, write-access check            | `claude[bot]`                                 |
| Claude scheduled tasks | repository events, schedule, API                         | one session per event                  | no                | no session reuse across events                   | the connected human                           |
| Jules                  | `jules` label                                            | one session, one pull request          | no                | none documented                                  | Jules app                                     |
| Devin                  | `/devin` comment, automations                            | one to many pull requests              | yes, 2 to 100     | session reuse, edge detection, queue             | configurable per organisation                 |
| Cursor cloud agents    | `@cursor`, automations                                   | one branch, pull request by default    | consumes stacks   | one run per trigger, fork pull requests skipped  | `Cursor Agent`                                |
| Factory Droids         | `@droid`, delegations on trackers                        | one pull request per delegation        | no                | declared triggers disabled in code               | `factory-droid[bot]`                          |
| Linear protocol        | delegate field, mention, triage                          | one session bound to one issue         | no                | per-issue session                                | app user                                      |

Sources: Copilot,[^copilot-kickoff][^copilot-risks] Codex,[^codex-github] Claude,[^claude-action] Jules,[^jules-tasks] Devin,[^devin-stacks][^devin-identity] Cursor,[^cursor-automations] Factory,[^factory-trigger] Linear.[^linear-agents]

Vendor coverage is uneven by surface. Codex on GitHub is review-first, with `@codex review` as the documented mention, while Linear is its documented assignment surface: a triage rule delegates, and the run uses the account of the issue creator.[^codex-github][^codex-linear] The Claude Code GitHub Action ships three trigger kinds as inputs, an assignee, a label and a trigger phrase, and treats a supplied prompt as automation mode.[^claude-action] Factory still declares assignee and label triggers in its action metadata while the shipped trigger logic disables both.[^factory-trigger] Jules is a mechanism reference only, because it turns read-only in November 2026 and winds down at the end of the year.[^jules-changelog]

Assignment is the strongest issue trigger where it exists, because it carries intent and a dialog. GitHub documents that assigning an issue always creates a pull request,[^copilot-kickoff] and the assignment dialog carries the base branch, model and an optional prompt. Third-party products on GitHub fall back to mentions or to their own automations, because GitHub assignment is available to Copilot and agent apps rather than to every product.[^agent-hq]

A label is the only signal that both a human and a workflow can write, and it is the common handoff primitive. Its weakness is that nothing verifies it was consumed. Jules starts a task from the `jules` label,[^jules-tasks] and its docs state no removal and no dedupe, so `[inference]` that trigger is at least once and not idempotent. A mention is the most portable trigger and the weakest, because it carries no state and any edit can re-fire it.[^cursor-automations] No vendor in this reading treats a Project field as a trigger.[^copilot-automations]

Dedupe is done by reusing the session, not by clearing the trigger. Devin sends a repeated `/devin` comment to the session already working on the pull request, and uses edge detection so a trigger fires only on the transition into a matching state.[^devin-automations] Cursor fires an issue label trigger on removal as well as addition, and no tool in that product clears the label, so `[inference]` the label must be cleared by a person or a separate step.[^cursor-automations] Copilot snapshots the issue thread at assignment and documents that later issue comments are not seen.[^copilot-kickoff]

Identity separates into three layers: who may trigger, whose permissions the run has, and who the commit author is. The layers differ per product. Copilot's shared automations act as Copilot and bill the repository owner, while personal automations act as the human.[^copilot-concepts] Devin uses organisation-level App permissions rather than the permissions of the person who started the session, and opens pull requests as Devin, as the user, or as the user only.[^devin-identity] Claude scheduled tasks act as the connected human and state that the fired prompt is not live user input and cannot act as consent.[^claude-routines] `[unverified]` whether GitHub assignment triggers now exist for Devin, since a release note claims them while the automations page omits them.[^devin-automations]

Merge is the only real gate in every product, and the agent cannot pass it alone. Copilot cannot mark its own pull requests ready for review, approve them or merge them.[^copilot-risks] Factory documents no enforcement of its own plan approval and points to branch protection as the control.[^factory-delegations] The identity choices then decide which review gate exists at all.

## Spec-driven frameworks

The frameworks in this reading assume one unit, one branch and one pull request, and none of them has a stacked-pull-request concept.

| Framework | Unit                                | Spec to issues                                       | Dispatch                                       | Open questions                                    |
| --------- | ----------------------------------- | ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Spec Kit  | feature directory with `tasks.md`   | one issue per task, nothing consumes them            | label in GitHub's own dogfood workflows        | `[NEEDS CLARIFICATION]`, stop instead of guessing |
| OpenSpec  | one change folder                   | none                                                 | none, assignment through Copilot if configured | reviewer catches gaps in the proposal             |
| BMAD      | ticket tree, one plan file per leaf | sub-issues with blocked-by relations, sync on demand | an orchestrator runs one worker per ticket     | `unknown` field on an entry                       |
| Kiro      | `.kiro/specs/<name>`                | none, the issue is the input                         | `kiro` label or `/kiro` comment                | needs attention on the issue                      |
| Tessl     | `*.spec.md` per module              | none, the issue is the input                         | fixed `tessl` label                            | needs you on the issue                            |
| Agent OS  | spec folder in plan mode            | none                                                 | none, orchestration retired                    | `AskUserQuestion`                                 |

Spec Kit ships exactly one bridge from tasks to issues, and it is a conversion helper. It creates one issue per task, titled with the task ID, and skips any task whose ID already appears in an existing issue title. Its dedupe key is the title text, and the ordering markers and phase order are dropped on the way.[^speckit-issues] Nothing in the tooling starts an agent from those issues.

Approval in Spec Kit moved into workflows with human review gates that persist their state and resume from a verdict input, and approving the specification is a separate verdict from approving the plan.[^speckit-workflows] OpenSpec keeps the spec delta and the code in one branch and one pull request, forbids two owners on one change, and pushes concurrency hazards to archive time.[^openspec-team]

BMAD cuts the tree at planning time. Each leaf gets a plan file that carries `assignee`, `blocked_by` and a status, one worker invocation handles exactly one ticket, and a human or an outer session owns dispatch.[^bmad-dispatch] A tracker store publishes the tree as issues with sub-issues and blocked-by relations, and nothing syncs until the skill runs.[^bmad-tree] Kiro instead parallelises one spec inside one workspace, grouping independent tasks into waves that run sequentially.[^kiro-specs] Tessl keeps specs per module and runs a factory whose four loops share a fixed label.[^tessl-factory] Agent OS retired its spec writing, task breakdown and orchestration phases in favour of the model's own planning.[^agentos]

The unattended case is the one that matters for llame, and it is handled by stopping. In GitHub's own dogfood workflows an issue with unresolved clarification markers stops the run rather than guessing.[^speckit-dogfood] Kiro parks a task in `Needs attention` and posts the question on the issue.[^kiro-tasks] Tessl does the same with `Needs you`, and stops work when the label is removed.[^tessl-factory]

## Factory engines

openfabriq defines one automation per file, binding events and filters to an agent and to the writes it may make. A label is the handoff, and the agent removes that label in the same run through an explicit capability, so a re-add is a new human action.[^of-automations]

Its routing is not a coordinator. A run opens at most five child issues, each child starts its own run on creation, and readiness is re-derived from files in the repository rather than from tracker state.[^of-tickets] `[inference]` This is a stateless reconciliation pass over repository content, and its output is idempotent because the input files decide it.

Serialisation is declarative and scoped by subject, either the issue or the whole repository, with waiting runs starting when the earlier one ends.[^of-automations]

gh-aw, GitHub's own Markdown-to-workflow compiler, treats a label as a one-shot command by default: applying the label fires the workflow and the workflow removes the label so it can be applied again.[^ghaw-label] Its work queue is the published claims design. A git-backed transaction log holds immutable work, claim handles, reservations and results. Workers receive an immutable snapshot instead of queue-write credentials, and work expires through an `expires_at` value rather than a lease timer.[^ghaw-queue]

The other engines in this cluster answer the same questions differently. [Warp Factories](./2026-11-18-software-factory-as-code.md) routes through a foreman agent and ensures its examples with scorers. The Archon Dark Factory in that study gives the agent `gh` and protects a perimeter it may not change. Factory Workstreams and Devin Managed Devins fan out inside one run into many pull requests,[^devin-managed] and Devin is the only engine that keeps a session attached to every pull request in a stack.[^devin-stacks]

## GitHub platform mechanics

### Triggers fan out and labels carry state

One human action produces several runs. An issue opened with two labels starts three workflow runs, one for the open event and one per label. gh-aw therefore offers two label shapes: a one-shot command label the workflow removes, or a persistent state label matched by name.[^ghaw-label]

### `GITHUB_TOKEN` and App-authored events

`GITHUB_TOKEN` is a GitHub App installation token, and events it authors do not create workflow runs. The exceptions are `workflow_dispatch` and `repository_dispatch`, plus `pull_request` events of type `opened`, `synchronize` and `reopened`, which create runs in an approval-required state.[^github-token] Copilot turns the consequence into a product feature: workflows do not run automatically on its pushes until a person approves them.[^copilot-risks]

The second half of the rule is authorship class rather than permission. GitHub's own automation engine filters an app-authored label, assignment, closure, comment and review event regardless of the app's repository permissions.[^copilot-automations] `[inference]` A coordinator App that labels an issue to wake a worker therefore cannot rely on that label reaching the worker, and needs an explicit dispatch instead.

### Concurrency groups cancel or queue

A concurrency group holds at most one running and one pending run. By default the new arrival cancels the pending one, and `queue: max` allows up to 100 pending runs instead. Group names are case insensitive and must be unique across workflows, and ordering is first in, first out by wait time only.[^gha-concurrency] There is no documented form that acquires or fails immediately, and no holder identity.

gh-aw's shipped policy shows the practical shape: per-entity groups that include the issue or pull request number, `queue: max` wherever cancellation would lose work, and a job discriminator for fan-out. Its documented failure is the static key, where concurrent dispatches of one workflow cancel all but the latest.[^ghaw-concurrency]

### Claims belong in a control plane

Assignment is a routing signal, not a claim: an issue accepts up to ten assignees, so two agents can both hold it.[^assignees] The designs that work move the claim into a store the workers do not write. Linear does it in its data model, where delegation sets a `delegate` distinct from the human `assignee`.[^linear-agents] Devin returns `409` when another worker claimed the session first.[^devin-outposts] gh-aw does it in a git ref with claim handles and `expires_at`.[^ghaw-queue]

Devin also documents the queue behaviour that a claim store must reproduce: a bounded number of concurrent runs, a bounded queue depth, and events dropped when the queue is full.[^devin-automations]

### Native stacked pull requests

Stacked pull requests became generally available on 2026-10-06, with a `stacked` webhook action when a pull request joins a stack.[^stacks-ga] A stack is a real merge unit with rules that matter to an agent. Every pull request in the stack is evaluated against the base of the stack. Each one must also meet the requirements of every pull request below it. A fully linear history is required, all branches must be in one repository, and merge queues apply to the whole stack in order.[^stacks-rules]

Workflows trigger as if each pull request targeted the stack base, so `pull_request` workflows run once per layer unless filtered. That multiplies CI cost by layer count, and one compiler defaults to running only the top layer.[^ghaw-concurrency]

### Sub-issues

A parent issue accepts up to 100 sub-issues and eight levels of nesting.[^sub-issues] The tree is a fan-out and roll-up primitive: children are independent, each child can start its own run, and the only ordering the API expresses is a priority position in the list. gh-aw's published plan pattern creates up to five sub-issues under a parent tracking issue and assigns each one, and the children work in parallel with separate pull requests.[^ghaw-plan]

## Findings for llame

**F1. Nobody maps one specification to several issues, and nothing consumes the issues either.** No vendor decomposes a parent at trigger time. The decomposition primitives are authoring a sub-issue tree,[^copilot-issues] per-event mapping with filters,[^copilot-automations] fan-out inside one run,[^devin-managed] and best-of-N where several agents take one issue.[^agent-hq] Spec Kit converts tasks to issues and starts nothing from them.[^speckit-issues] BMAD publishes sub-issues and leaves dispatch to a human or an outer session.[^bmad-dispatch] The closest published pattern is gh-aw's plan step that creates the parent and up to five children before assignment.[^ghaw-plan] `[inference]` A specification that fans out into issues is therefore a llame design decision with no upstream template to copy.

**F2. One agent producing a whole stack is rare, and every other shape splits the work.** Devin is the only product that documents an agent emitting a stack, from 2 to 100 pull requests, and it stays attached to every pull request in it for the life of the session.[^devin-stacks] GitHub's own `/pr-stack` skill is documented as one child session per layer,[^pr-stack-skill] its engineering guide runs one agent per layer with `gh stack` doing the mechanics,[^gh-blog-stack] and its coding agent can hold one branch and one pull request per task.[^copilot-risks] gh-aw reaches several pull requests only by chaining works that depend on predecessor results.[^ghaw-queue] `[inference]` The layer count, the dependency direction and whether layers are stacked or parallel are per-task choices, not properties of the executor.

**F3. Existing coordinators are deterministic, and a model coordinator is untested.** openfabriq has no router: each automation starts from an event, and after a run the next step re-derives what is ready from files in the repository rather than from a coordinator's state.[^of-automations][^of-tickets] gh-aw's dispatcher is a workflow a person wrote, and its queue hands each worker an immutable snapshot rather than letting it choose.[^ghaw-queue] No system in this reading routes work with a model in the loop. `[inference]` A model that reads a specification and decides which slice to start next is open research, and the deterministic reconciler is the only shape with operational evidence behind it.

**F4. Concurrency groups cancel or queue, and claims belong in a control plane.** A group holds one running and one pending run, drops the pending one by default, and cannot express try-acquire.[^gha-concurrency] A static key loses every run but the last.[^ghaw-concurrency] The claim therefore lives in a store with an owner and an expiry: Linear's `delegate` field,[^linear-agents] Devin's `409` claim and bounded queue,[^devin-outposts][^devin-automations] or gh-aw's git-backed queue with `expires_at`.[^ghaw-queue] `[inference]` In llame that store belongs with the Run or Chat record, not in issue labels or assignees, which nothing clears.

**F5. The trigger is the least reliable part of the chain.** A one-shot label removed at activation is the only documented mechanism that makes re-triggering a human act and keeps the pending-run slot free.[^ghaw-label] App-authored label, assignment, closure, comment and review events are filtered before any permission check.[^copilot-automations] `GITHUB_TOKEN` events start no workflow, and automation-authored pull requests arrive in an approval-required state.[^github-token] `[inference]` A handoff that crosses an identity boundary must be an explicit dispatch or a durable record a worker polls, not an event the platform may drop.

**F6. Handoff is an explicit human action everywhere, and open questions block rather than guess.** Assignment, a `/command`, a label, a delegation and a plan approval are all one human act that carries the human's identity.[^copilot-kickoff][^tessl-factory][^linear-agents] Automations move that act to configuration time and compensate with actor filters and write scope.[^copilot-automations] A question that nobody can answer stops the run: `Needs attention` in Kiro,[^kiro-tasks] `Needs you` in Tessl,[^tessl-factory] typed `elicitation` activities in Linear,[^linear-interaction] and an explicit stop in GitHub's own dogfood workflow.[^speckit-dogfood] The issue body is the prompt, and GitHub's guidance is to write it with problem, acceptance criteria and files.[^copilot-best-practices]

**F7. Layered changes to one canonical specification lose scenarios.** OpenSpec documents the failure directly: when a second change archives, its modified block replaces the requirement with its own scenario set, and a scenario shipped by the earlier change disappears with no warning, diff or conflict marker.[^openspec-archive] The recommendation is a base fingerprint per modified entry, an abort when the live requirement diverged, and a rebase with three-way merge. `[unverified]` whether the fingerprints and that rebase command shipped. Since a change is one owner and one branch,[^openspec-team] `[inference]` a stack of layers over one requirement has the same shape as the parallel changes that produced this defect, and needs a merge unit below the pull request.

## Limits

- Kiro and Tessl are closed source, so their docs describe behaviour and not enforcement.
- The Copilot, Codex, Claude, Devin, Cursor, Factory, Jules and Linear pages move without notice. Only the framework, gh-aw and openfabriq citations are pinned to commits.
- BMAD is read from its v7 preview branch, so the stable line may differ.
- Nothing here was executed: no workflow, agent or factory was installed, simulated or probed.

[^copilot-kickoff]: [Starting a task with Copilot cloud agent: assignment always creates a pull request](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task)

[^copilot-automations]: [Creating Copilot automations: triggers, actor filters, app-event filtering, write scope](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations)

[^copilot-concepts]: [Automation concepts: personal and shared identity, billing, cost caps](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/about-automations)

[^copilot-risks]: [Copilot cloud agent risks: one branch, one pull request, no self-approval](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)

[^copilot-issues]: [Copilot authors a parent issue with sub-issues](https://docs.github.com/en/copilot/how-tos/copilot-on-github/copilot-for-github-tasks/use-copilot-to-create-or-update-issues)

[^agent-hq]: [Agent HQ: several agents assigned to one issue](https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/)

[^codex-github]: [Codex on GitHub: review mentions, automatic review toggle](https://learn.chatgpt.com/docs/third-party/github.md)

[^codex-linear]: [Codex and Linear: delegate, triage rules, runs as the issue creator](https://learn.chatgpt.com/docs/third-party/linear.md)

[^claude-action]: [Claude Code GitHub Action: interactive and automation modes, trigger inputs](https://code.claude.com/docs/en/github-actions)

[^claude-routines]: [Claude scheduled tasks: GitHub triggers, per-event sessions, identity](https://code.claude.com/docs/en/routines.md)

[^devin-stacks]: [Devin stacked pull requests: 2 to 100, ordered bottom to top](https://docs.devin.ai/work-with-devin/stacked-prs.md)

[^devin-automations]: [Devin automations: concurrent runs, queue depth, duplicate prevention](https://docs.devin.ai/product-guides/automations.md)

[^devin-outposts]: [Devin Outposts: atomic claim returns 409](https://docs.devin.ai/cloud/outposts/orchestration.md)

[^devin-managed]: [Devin Managed Devins: fan out to child sessions](https://docs.devin.ai/work-with-devin/advanced-capabilities.md)

[^devin-identity]: [Devin GitHub identity modes and organisation-level permissions](https://docs.devin.ai/integrations/gh.md)

[^jules-tasks]: [Jules: the jules label starts a task](https://jules.google/docs/running-tasks)

[^jules-changelog]: [Jules turndown notice](https://jules.google/docs/changelog/2026-10-29)

[^cursor-automations]: [Cursor automations: issue label changed, PR stacked trigger, fork restrictions](https://cursor.com/docs/cloud-agent/automations)

[^factory-trigger]: [droid-action trigger logic disables the assignee and label triggers](https://github.com/Factory-AI/droid-action/blob/main/src/github/validation/trigger.ts)

[^factory-delegations]: [Factory delegations: Slack, Linear, Jira, Teams, no GitHub delegation](https://docs.factory.com/delegations/index.md)

[^linear-agents]: [Linear agents: delegation sets the delegate, not the assignee](https://linear.app/developers/agents)

[^linear-interaction]: [Linear agent sessions and typed activities, including elicitation](https://linear.app/developers/agent-interaction)

[^github-token]: [GITHUB_TOKEN: events it authors do not create workflow runs](https://docs.github.com/en/actions/concepts/security/github_token)

[^speckit-issues]: [Spec Kit taskstoissues: one issue per task, dedupe by task ID in the title](https://github.com/github/spec-kit/blob/a4d571229e164e440f8950cac034607bae7b7518/extensions/github/commands/speckit.github.taskstoissues.md)

[^speckit-dogfood]: [Spec Kit dogfood workflow: a labeled issue, unresolved clarifications stop the run](https://github.com/github/spec-kit/blob/a4d571229e164e440f8950cac034607bae7b7518/.github/workflows/bug-fix.md)

[^bmad-tree]: [BMAD ticket tree: tracker issues carry sub-issues and blocked-by relations](https://github.com/bmad-code-org/BMAD-METHOD/blob/e435a22574fe55722841086e5566420178b98df3/docs/plan/set-up-the-ticket-tree.md)

[^agentos]: [Agent OS retired spec writing, task breakdown and implementation orchestration](https://github.com/buildermethods/agent-os/blob/e892e61d322759165e7d9173e92c1010406c9f4d/CHANGELOG.md)

[^kiro-specs]: [Kiro specs: requirements, design, tasks, dependency waves inside one workspace](https://kiro.dev/docs/specs/)

[^assignees]: [Issues and pull requests accept up to ten assignees](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/assigning-issues-and-pull-requests-to-other-github-users)

[^speckit-workflows]: [Spec Kit workflows: review gates, resumable runs, verdict inputs](https://github.com/github/spec-kit/blob/a4d571229e164e440f8950cac034607bae7b7518/docs/workflows/overview.md)

[^openspec-team]: [OpenSpec: one change, one owner, archive conflicts in specs/](https://github.com/Fission-AI/OpenSpec/blob/0c737dc1b543249b38b0f4716816fcf493d894dd/docs/team-workflow.md)

[^openspec-archive]: [OpenSpec parallel archive: a modified requirement loses the other change's scenarios](https://github.com/Fission-AI/OpenSpec/blob/0c737dc1b543249b38b0f4716816fcf493d894dd/openspec-parallel-merge-plan.md)

[^bmad-dispatch]: [BMAD Build Auto: one ticket per invocation, an orchestrator owns dispatch](https://github.com/bmad-code-org/BMAD-METHOD/blob/e435a22574fe55722841086e5566420178b98df3/docs/build/autonomous-development-loops.md)

[^kiro-tasks]: [Kiro agent: label or /kiro comment, 10 concurrent tasks, needs attention](https://kiro.dev/docs/web/using-the-agent/creating-tasks/)

[^tessl-factory]: [Tessl factory: fixed label, 90 second debounce, stop on label removal](https://docs.tessl.io/introduction-to-tessl/build-your-first-factory.md)

[^gha-concurrency]: [Actions concurrency: one running and one pending, queue single or max](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

[^ghaw-concurrency]: [gh-aw concurrency policy: per-entity groups, queue max, job discriminator](https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/reference/concurrency.md)

[^ghaw-label]: [gh-aw label_command removes its label at activation](https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/reference/triggers.md)

[^ghaw-queue]: [gh-aw work queue: git-backed claims, claim handles, expires_at, no lease](https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/reference/work-queue.md)

[^ghaw-plan]: [gh-aw plan to assign: up to five sub-issues under a parent tracking issue](https://github.com/github/gh-aw/blob/e2cfd456caf4cd2782b4a1bc2e9a4bdd46d6c5ae/docs/src/content/docs/patterns/research-plan-assign-ops.md)

[^stacks-ga]: [Stacked pull requests generally available, stacked webhook action](https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available)

[^stacks-rules]: [Stack rules: base-of-stack evaluation, linear history, same repository](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)

[^sub-issues]: [Sub-issues: 100 per parent, eight levels](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)

[^of-automations]: [openfabriq automations: events, filters, remove_labels, concurrency scope](https://github.com/openfabriq/openfabriq/blob/2a183bf053a27d52bf9fc733a2db6159773325df/packages/docs/content/docs/factory/automations.mdx)

[^of-tickets]: [openfabriq open-tickets: readiness re-derived from files, at most five](https://github.com/openfabriq/openfabriq/tree/2a183bf053a27d52bf9fc733a2db6159773325df/examples/26-webflow-to-astro)

[^pr-stack-skill]: [Copilot pr-stack skill: one child session per layer](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills)

[^gh-blog-stack]: [One agent per layer, gh stack for mechanics, review bottom-up](https://github.blog/engineering/turn-one-giant-ai-generated-pull-request-to-a-reviewable-stack)

[^copilot-best-practices]: [Treat the assigned issue as a prompt, include acceptance criteria](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)
