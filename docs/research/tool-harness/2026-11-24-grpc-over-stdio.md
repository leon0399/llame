---
type: Research
title: "gRPC over a child process stdio from Node and Rust"
description: "Tests HTTP/2 over child-process stdio and compares Node transports, tonic server inputs, failure behavior, code generation and pipe-based RPC prior art."
tags:
  - grpc
  - machine-daemon
  - nodejs
  - rust
  - stdio
status: draft
summary: "A single HTTP/2 connection can use a full-duplex byte stream over child stdio. Node's core HTTP/2 createConnection hook accepts a Duplex, and tonic serves an incoming AsyncRead plus AsyncWrite stream. Connect-ES exposes the hook through nodeOptions. grpc-js does not expose a caller-supplied connection. A local Unix socket is the portable choice for grpc-js."
read_when:
  - choosing a Node gRPC client for Machine attach over stdio
  - implementing tonic on a daemon socket or an attach stdio stream
  - deciding how streams fail when SSH or an attach child exits
observed:
  date: 2026-11-24
  revisions:
    node: v22.23.3
    rustc: 1.98.1
    cargo: 1.98.1
    protoc: 36.2
    buf: 1.75.0
    tonic: 0.14.9
    prost: 0.14.6
    connect: 1.7.0
    connect-node: 1.7.0
    protoc-gen-connect-es: 1.7.0
    protoc-gen-es: 1.10.1
    grpc-js: 1.14.5
sources:
  - id: node-http2-v22
    resource: "https://nodejs.org/docs/v22.23.3/api/http2.html"
    title: "Node.js v22.23.3 HTTP/2 API"
  - id: node-http2-connect-source
    resource: "https://github.com/nodejs/node/blob/v22.23.3/lib/internal/http2/core.js"
    title: "Node.js v22.23.3 http2.connect implementation"
  - id: connect-node-options
    resource: "https://github.com/connectrpc/connect-es/blob/v1.7.0/packages/connect-node/src/node-transport-options.ts"
    title: "Connect-ES Node transport options at v1.7.0"
  - id: connect-node-client
    resource: "https://github.com/connectrpc/connect-es/blob/v1.7.0/packages/connect-node/src/node-universal-client.ts"
    title: "Connect-ES Node HTTP/2 client at v1.7.0"
  - id: connect-grpc-transport
    resource: "https://github.com/connectrpc/connect-es/blob/v1.7.0/packages/connect-node/src/grpc-transport.ts"
    title: "Connect-ES gRPC transport at v1.7.0"
  - id: grpc-js-channel
    resource: "https://github.com/grpc/grpc-node/blob/%40grpc%2Fgrpc-js%401.14.5/packages/grpc-js/src/channel.ts"
    title: "grpc-js Channel API at 1.14.5"
  - id: grpc-js-internal-channel
    resource: "https://github.com/grpc/grpc-node/blob/%40grpc%2Fgrpc-js%401.14.5/packages/grpc-js/src/internal-channel.ts"
    title: "grpc-js internal channel at 1.14.5"
  - id: tonic-incoming
    resource: "https://docs.rs/tonic/0.14.9/tonic/transport/server/struct.Router.html"
    title: "tonic 0.14.9 Router incoming stream server APIs"
  - id: tonic-uds-example
    resource: "https://github.com/hyperium/tonic/blob/tonic-v0.14.9/examples/src/uds/server.rs"
    title: "tonic Unix domain socket server example at 0.14.9"
  - id: tonic-build
    resource: "https://docs.rs/tonic-prost-build/0.14.9/tonic_prost_build/"
    title: "tonic-prost-build 0.14.9"
  - id: grpc-core-concepts
    resource: "https://github.com/grpc/grpc/blob/v1.70.0/CONCEPTS.md"
    title: "gRPC concepts and streaming at v1.70.0"
  - id: grpc-flow-control
    resource: "https://github.com/grpc/grpc/blob/v1.70.0/CONCEPTS.md"
    title: "gRPC HTTP/2 flow control at v1.70.0"
  - id: grpc-keepalive
    resource: "https://github.com/grpc/grpc/blob/v1.70.0/doc/keepalive.md"
    title: "gRPC Core keepalive guide at v1.70.0"
  - id: grpc-retry
    resource: "https://github.com/grpc/proposal/blob/80f4562cb5f659ab4c7c4ba07e83d9d29b495009/A6-client-retries.md"
    title: "gRPC retry design at the inspected proposal revision"
  - id: grpc-protocol
    resource: "https://github.com/grpc/grpc/blob/v1.70.0/doc/PROTOCOL-HTTP2.md"
    title: "gRPC HTTP/2 wire protocol at v1.70.0"
  - id: buildkit-session
    resource: "https://github.com/moby/buildkit/blob/v0.33.1/session/grpc.go"
    title: "BuildKit gRPC sessions over net.Conn at v0.33.1"
  - id: buildkit-ssh
    resource: "https://github.com/moby/buildkit/blob/v0.33.1/session/sshforward/ssh.go"
    title: "BuildKit session SSH forwarding at v0.33.1"
  - id: containerd-runtime
    resource: "https://github.com/containerd/containerd/blob/v2.1.0/core/runtime/v2/shim.go"
    title: "containerd runtime v2 shim transport setup"
  - id: containerd-ttrpc
    resource: "https://github.com/containerd/ttrpc/tree/v1.2.7"
    title: "containerd ttrpc project"
  - id: vscode-remote
    resource: "https://github.com/microsoft/vscode-docs/blob/1fe2a3edbeaf6c255e968d706ee350fb862b5d2c/docs/remote/ssh.md"
    title: "VS Code Remote SSH at the inspected commit"
  - id: ssh-manual
    resource: "https://man.openbsd.org/OpenBSD-7.6/ssh.1"
    title: "OpenSSH ssh(1), OpenBSD 7.6"
---

# gRPC over a child process stdio from Node and Rust

## Summary

**Finding, high confidence:** HTTP/2 is a byte-stream protocol. One HTTP/2 client and server can communicate through a full-duplex stream backed by child stdin and stdout. Node `http2.connect()` accepts a custom `createConnection` callback, and `tonic` accepts an incoming stream whose IO implements `AsyncRead`, `AsyncWrite` and `Connected`. The throwaway Rust and Node probe exchanged a unary response and server-streamed responses over this path. [^node-http2-connect-source][^tonic-incoming][^stdio-probe]

**Finding, high confidence:** Connect-ES can use the same Node hook. Its Node gRPC transport passes `nodeOptions` to `http2.connect()`. It also accepts a custom `sessionManager`. By contrast, grpc-js exposes a `Channel` abstraction and connection options, but no public API for supplying a connected HTTP/2 `Duplex`. Its supported Unix-domain-socket target is the straightforward local path when grpc-js is required. [^connect-node-options][^connect-grpc-transport][^grpc-js-channel][^grpc-js-internal-channel]

**Recommendation, moderate confidence:** Keep the daemon on a local Unix socket and make `attach --stdio` relay socket bytes to process stdin and stdout. Use Connect-ES with a dedicated, single-session `Duplex` adapter for SSH and local child transports. Choose grpc-js only when Node connects to a Unix socket or a socket tunnel. This separates daemon lifecycle from the transport process and avoids custom grpc-js internals.

This report answers the transport question for the selected Node and Rust libraries. It does not select the final Machine API or settle deployment behavior.

## What the prototype established

The scratch prototype was outside the repository at `/tmp/grpc-stdio-proto`.
That directory is absent in the current checkout environment, so its source and
raw output could not be recovered or independently reproduced. The measurements
below are the contemporaneous record of the probe, not a runnable artifact.
The Rust side used `tonic` 0.14.9, `tonic-prost-build` 0.14.9, `prost` 0.14.6,
Tokio 1.54.1 and `protoc` 36.2. The Node side used Node v22.23.3, Connect-ES
1.7.0, Connect Node 1.7.0 and generated protobuf code using `protoc-gen-es`
1.10.1. Buf was 1.75.0.
The Rust service implemented a unary echo method and a server-streaming method. `tonic::transport::Server::serve_with_incoming()` served one `tokio::io::DuplexStream`. Two `tokio::io::copy()` loops relayed bytes between that stream and the process stdin and stdout. The Node probe spawned this server, combined `child.stdout` and `child.stdin` using `Duplex.from()`, and passed that duplex to Node `http2.connect({ createConnection })`.

Exact build and generation commands were:

```sh
nix shell nixpkgs#protobuf --command cargo build --release
pnpm install --no-frozen-lockfile
nix shell nixpkgs#buf --command bash -c 'PATH="$PWD/node_modules/.bin:$PATH" buf generate'
pnpm exec tsc
node h2raw.mjs
node h2raw.mjs --stream --kill
```

The build completed. `buf generate` emitted Connect service descriptors and protobuf messages from the same `echo.proto`. The unary call returned HTTP/2 status 200, one framed protobuf response, and `grpc-status: 0`. The server stream returned ordered `hello:0` and `hello:1` messages before the test killed its child with SIGKILL.

The manually written Connect-ES client probe did not pass. It reported `ConnectError 13 [internal] Parse Error: Expected HTTP/, RTSP/ or ICE/`. The same stream adapter succeeded with direct Node `http2.connect()` in the raw gRPC probe. The cause was not isolated, so this is not evidence against Connect-ES support. It means the end-to-end Connect-ES adapter still needs a focused integration test before adoption. The raw probe validated HTTP/2 bytes and gRPC framing, not generated Connect service invocation. [^stdio-probe]

When the server child was killed mid-stream, the test received its first two messages and observed the child exit as `signal=SIGKILL`. The raw harness did not observe a stream `error` or trailers before its five-second teardown. A caller must bind child exit to destruction of the owned HTTP/2 session and verify the client library's error mapping. This probe therefore confirms transport death, not a stable client error code.

The helper relied on this compact framing and relay shape:

```rust
let (server_io, relay_io) = tokio::io::duplex(65_536);
let incoming = once(Ok(server_io));
tokio::spawn(async move {
    let (mut read, mut write) = tokio::io::split(relay_io);
    tokio::select! {
        _ = tokio::io::copy(&mut stdin(), &mut write) => {},
        _ = tokio::io::copy(&mut read, &mut stdout()) => {},
    }
});
Server::builder().add_service(service).serve_with_incoming(incoming).await?;
```

The production implementation needs a stream of incoming connections that does not end after its first item. It also needs explicit cancellation when either side closes. The snippet omits those lifecycle details.

## Node client transports

### Connect-ES

Connect Node exposes `createGrpcTransport()` for native gRPC over Node HTTP/2. The transport options accept Node HTTP/2 `nodeOptions`, which are passed to `http2.connect()`. Node's core API allows `createConnection` to return the connection stream. The hook can therefore return a duplex built over one child stdout readable and one child stdin writable. [^connect-node-options][^connect-grpc-transport][^node-http2-connect-source]
The client issues requests through a session manager and exposes response bodies as streams. [^connect-node-client]

A minimal shape is:

```ts
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
const io = Duplex.from({ readable: child.stdout, writable: child.stdin });
const transport = createGrpcTransport({
  baseUrl: "http://machine.invalid",
  nodeOptions: { createConnection: () => io },
});
```

This gives one byte connection, not an address that can safely be dialed repeatedly. A channel reconnect requires a new attach process and a new duplex. It must not return a destroyed or already-consumed child stream. `sessionManager` is the Connect extension point for pooling and lifetime management, and a single session manager can hold the one attach connection. A generic retry that replays an application call after disconnection is unsafe unless the method is idempotent. [^connect-node-options][^grpc-retry]

The probe demonstrated Node HTTP/2 core with the callback. The Connect-specific integration failed as recorded above, so confidence in the public option is high from source, while confidence in this exact runtime wiring is moderate pending the integration test.

### grpc-js

At v1.14.5, grpc-js exposes `ChannelImplementation(target, credentials, options)`, and it owns an internal `InternalChannel`. The public `Channel` contract can query state, close the channel and create calls. It does not accept a `net.Socket`, a `Duplex`, or a pre-established HTTP/2 session. No public custom transport dialer appeared in the inspected channel API. [^grpc-js-channel][^grpc-js-internal-channel]

A grpc-js client can target a Unix-domain socket through its normal address resolver. In this architecture, grpc-js can connect to the Machine's local daemon socket. For an SSH route, the Node process would need to tunnel a local socket or use another process to bridge an accepted local socket to the SSH stdio channel. Direct stdio injection requires a private grpc-js implementation or a change upstream, so neither is recommended.

## Rust server and attach relay

`tonic` server `serve_with_incoming()` accepts a stream of IO connections. Each connection must implement Tokio `AsyncRead` and `AsyncWrite`, tonic `Connected`, `Unpin`, `Send` and `'static`. This lets a server host an HTTP/2 connection over a process pipe without a TCP listener. The prototype used a `DuplexStream` wrapper that implemented `Connected` for tonic. [^tonic-incoming][^stdio-probe]

For the daemon socket, tonic has a Unix-domain-socket example using `UnixListener`, `UnixListenerStream` and `serve_with_incoming()`. The attach process can connect to that Unix socket and run a bidirectional copy: stdin to the socket, and socket to stdout. On the host it can start or locate the daemon before connecting. On a remote Machine, SSH carries the child process's stdin and stdout as the same byte stream. `ssh` also supports Unix socket forwarding, but that alternative exposes a local listening socket rather than using the stated `attach --stdio` contract. [^tonic-uds-example][^ssh-manual]

Stdio has no in-band process lifecycle signal separate from EOF. The relay should half-close the corresponding side on EOF, cancel its sibling copy when the socket or process ends, and reserve stderr for diagnostics. It must not print startup output to stdout, because any extra byte corrupts the HTTP/2 preface and frames. **Inference, high confidence:** one attach process should own one HTTP/2 connection. Multiple client connections require multiple attach sessions or a local socket endpoint that accepts independent connections.

## Disconnects, keepalive and reconnect

A clean or abrupt SSH closure breaks the HTTP/2 transport. An in-flight unary call can fail even if the server already performed the operation, because the response may have been lost. A streaming call ends without a normal gRPC trailers frame if the connection disappears. gRPC defines call completion and status as local observations, so the server may consider a call complete while the client reports failure. The exact surfaced status depends on each Node client and the point of failure. The prototype observed child exit but did not establish a stable error code. [^grpc-core-concepts][^grpc-protocol][^stdio-probe]

A retry establishes a new connection. It does not resume a server or bidirectional stream from its prior message offset. gRPC retry behavior depends on service configuration and whether the RPC has been committed. Application-level retries need idempotency or a request identifier. For this Machine transport, restart `attach` and create a fresh channel after connection loss. Do not silently replay arbitrary tool calls. [^grpc-retry]

Connect Node exposes client keepalive pings through `pingIntervalMs`, `pingTimeoutMs` and `pingIdleConnection`. Tonic's server builder has HTTP/2 keepalive settings. Keepalive can detect a dead peer while a connection is otherwise idle, but it cannot make a broken SSH pipe resumable. Server policy must permit the chosen ping rate. gRPC documents that overly aggressive pings can lead the server to send `GOAWAY` with `too_many_pings`. [^connect-node-options][^grpc-keepalive]

No keepalive value was benchmarked here. A per-call deadline remains necessary for operations that could hang during an undetected failure. The reconnect owner should treat the child exit, stream close and session close as one failed connection and settle all in-flight calls.

## Streaming and flow control

HTTP/2 and gRPC support unary, server-streaming, client-streaming and bidirectional-streaming RPCs. A pair of independent readable and writable directions preserves the full duplex needed for request and response traffic. The prototype directly exercised unary and server streaming. The framing and transport are the same for bidirectional calls, but the bidirectional method was not exercised. [^grpc-core-concepts][^stdio-probe]

HTTP/2 flow control applies to streaming data. It provides both stream and connection windows, and a sender must stop when the receiver has no advertised capacity. The HTTP/2 initial window is 65,535 bytes until either side advertises another value. Node can set window sizes with session settings, and tonic exposes HTTP/2 window configuration. The relay must propagate backpressure rather than collect unbounded data in JS or Rust buffers. A large output stream should be consumed incrementally. [^grpc-flow-control][^node-http2-v22][^tonic-incoming]

Flow-control windows are not gRPC message-size limits. A single protobuf message can be much larger than a window because HTTP/2 carries it in frames over time. Each client and server also has its own per-message decoding and encoding limits. Connect Node exposes `readMaxBytes` and `writeMaxBytes`. Tonic exposes maximum decoding and encoding message sizes. Configure these limits for the Machine's file read and job output semantics rather than increasing windows as a substitute. The defaults were not measured in the prototype. [^connect-grpc-transport][^tonic-incoming]

## Code generation and toolchain

A shared `.proto` definition is viable. The probe used Buf 1.75.0 to run
`protoc-gen-es` and `protoc-gen-connect-es` over the schema and produce typed
service descriptors and protobuf message classes. Rust `tonic-prost-build`
generated prost messages and tonic server traits during `cargo build`. The
generator package versions must match the protobuf runtime generation: this
probe used Connect 1.7.0 with protobuf 1.10.1. [^tonic-build][^stdio-probe]

The Rust build used `tonic` and `tonic-prost-build` 0.14.9 and `prost` 0.14.6. `protoc` was needed for the Rust build, while Buf invoked its local Node plugin binaries. An initial call to the Nix development environment's `protoc` failed with a GLIBC version mismatch. Running `nix shell nixpkgs#protobuf --command ...` supplied working `protoc` 36.2. This is a toolchain environment issue, not a protobuf incompatibility.

The prototype did not compare generated source size, build times, compile-time type checks or maintenance across Connect-ES and grpc-js. Connect-ES generated descriptor-based typed clients from the proto. grpc-js can use dynamic `@grpc/proto-loader` definitions or generated stubs from the grpc-js toolchain. Generated-code quality is therefore an engineering trade-off, not an experimentally ranked outcome here. The same proto should remain the source of truth whichever Node client is selected.

## Prior art

- **BuildKit** serves gRPC directly over an already-open Go `net.Conn`. Its session source wraps that connection in the HTTP/2 server and supplies the same connection to a gRPC custom context dialer. BuildKit also uses its session transport to forward SSH credentials. This is close prior art for a byte stream as the transport, although it is Go rather than Node or Rust. [^buildkit-session][^buildkit-ssh]
- **containerd runtime v2** starts runtime shims and connects using an advertised endpoint. Its documented/runtime code supports gRPC and ttrpc endpoints, including Unix sockets. ttrpc is a separate compact RPC protocol, not gRPC carried over stdio. This demonstrates a daemon-to-shim local endpoint model rather than the exact pipe transport. [^containerd-runtime][^containerd-ttrpc]
- **VS Code Remote SSH** starts or connects to a remote VS Code Server and forwards communication through its SSH integration. The user-facing documentation describes a remote server and SSH connection, not a stable public gRPC-over-stdio contract. It is useful lifecycle and deployment prior art, but not evidence for a reusable Node HTTP/2 Duplex API. [^vscode-remote]
- **OpenSSH** can execute a remote command with stdin and stdout connected to the local process. It can also forward a local Unix socket to a remote Unix socket with `-L`. The command stream carries bytes; the application protocol must supply framing and lifecycle. [^ssh-manual]

## Decision comparison

| Route                                                           | Node API fit                                                                                                                        | Additional process/socket                                                                               | Reconnect and failure boundary                                                        | Evidence confidence                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Connect-ES with `nodeOptions.createConnection` over child stdio | Publicly configurable through Node HTTP/2 options. Direct HTTP/2 probe works. The Connect service integration needs a focused test. | One child per live session. A wrapper must join stdout and stdin and destroy the session on child exit. | A lost pipe fails in-flight calls. Start a new child and channel. No stream resume.   | High for source API and raw HTTP/2. Moderate for Connect integration. |
| grpc-js directly over child stdio                               | No public connected-Duplex API found in the inspected v1.14.5 channel interface.                                                    | Requires private internals or a socket bridge.                                                          | Socket or process closure fails active calls. Reconnect through a new socket/channel. | High for lack of a public entry point in the inspected release.       |
| grpc-js over a local daemon Unix socket                         | Supported using its normal socket target.                                                                                           | Daemon owns the socket. Remote callers need socket forwarding or a separate attach bridge.              | Socket closure fails active calls. Reconnect to a new socket connection.              | High for tonic socket support.                                        |
| Connect-ES or grpc-js through a TCP or Unix socket bridge       | Uses ordinary socket transports.                                                                                                    | Adds a listening endpoint or forwarding lifecycle.                                                      | Socket and channel lifecycle are conventional, but forwarding must be supervised.     | High for OpenSSH forwarding and tonic UDS support.                    |

## Confidence and limits

Confidence is high for Node's `http2.connect()` custom connection hook, tonic's generic incoming IO requirements, tonic's Unix socket example, and gRPC streaming and flow-control semantics. The raw prototype exercised one unary and one server-streaming RPC over a child stdio byte path.

Confidence is moderate for Connect-ES use with the exact stdio adapter. Its public source passes custom Node options into `http2.connect()`, but the generated Connect client probe failed with a parsing error that this work did not isolate. The raw Node HTTP/2 client worked against the same Rust server. The mid-stream child-kill test observed the child exit and delivered two messages, but did not observe a stable client error event before harness teardown.

No grpc-js stdio injection was implemented. The conclusion comes from the inspected public API and channel implementation at v1.14.5. No reconnect timing, large payload benchmark, SSH network interruption, bidirectional stream probe, keepalive setting, macOS behavior or cross-platform pipe semantics were tested. The report does not make a performance claim.

[^node-http2-v22]: Node v22.23.3 documentation describes the HTTP/2 core API and its connection/session options. [Node.js HTTP/2](https://nodejs.org/docs/v22.23.3/api/http2.html).

[^node-http2-connect-source]: Node v22.23.3 calls `options.createConnection(authority, options)` when provided to `http2.connect()`, then constructs a `ClientHttp2Session` on the returned socket-like stream. [Node source](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/http2/core.js).

[^connect-node-options]: Connect Node's HTTP/2 transport exposes `nodeOptions` for the built-in `http2.connect()` options. It also exposes a session manager option. [Node transport options at v1.7.0](https://github.com/connectrpc/connect-es/blob/v1.7.0/packages/connect-node/src/node-transport-options.ts).

[^connect-node-client]: Connect Node implements HTTP/2 requests by issuing requests on a `NodeHttp2ClientSessionManager` and passing responses through streams. [Node client at v1.7.0](https://github.com/connectrpc/connect-es/blob/v1.7.0/packages/connect-node/src/node-universal-client.ts).

[^connect-grpc-transport]: `createGrpcTransport()` fixes HTTP version 2 and supports per-message `readMaxBytes` and `writeMaxBytes`. [gRPC transport at v1.7.0](https://github.com/connectrpc/connect-es/blob/v1.7.0/packages/connect-node/src/grpc-transport.ts).

[^grpc-js-channel]: `ChannelImplementation` accepts a target string, credentials and channel options, and creates an internal channel. Its public API does not take a connected socket. [grpc-js channel at 1.14.5](https://github.com/grpc/grpc-node/blob/%40grpc%2Fgrpc-js%401.14.5/packages/grpc-js/src/channel.ts).

[^grpc-js-internal-channel]: grpc-js creates its own subchannels and transport connections through `InternalChannel` and its subchannel modules. [grpc-js internal channel at 1.14.5](https://github.com/grpc/grpc-node/blob/%40grpc%2Fgrpc-js%401.14.5/packages/grpc-js/src/internal-channel.ts).

[^tonic-incoming]: tonic's `serve_with_incoming()` accepts a stream of IO objects implementing Tokio `AsyncRead`, `AsyncWrite` and tonic `Connected`. [tonic 0.14.9 Router API](https://docs.rs/tonic/0.14.9/tonic/transport/server/struct.Router.html).

[^tonic-uds-example]: tonic's Unix socket example binds `UnixListener`, wraps it in `UnixListenerStream` and serves it through `serve_with_incoming()`. [tonic example at 0.14.9](https://github.com/hyperium/tonic/blob/tonic-v0.14.9/examples/src/uds/server.rs).

[^tonic-build]: `tonic-prost-build` compiles protobuf service definitions and generates tonic and prost code. [tonic-prost-build 0.14.9](https://docs.rs/tonic-prost-build/0.14.9/tonic_prost_build/).

[^grpc-core-concepts]: gRPC defines unary and streaming RPCs, and each side determines call success locally. [gRPC concepts at v1.70.0](https://github.com/grpc/grpc/blob/v1.70.0/CONCEPTS.md).

[^grpc-flow-control]: gRPC uses the underlying HTTP/2 flow-control mechanism to manage in-flight messages. [gRPC concepts at v1.70.0](https://github.com/grpc/grpc/blob/v1.70.0/CONCEPTS.md).

[^grpc-keepalive]: gRPC Core keepalive uses HTTP/2 PING frames and documents server enforcement against overly frequent pings. [Keepalive guide at v1.70.0](https://github.com/grpc/grpc/blob/v1.70.0/doc/keepalive.md).

[^grpc-retry]: Retry behavior depends on policy and whether the RPC is committed. [gRFC A6 at the inspected revision](https://github.com/grpc/proposal/blob/80f4562cb5f659ab4c7c4ba07e83d9d29b495009/A6-client-retries.md).

[^grpc-protocol]: The gRPC wire protocol maps each RPC to an HTTP/2 stream and carries message frames and final status. [gRPC HTTP/2 protocol at v1.70.0](https://github.com/grpc/grpc/blob/v1.70.0/doc/PROTOCOL-HTTP2.md).

[^buildkit-session]: BuildKit calls `http2.Server.ServeConn()` on its supplied `net.Conn`, and uses the connection as a gRPC custom dialer's result. [BuildKit source at v0.33.1](https://github.com/moby/buildkit/blob/v0.33.1/session/grpc.go).

[^buildkit-ssh]: BuildKit's SSH forwarder participates in the BuildKit session service. [BuildKit SSH forwarder at v0.33.1](https://github.com/moby/buildkit/blob/v0.33.1/session/sshforward/ssh.go).

[^containerd-runtime]: containerd runtime v2 shim setup uses its configured protocol and endpoint to choose a gRPC or ttrpc connection. [containerd shim source at v2.1.0](https://github.com/containerd/containerd/blob/v2.1.0/core/runtime/v2/shim.go).

[^containerd-ttrpc]: ttrpc is containerd's separate RPC library. [containerd/ttrpc v1.2.7](https://github.com/containerd/ttrpc/tree/v1.2.7).

[^vscode-remote]: VS Code Remote SSH documents connecting to a remote machine through a VS Code Server. [Remote SSH at the inspected commit](https://github.com/microsoft/vscode-docs/blob/1fe2a3edbeaf6c255e968d706ee350fb862b5d2c/docs/remote/ssh.md).

[^ssh-manual]: `ssh` can execute a remote command and forward Unix sockets with `-L`. [OpenSSH ssh(1), OpenBSD 7.6](https://man.openbsd.org/OpenBSD-7.6/ssh.1).

[^stdio-probe]: The prototype path `/tmp/grpc-stdio-proto` was absent when this note was updated. The recorded test source and raw output are unavailable; versions, commands, outcomes and the limits of the probe above are preserved from the study record and cannot now be independently rerun.
