# Standalone Node integration

`apps/node` is the independently launchable personal Node. It owns the
single-owner SQLite state, provider configuration, execution loop, approvals,
and live Knowledge access through `@workspace/personal-node`. It does not
start the CLI or hosted API, require an account, or open a TCP listener.

## Start

Build the workspace before launching the checked-out application:

```sh
pnpm exec turbo run build --filter=@workspace/node --concurrency=1
node apps/node/bin/llame-node.cjs --help
```

The default transport is a foreground Unix-socket service:

```sh
node apps/node/bin/llame-node.cjs \
  --config /absolute/config.json \
  --data-dir /absolute/data-dir
```

The data directory is private (`0700`). The endpoint is
`<data-dir>/node.sock`, owned by the current OS user and set to `0600` after
the listener starts. The service is intentionally not detached or installed as
a system service. `--native --cwd /absolute/project` grants the explicitly
selected startup Workspace to this Node; a client cannot widen that grant.

For an embedding Surface, use private stdio instead:

```sh
node apps/node/bin/llame-node.cjs --stdio \
  --config /absolute/config.json \
  --data-dir /absolute/data-dir
```

Stdio is newline-delimited JSON-RPC. JSON frames use stdout; diagnostics use
stderr. Unix-mode startup notices and failures use stderr because no stdio
protocol is active. A stdio startup failure still emits its `core.error` frame
on stdout.

## Crash recovery

A persistent service records its PID and a random ownership nonce in
`node-server.json` before it binds the endpoint. A clean stop removes both the
record and the socket. A crash can leave them behind. Run the recovery command
from the same OS user and data directory:

```sh
node apps/node/bin/llame-node.cjs recover \
  --data-dir /absolute/data-dir
```

Recovery takes a private lock, reads the ownership record, proves that the
recorded PID no longer exists, rechecks the unchanged record, validates any
socket as a current-user `0600` Unix socket, and removes the socket before the
ownership record. A live PID, changed ownership record, insecure endpoint, or
endpoint without an ownership record is an error and remains untouched.
There is no automatic stale-endpoint replacement. Do not delete the state file
manually; a live service could otherwise be displaced.

Recovery removes a proven-dead server endpoint only. Interrupted execution
state has a separate runtime recovery operation over the private protocol and
is never replayed automatically.

## Ownership boundaries

The launcher owns process lifetime and transport composition. The personal
runtime owns state and execution. The CLI, when present, is a thin client and
must not open this SQLite database or run the model loop itself. Hosted HTTP
access and tenant policy remain owned by `apps/api`.

The launcher has no enrollment, synchronization, remote tool bridge, or silent
fallback to another executor. See the [private protocol](local-protocol.md)
for framing and transport behavior. Common owner-read schemas and capability
discovery are documented by the shared Node contract; execution and
administration remain private to this runtime.
