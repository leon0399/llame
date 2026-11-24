---
status: proposed
---

# The Machine daemon is a one-shot Rust rewrite with a gRPC contract

We froze the Node Machine daemon and replaced it in one rewrite: a Rust
binary that serves a gRPC contract defined in `.proto` files. The daemon now
outlives its connections and holds background jobs, so it needs a small static
binary per Linux architecture and a typed wire with a frozen bootstrap service.
Extending the Node daemon first would have built those features twice.

## Considered options

- Extend the Node daemon now and rewrite it later. We rejected it because
  attach-or-start, daemon-held jobs, and the bootstrap service would each be
  built, tested, and migrated twice.
- Keep a thin Node daemon and run commands through a Rust runner. We rejected
  it because a configured Machine would then need Node.js and a second binary,
  and the job state would cross two processes on one box.
- Keep the newline JSON-RPC framing for the Rust daemon. We rejected it
  because gRPC brings generated clients on both sides, deadlines, streams, and
  a breaking-change check, which llame would otherwise write and test itself.

## Consequences

The repository gains a Cargo workspace beside pnpm, and [SPEC.md](../../SPEC.md)
names Rust as the language of the Machine daemon. The TypeScript engine tests
move to Rust unit and integration tests, and the API talks to the daemon
through a generated Connect-ES client. The daemon builds for Linux only until a
macOS or Windows contributor needs it.

This was decided on the wayfinder map
[the way to one executor contract with Sandboxes](https://github.com/leon0399/llame/issues/1778),
in these tickets:

- [Machine daemon implementation language and reusable tool engines](https://github.com/leon0399/llame/issues/1805)
- [Machine wire contract: existing JSON-RPC framing or gRPC](https://github.com/leon0399/llame/issues/1806)
- [gRPC over a child process stdio from Node and Rust](https://github.com/leon0399/llame/issues/1922)
