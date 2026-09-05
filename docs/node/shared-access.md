# Common Node owner-access contract, version 1

This document describes the implemented `core`/`realm` access slice. See the
[architecture and operator guide](integration.md), the
[private IPC contract](local-protocol.md), and the
[capability spec](../../openspec/specs/node-access/spec.md).

## Transports and identity

Both deployments implement the operations from `@workspace/node-protocol`.
Personal access uses private IPC after its version-2 handshake. Hosted access
uses `POST /api/v1/node/requests`, authenticated by the existing opaque session
(cookie or Bearer) and governed by the existing session guard and RLS.

Hosted requests include `x-llame-node-version: 1` and
`x-llame-node-principal: EXPECTED_SESSION_USER_UUID`. Initial `core.describe` may
omit the principal assertion; other requests may not. The session always decides
the user. Supplying someone else's UUID fails before invoking a capability; the
header is not an identity, delegation, or enrollment credential.

No JSON-RPC batches or notifications are accepted over hosted HTTP. IDs are
nonempty strings of at most 100 code points. Unknown envelope/argument fields,
explicit null argument objects, incompatible versions, and unavailable methods
fail closed. Requests are at most 32 KiB; operation results are at most 128 KiB.
The HTTP handler uses a cooperative 30-second abort signal and cancels on
connection loss. This is not a hard process/resource sandbox for backend code.

## Discovery

```json
{
  "jsonrpc": "2.0",
  "id": "describe-1",
  "method": "core.describe",
  "params": {}
}
```

The result identifies `kind`, `nodeId`, `principal`, module versions, methods,
execution transport family, recall strategy/minimum query length, and Knowledge
kind. It explicitly sets `synchronization: false` and `enrollment: false`.

A hosted result has kind `shared-instance`, a `session-user` principal and null
`nodeId`: current authenticated account access is not an invented portable
replica identity. A personal result has kind `personal-node`, a `local-owner`
principal and its persisted runtime UUID as `nodeId`.

Discovery advertises the adapter's current permitted read methods, not a list of
all installed tools or a guarantee that a file remains available. Invocation
rechecks its gate. Query results carry native unavailability/coverage evidence.

## Four fixed operations

`realm.conversations.search` accepts `{query, limit?}`. The query is literal text,
nonblank, at most 200 Unicode code points, without NUL. Limit defaults to 5 and
is an integer from 1 to 10. Personal trigram recall requires at least three
characters; hosted canonical recall advertises a minimum of one. Human queries
have no initiating Chat to exclude; model recall retains its own context rules.

`realm.conversations.read` accepts `{chatId, messageSeq, offset?, limit?}`.
`chatId` is a UUID and `messageSeq` a positive safe integer. Offsets are zero-based
logical lines; `offset` defaults to 0 and `limit` to 100, bounded to 1–2000. These
are source locators, not global message ordering or replication cursors.

`realm.knowledge.search` accepts `{query, limit?}` with the same search bounds.
It returns a bounded first page across the currently owner-accessible spaces.
Existing native result metadata is preserved, including incomplete coverage and
continuation evidence. This contract does not yet accept hosted cursor/space
filters; returning a native cursor does not imply this Surface can consume it.

`realm.knowledge.read` accepts `{knowledgeSpaceId, path, offset?, limit?}` with
the same read bounds. The ID is a UUID; the path is relative to the authorized
Knowledge Space and at most 1024 code points. Absolute paths, drive prefixes,
backslashes, dot components and empty components are rejected. The existing
filesystem adapter remains responsible for safe actual resolution and reads.

No operation accepts `userId`, a credential, native flag, tool ID, host root,
Workspace registration, provider config, or approval. Model-executable tool
schemas and trusted Run context are not replaced by this human access API.

## Observation and errors

```json
{
  "jsonrpc": "2.0",
  "id": "read-1",
  "result": {
    "version": 1,
    "method": "realm.knowledge.read",
    "principal": {
      "kind": "session-user",
      "id": "11111111-1111-4111-8111-111111111111"
    },
    "source": {
      "kind": "shared-instance",
      "nodeId": null,
      "synchronized": false
    },
    "data": {
      "status": "success",
      "content": "1: Example owner note"
    }
  }
}
```

This is an envelope illustration, not the full native evidence DTO. The common
client validates correlation, version, method, principal, and source against
discovery. It preserves native `data` rather than pretending that FTS scoring,
source rendering, read failures, and coverage are identical between deployments.
The CLI prints native evidence with a namespaced `node` provenance field and the
configured authority (or null for local).

A protocol failure returns a correlated JSON-RPC error with a numeric code,
safe message, and `data: {code, exitCode}`. Malformed envelopes may have null ID.
Unknown exceptions are replaced with a generic operation failure; no stack,
resolved credential, or private exception text crosses this boundary. Auth and
outer HTTP errors retain their existing HTTP status. The client does not display
untrusted remote exception messages. Responses set `Cache-Control: no-store`.

## Hosted Run admission is a resource, not a generic RPC

`POST /api/v1/runs` requires the same session/version/principal binding and
accepts the existing validated message DTO plus `chatId`. Unknown fields are
rejected by the existing validation pipe. The route calls the same acceptance
transaction/dispatcher as `POST /api/v1/chats/:id/messages`.

Success is HTTP **202**, a relative `Location: /api/v1/runs/RUN_UUID`, and
`{runId, chatId, messageId}`. The client verifies those resource identities and
then attaches to existing durable Run events. There is no automatic retry or
fallback route for uncertain submissions. Duplicate message IDs retain the
existing conflict behavior; this is not a cross-connection idempotency service.

Inspection, cancellation and SSE events remain the existing hosted REST resources.
Private execution and approvals remain private IPC. Local admin methods never
cross the common owner-query endpoint. Discovery does not imply that the full
private execution/admin interface is exposed remotely.

## Contract source and change discipline

`packages/node-protocol/src` owns runtime validation, operation typing, owner
observation binding, and the OpenAPI extensions. Live API OpenAPI generation
uses those extensions. The new admission schema extends the existing generated
`CreateMessageDto`; it is not a hand-copied parallel user-message contract.

The checked-in extension equality test prevents the emitted common blocks from
drifting. It does not replace a real Nest OpenAPI build, actual controller tests,
or the RLS integration suite. Additions must have a concrete implementing backend
and declare availability; breaking private changes require a private version bump
independently of this common version line.
