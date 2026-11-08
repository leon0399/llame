# Agent execution substrate

Prior-art evidence for tracking issue
[#1612](https://github.com/leon0399/llame/issues/1612): the model roles (F1), cost
tree (F2) and background jobs (F3) that subagents
([#765](https://github.com/leon0399/llame/issues/765)) build on.

- [Model roles, failover, routing and catalogs](./model-roles-and-failover.md) —
  role and alias grammars, failover triggers and cooldowns, context promotion,
  learned and classifier routers, assistant-visible model catalogs, and what a
  safe mid-Run model switch requires.
- [Background jobs and subagent lifecycle](./background-jobs-and-subagents.md) —
  job registries, result delivery, cancellation cascades, bounds, untrusted
  child output, and durable parent suspension options.
- [Agent communication and bots](./agent-communication.md) — parent and child
  messaging, addressing and envelopes, steering, reading other sessions as
  recall, and bot identity and triggers.
- [oh-my-pi yield and agent messaging](./oh-my-pi-yield-and-messaging.md) —
  the validated terminal result, steering and asides, reply deadlock checks,
  and parked-agent revival.
- [Child agents across conversation forks](./children-across-forks.md) —
  whether forks list, message, copy, share or detach existing children.
- [Blind-spot review](./blind-spot-review.md) — lifecycle, security, cost
  and spec-conflict reviews of the settled #1612 decisions.
- [llame baseline](./llame-baseline.md) — the shipped Run, queue, tool, usage,
  Chat and permission contracts these foundations change.
