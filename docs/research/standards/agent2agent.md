---
type: Reference
title: "A2A (Agent2Agent Protocol)"
description: "Task protocol between independent agents; candidate remote executor adapter"
resource: "https://a2a-protocol.org/latest/specification/"
observed:
  date: "2026-09-27"
  revision: "72b3761bd84c59291da694dcd97cdfc2c010df39"
sources:
  - id: a2a-spec
    resource: "https://a2a-protocol.org/latest/specification/"
    title: "A2A protocol specification"
  - id: a2a-proto
    resource: "https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/specification/a2a.proto#L1-L300"
    title: "A2A Protocol Buffer definitions"
  - id: a2a-v1-release
    resource: "https://a2a-protocol.org/latest/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/"
    title: "A2A v1.0 release"
  - id: a2a-governance
    resource: "https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/GOVERNANCE.md"
    title: "A2A governance"
  - id: ibm-acp-merge
    resource: "https://github.com/orgs/i-am-bee/discussions/5"
    title: "IBM Agent Communication Protocol merges into A2A"
  - id: a2a-spec-security
    resource: "https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/docs/specification.md#L1877-L1905"
    title: "A2A transport security and server authentication"
  - id: a2a-spec-authz
    resource: "https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/docs/specification.md#L3081-L3108"
    title: "A2A data access and authorization scoping"
---

# A2A (Agent2Agent Protocol)

- **Status:** v1.0.0 released 2026-03-12, breaking from 0.3; Linux Foundation
  project with a technical steering committee from Google, Microsoft, Cisco,
  AWS, Salesforce, ServiceNow, SAP and IBM; Apache-2.0[^a2a-v1-release][^a2a-governance]

A protocol between independent, possibly opaque agents. IBM's Agent
Communication Protocol, also abbreviated ACP, merged into A2A in August
2025[^ibm-acp-merge]; it is unrelated to the
[Agent Client Protocol](./agent-client-protocol.md).

**Mechanics**[^a2a-spec][^a2a-proto]

1. **Agent Card** at `/.well-known/agent-card.json`: identity, interfaces,
   skills, media modes and security schemes; optionally JWS-signed over the
   RFC 8785 canonical form.
2. **Task** with a server-generated `id`, optional `contextId`, `status`,
   optional `history` and `artifacts`. States: submitted, working,
   input-required, auth-required, then completed, failed, canceled or rejected.
3. **Message and Part.** A Part is exactly one of text, bytes, URL or
   structured data. Retained history may omit transient messages.
4. **Bindings.** JSON-RPC over HTTP, gRPC and HTTP+JSON; streaming over SSE;
   push notifications to a registered webhook.
5. **Extensions** are URI-identified in the Agent Card; `required: true` makes
   unsupported clients fail. An opaque `tenant` field routes multi-tenant
   servers.

**Identity ownership.** A2A has no session object. The server mints Task IDs
and may mint, use and expire `contextId`, so the peer owns executor-side state
and history.

**llame fit: study as a remote executor adapter.** llame's Chat and Run stay
the system of record; Task and `contextId` are opaque external correlation.
The terminal states map onto Run outcomes, and `input-required` and
`auth-required` map onto approval and credential prompts. Prior art in
[qwen-audio-agent](../harnesses/qwen-audio-agent.md) and
[Baro](../harnesses/baro.md).

**Caution:** the spec fixes enforcement but not policy. Servers must use
encrypted transport and authenticate every request[^a2a-spec-security], and
must check authorization on every operation, before any query that could leak
another caller's resources[^a2a-spec-authz]. The authorization model, retained
history and credential issuance remain agent-defined, so a client cannot
assume complete replay. Signed cards are optional and prove nothing without a
trusted key source.

[^a2a-spec]: [A2A protocol specification](https://a2a-protocol.org/latest/specification/)

[^a2a-proto]: [A2A Protocol Buffer definitions](https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/specification/a2a.proto#L1-L300)

[^a2a-v1-release]: [A2A v1.0 release](https://a2a-protocol.org/latest/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/)

[^a2a-governance]: [A2A governance](https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/GOVERNANCE.md)

[^ibm-acp-merge]: [IBM Agent Communication Protocol merges into A2A](https://github.com/orgs/i-am-bee/discussions/5)

[^a2a-spec-security]: [A2A transport security and server authentication](https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/docs/specification.md#L1877-L1905)

[^a2a-spec-authz]: [A2A data access and authorization scoping](https://github.com/a2aproject/A2A/blob/72b3761bd84c59291da694dcd97cdfc2c010df39/docs/specification.md#L3081-L3108)
