---
status: proposed
---

# The Machine daemon is a Rust binary with a gRPC contract

The Machine daemon is a Rust binary that serves a gRPC contract defined in
`.proto` files under `packages/machine-protocol/proto`. It outlives its
connections and holds background jobs, so each Machine needs one small static
binary per Linux architecture and no language runtime, and the API needs a
typed wire with a frozen bootstrap service that every daemon version answers.

## Considered options

- A Node.js daemon. We rejected it because every configured Machine would
  need a Node.js runtime of a compatible version, and a long-lived process that
  holds jobs is easier to keep small and predictable as one static binary.
- A thin Node.js daemon that runs commands through a Rust runner. We rejected
  it because a configured Machine would then need Node.js and a second binary,
  and the job state would cross two processes on one box.
- Newline JSON-RPC framing. We rejected it because gRPC brings generated
  clients on both sides, deadlines, streams, and a breaking-change check, which
  llame would otherwise write and test itself.

## Consequences

The repository has a Cargo workspace beside pnpm, and [SPEC.md](../../SPEC.md)
names Rust as the language of the Machine daemon. The API talks to the daemon
through a generated Connect-ES client. The daemon builds for Linux only until a
macOS or Windows Machine needs it.

This was decided on the wayfinder map
[the way to one executor contract with Sandboxes](https://github.com/leon0399/llame/issues/1778),
in these tickets:

- [Machine daemon implementation language and reusable tool engines](https://github.com/leon0399/llame/issues/1805)
- [Machine wire contract: existing JSON-RPC framing or gRPC](https://github.com/leon0399/llame/issues/1806)
- [gRPC over a child process stdio from Node and Rust](https://github.com/leon0399/llame/issues/1922)
