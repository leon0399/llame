---
status: accepted
---

# Host tools run through the Machine daemon

The host is an ordinary Machine. Its native file, grep, git, MCP, and `bash`
operations go through the same Machine daemon and protocol as every other
Machine, attached over local stdio instead of SSH. The in-process executor is
deleted, including for development and tests. We accept about 1 ms of extra
latency per call, measured on the current Node daemon, so that every capability
is written and tested once, every executor is version-negotiated, and the whole
daemon process can later be confined as one Sandbox. Confining an in-process
executor would mean confining the worker that holds the database and provider
credentials.

## Considered options

- Keep an in-process fallback for development only. Rejected because the
  daemon is moving to Rust, so the fallback would be a second implementation
  whose behavior drifts.
- Fall back to in-process execution when the host daemon is unavailable.
  Rejected because a host call would then silently lose its Sandbox. The API
  starts and reports the existing Machine-unavailable states instead.

## Consequences

The host cuts over to today's Node daemon first. The Rust daemon and gRPC
contract replace it behind the connector afterwards, so call sites move once.
`pnpm dev` needs a daemon binary before it starts.

Decided on the wayfinder map
[the way to one executor contract with Sandboxes](https://github.com/leon0399/llame/issues/1778),
in the tickets
[Host daemon transport and supervision](https://github.com/leon0399/llame/issues/1780),
[Per-call overhead of the daemon against in-process tools](https://github.com/leon0399/llame/issues/1782),
and
[Cutover: delete the in-process executor or keep a fallback](https://github.com/leon0399/llame/issues/1784).
