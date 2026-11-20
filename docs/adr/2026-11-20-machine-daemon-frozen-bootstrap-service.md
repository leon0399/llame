---
status: accepted
---

# A frozen bootstrap service beside an exactly matched Machine protocol

The installation absorbs version skew; the Machine daemon speaks exactly one
protocol version. During alpha the main service (tools, jobs, MCP) requires an
exact protocol match, and every change to its contract bumps the version under
a CI check, so no daemon ever silently ignores a field such as a time limit.
Beside it, a bootstrap service never breaks. It carries the daemon's instance
id, release version, build id, protocol version, static facts, and a control
that stops new work. An out-of-date daemon on a configured Machine therefore
stays identifiable and diagnosable, and llame can refuse it new work instead
of losing contact with it.

## Considered options

- Exact match on one service, as the first daemon did. Rejected because after
  the first protocol change, every configured Machine would be unidentifiable
  until someone upgraded it by hand.
- A compatible release-version range. Rejected because runtime plugins change
  what a daemon can do without changing its release version. Capabilities
  describe what the box can do instead.

## Consequences

Each deploy that changes the protocol puts configured Machines into "update
required" until their operator upgrades them. llame replaces only the daemons
it injected into provisioned Machines and recipe instances.

Decided in
[Capability negotiation for every method family](https://github.com/leon0399/llame/issues/1781).
