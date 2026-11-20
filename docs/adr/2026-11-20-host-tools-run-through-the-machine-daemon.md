---
status: accepted
---

# Host tools run through the Machine daemon

The host is an ordinary Machine. Its native file, grep, git, MCP, and `bash`
operations go through the same Machine daemon and protocol as every other
Machine. The API attaches to the host's daemon over local stdio instead of SSH.
We deleted the in-process executor, including for development and tests.

Each call costs about 1 ms more, measured on the current Node daemon. In
return, every capability has one implementation and one set of tests, and
llame negotiates the protocol version with every executor in the same way. The
whole daemon process can also be confined later as one Sandbox. To confine an
in-process executor, llame would have to confine the worker that holds the
database and provider credentials.

## Considered options

- Keep an in-process fallback for development only. We rejected it because the
  daemon is moving to Rust, so the fallback would become a second
  implementation whose behavior drifts.
- Fall back to in-process execution when the host daemon is unavailable. We
  rejected it because a host call would then silently lose its Sandbox. The API
  starts and reports the existing Machine-unavailable states instead.

## Consequences

The host cuts over to today's Node daemon first. The Rust daemon and the gRPC
contract replace it behind `MachineConnector` later, so call sites move once.
`pnpm dev` needs a daemon binary before it starts.

This was decided on the wayfinder map
[the way to one executor contract with Sandboxes](https://github.com/leon0399/llame/issues/1778),
in these tickets:

- [Host daemon transport and supervision](https://github.com/leon0399/llame/issues/1780)
- [Per-call overhead of the daemon against in-process tools](https://github.com/leon0399/llame/issues/1782)
- [Cutover: delete the in-process executor or keep a fallback](https://github.com/leon0399/llame/issues/1784)
