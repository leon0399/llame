---
status: accepted
---

# A title call walks its model role's chain

When `defaults.titleGenerationSelector` names a model role, a failed title
request moves to the role's next candidate at once. No failover policy is
needed. The call stores no fallback hold and never waits for a quota reset. It
still skips a paid candidate unless the role sets `allowPaidFallback`.

This narrows
[Automatic failover is opt-in per model role, failure group, and Run origin](2026-11-20-automatic-failover-is-opt-in.md).
That decision covers Runs. A title call is a side call: it has no Run origin, no
prompt cache to lose, and no Chat state that a hold would have to undo. The
reasons for the opt-in do not apply to it, so a fresh installation can switch
models for titles.

## Considered options

- Use only the role's primary for titles. During an outage, new Chats keep
  their placeholder titles.
- Follow the instance default matrix's `owner` column. Enabling `owner × quota`
  to fix titles would also enable it for the Chats an owner drives.

Decided in the spec grilling of
[model roles with fallback chains](https://github.com/leon0399/llame/issues/1772#issuecomment-7101877446),
for the OpenSpec change `model-roles`.
