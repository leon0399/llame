# Issues and handoff

An issue is the whole input for whoever picks it up, person or agent.
The procedure lives in `$issue-handoff`. This page owns the policy.
Delivery from the issue onward follows [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Hierarchy

| Level   | What it is                                                                       | Labels                    | Children                   |
| ------- | -------------------------------------------------------------------------------- | ------------------------- | -------------------------- |
| Tracker | A capability that spans several features, such as subagents                      | `type:tracking`, `area:*` | feature issues             |
| Feature | One deliverable. It owns at most one OpenSpec change                             | `type:*`, `area:*`        | cutovers, when it has some |
| Cutover | One slice that merges alone and leaves `master` working without the later slices | `type:*`, `area:*`        | none                       |

Children are native sub-issues. A feature that ships in one merge has no
cutovers. A slice that cannot merge alone is a layer, not an issue. The layer
that completes a cutover puts `Closes #<cutover>` on its PR, and the proposal
PR says `Refs #<feature>`.

One OpenSpec change covers a feature and all of its cutovers. A cutover gets its own proposal only when it touches specs that no sibling touches or when it is deferred past its siblings. In either case, it then becomes a feature of its own. When two open changes modify the same requirement, the one archived second can drop the other's scenarios ([research](../../docs/research/product-vision/2026-11-20-agentic-sdlc-automation.md), F7). A shared requirement therefore keeps one owning change.

Wayfinding maps and their tickets stay outside this tree. See [wayfinding](wayfinding.md).

## What the body carries

- **Spec brief**, on a feature that needs an OpenSpec change: outcome, decisions
  with links to the closed tickets or comments that hold them, ADRs, glossary
  terms, prior art, constraints against parallel changes, and open questions.
  The brief gists and links. A canonical spec, an ADR, and a ticket resolution
  each win over it, in that order.
- **Spec**, added once a proposal is approved: the change name, the proposal PR,
  and the cutover that each layer closes.
- **Acceptance**, on work that skips OpenSpec: a reproducer or a test that fails
  without the fix, or the check that shows a chore is done.

Decision comments stay as the record. The body is the current brief, not a
status: live status stays in the Project.

## Handoff

An approved spec does not start work. Project Status Ready means nobody holds
the item. Handing it off is an explicit action:

- assign a person.
- add a trigger label for an agent.

| Label             | Goes on                                                     | Requires                                |
| ----------------- | ----------------------------------------------------------- | --------------------------------------- |
| `agent:spec`      | a feature that needs a spec                                 | a complete Spec brief                   |
| `agent:implement` | a cutover, a feature without cutovers, or work with no spec | an approved Spec section, or Acceptance |
| `needs:human`     | any issue                                                   | a comment that says what is missing     |

Trigger labels start work. Only a trusted person adds `agent:*`. The automation
that picks a trigger up removes it when it starts, so applying it again is a
clean retry. An agent never adds or removes `agent:*`. It stops by adding
`needs:human` with a comment, for example when a brief is incomplete, a spec
contradicts itself, or a fix turns out to change a documented contract.

Agents often act under the same GitHub identity as the person who runs them, so
the platform cannot tell their labels apart. Each setup enforces the rule in its
own way: a separate bot identity, a guard that blocks label edits from agents,
or none for a contributor who works alone. Do not claim more protection than the
setup has.

## Pickup and release

Whoever starts work on an issue, person or agent, marks it in two
machine-readable ways:

- a `working:spec`, `working:implement`, or `working:triage` label for the stage, and an assignee.
- one comment that opens with a marker, followed by a plain sentence:

  ```html
  <!-- llame:pickup {"stage":"implement","by":"agent","harness":"omp","session":"w2P:p2","change":"continue-after-broken-send","started":"2026-11-20T21:40Z"} -->
  ```

  `stage` matches the label. `by` is `person` or `agent`, and an agent adds its
  `harness` and `session`. `session` is `issue` when the worker has no session
  interface and talks through issue comments. `change` names the OpenSpec
  change when there is one.

While the worker waits on a person, for an answer to a grilling round or a
missing input, it adds `needs:human` and keeps its `working:*` label. That pair
means "held, waiting on a person", and it pauses the stale clock. The person
answers where the comment says, and the worker removes `needs:human` when it
resumes.

A stage ends when the item waits only on a person and the worker has nothing
left to do. Then the worker removes the `working:*` label and posts a release
marker: `<!-- llame:release {"stage":"implement","outcome":"handed-back"} -->`.

| Stage     | Release when                                                                                                       | Outcome       |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ------------- |
| spec      | the proposal PR is ready and its [Ready-PR monitoring](../../CONTRIBUTING.md#ready-pr-monitoring) loop exits clean | `handed-back` |
| implement | every PR of the cutover is ready and its monitoring loop exits clean                                               | `handed-back` |
| triage    | the finding is posted on the issue                                                                                 | `done`        |
| any       | the worker ends its run without finishing, leaving `needs:human` and its reason                                    | `stopped`     |
| any       | a reconciler or a person finds the claim stale                                                                     | `stale`       |

Work that resumes after a release, such as fixing review feedback, posts a new
pickup marker. Moving from one stage to the next, such as spec to implement in
one session, is a release of the first stage with `handed-back` followed by a
new pickup for the second. A label and marker name only the stage that is
running. An implement pickup goes on each issue the run will close: every
cutover it implements, or the feature when it has no cutovers. A claim is stale when the session it names is gone, or when it
has no `needs:human` and no marker or PR activity for 24 hours. A reconciler,
or a person, then removes its `working:*` label and posts the `stale` release.

**The claim is the live `working:*` label with its pickup marker**, on the work
unit: a cutover resolves to its feature's change, and at most one worker holds
each dependency chain of that change. Branches and PRs left by a released
worker, including an approved proposal PR that implementation builds on, are
not claims. Work that finds a live claim stops. `agent:implement` on a cutover
whose earlier cutovers are neither done nor handed off stops with
`needs:human`.

## Talking to the worker

Conversation with an agent happens in its own session: a terminal pane, a cloud
session, or a llame Chat. The pickup marker's `session` field says where to
find it, and a `needs:human` comment names the session to answer in. Issue
comments carry the conversation only for an engine that has no session
interface.

When a grilling round settles, the agent writes each decision into the issue body or into one decision comment. The agent includes a gist and its reason, so the next worker starts from the issue without the transcript.
