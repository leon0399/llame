---
status: accepted
---

# Automatic failover is opt-in per model role, failure group, and Run origin

A model role lists the models that a Chat can use. By default, llame never
moves a Run to the next candidate on its own. When a model request fails, the
reply offers "Continue on next candidate", and the owner decides.

An operator turns on automatic failover per model role, in a matrix. Its rows
are failure groups: `availability`, `access`, and `quota`. Its columns are Run
origins: `owner` and `agent` now, and `schedule` and `event` when automations
ship. Every cell is off unless the operator sets it.

We chose this because the person who writes a model role is often not the
person who picks it. An owner who sends to `@coding` should not find that an
outage at 03:00 moved the Chat to another provider without anyone choosing it.
That move costs a cold prompt cache, and it can reach a paid model. Runs are
durable and often unattended, so a silent switch is easy to miss.

Unattended work still needs failover, and most of it runs in subagents. The
`agent` column lets an operator enable failover there and leave the Chats that
an owner drives under the owner's control.

## Considered options

- Fail over automatically whenever a model role lists more than one model.
  oh-my-pi, OpenClaw, Hermes Agent, and Claude Code all work this way once a
  fallback chain is configured. That suits a single-user tool, where the person
  who configures the chain also watches the session.
- Ask the owner before each failover. No harness that we read asks for an
  availability failure. llame has no approval pause, so an unattended Run would
  wait until the owner returns.
- Key the columns by product, such as chat, subagent, automation, and bot. A
  scheduled Run inside an existing Chat would then belong to two columns. A Run
  origin stays the same whichever Chat the Run lands in.

## Consequences

- A model role without a failover policy fails or waits, and the owner
  continues it. A fresh installation never switches a Run's model on its own.
  Title calls are not Runs and follow
  [A title call walks its model role's chain](2026-11-23-a-title-call-walks-its-role-chain.md).
- The example configuration enables the `availability` row for the `agent`
  column, so subagents survive provider outages once an operator copies it.
- A `quota` cell takes `on`, `off`, or a `switchAfterSeconds` duration. A reset
  nearer than the duration waits for the reset, and a later one switches at once.
- A job-notice Run takes the origin of the Run that started the job. A
  scheduled flow that an operator enabled does not stall when its background
  job wakes the Chat.

This was decided in
[Who controls automatic failover, per failure group and Run origin](https://github.com/leon0399/llame/issues/1822),
for [model roles with fallback chains](https://github.com/leon0399/llame/issues/1772).
