# Personal Node private transport

This document covers the standalone launcher's transport and lifecycle. The
versioned request schemas live in `packages/personal-node/src/protocol.ts` and
the shared owner-access contract has its own specification. This is private
local IPC, not the hosted HTTP API, MCP, ACP, or a synchronization protocol.

## Transports

`llame-node` has two explicit modes:

- Default mode listens on `<data-dir>/node.sock` in the foreground. The socket
  is a private Unix endpoint with mode `0600` beneath the private data
  directory. It has no TCP, browser, network-password, or remote-enrollment
  path.
- `--stdio` connects one embedding Surface to the process's stdin and stdout.
  It is process-private IPC and ends when input closes.

Persistent Unix sockets require a compatible Unix platform. Standalone stdio
does not require a Unix socket or a persistent service.

## Framing and negotiation

Stdio uses one UTF-8 JSON-RPC 2.0 object per newline. Requests use string IDs,
do not batch, and must negotiate version 2 before any domain operation:

```json
{
  "jsonrpc": "2.0",
  "id": "hello-1",
  "method": "core.hello",
  "params": { "version": 2 }
}
```

The response advertises the local owner principal, transport, implemented
modules and capabilities. Unknown fields, methods, protocol versions, and
caller-supplied identity are rejected. The request and response limits are
defined beside the framing implementation; clients must treat a limit error as
a transport failure and reconnect rather than retrying an uncertain execution.

The Unix socket carries the same request frames after a client connects. The
OS user owning the endpoint is the local authority. Filesystem permissions do
not isolate hostile programs running as that user and do not prove that a
Surface displayed a human approval prompt.

## Output and errors

Stdout is reserved for JSON-RPC frames in `--stdio` mode. Startup failures in
that mode emit a `core.error` notification and set a non-zero exit status:

```json
{
  "jsonrpc": "2.0",
  "method": "core.error",
  "params": {
    "code": "node_start_failed",
    "message": "Local Node could not start. No action was retried."
  }
}
```

Unix-mode startup notices and failures use stderr. They are operator
diagnostics, not protocol frames; stdout remains empty until a separate client
connects to the socket. A normal Unix startup reports readiness on stderr.

Runtime operation errors are returned through the negotiated channel with a
stable application code. Raw provider, filesystem, database, and SDK errors
do not cross the private protocol boundary. Protected values are redacted
before output or durable event recording.

## Stop and recovery

Closing stdio input cancels temporary work and closes that channel. A persistent
Unix service survives a client disconnect; another client can inspect the
server's bounded durable events. Explicit cancellation, client disconnect, and
executor death have different meanings. An uncertain execution is never
replayed automatically.

The direct launcher exposes recovery as an administrative command, outside the
JSON-RPC channel:

```sh
node apps/node/bin/llame-node.cjs recover --data-dir /absolute/data-dir
```

It proves the recorded process is dead and the ownership record is unchanged
before removing a socket and its record. A live owner, an insecure socket, or
an unowned endpoint is refused. The command does not recover or replay a Run;
runtime execution recovery remains an explicit private operation.

No transport mode silently falls back to another authority. Upgrade the
launcher and restart persistent services when the private protocol version
changes; an older daemon fails negotiation rather than being bypassed.
