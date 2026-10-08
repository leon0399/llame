---
type: Reference
title: "A2UI (Agent-to-User Interface)"
description: "Declarative, streaming JSON format for agent-generated UI rendered from a client-owned component catalog; candidate owner-input and structured-result surface for llame"
resource: "https://a2ui.org/"
tags:
  - generative-ui
  - declarative-ui
  - component-catalog
  - streaming
  - protocol
status: draft
generated:
  by: "claude-code/claude-opus-5-5"
  at: "2026-10-08"
observed:
  date: "2026-10-08"
  revision: "db4306536438df46e4f0443b9c4ec0d5f1a42dc4"
sources:
  - id: a2ui-readme
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/README.md#L12-L98"
    title: "A2UI README: status, philosophy, use cases and architecture"
  - id: a2ui-license
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/LICENSE#L1-L3"
    title: "A2UI repository license (Apache 2.0)"
  - id: a2ui-roadmap
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/roadmap.md#L5-L50"
    title: "A2UI roadmap: protocol versions, renderers, transports"
  - id: a2ui-spec-overview
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L11-L78"
    title: "A2UI v0.9.1 protocol overview, message types and prompt-first model"
  - id: a2ui-spec-transport
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L80-L122"
    title: "A2UI v0.9.1 transport contract and bindings"
  - id: a2ui-spec-catalog
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L124-L171"
    title: "A2UI v0.9.1 schemas and swappable catalogs"
  - id: a2ui-spec-messages
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L173-L293"
    title: "A2UI v0.9.1 envelope messages and example stream"
  - id: a2ui-spec-components
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L294-L394"
    title: "A2UI v0.9.1 component model, adjacency list and actions"
  - id: a2ui-spec-binding
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L395-L521"
    title: "A2UI v0.9.1 data binding, scope and two-way input"
  - id: a2ui-spec-functions
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L595-L726"
    title: "A2UI v0.9.1 registered functions, basic catalog and attribution"
  - id: a2ui-spec-validation
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L781-L863"
    title: "A2UI v0.9.1 generate-validate loop and client-to-server messages"
  - id: a2ui-ext-a2a
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_extension_specification.md#L9-L58"
    title: "A2UI v0.9.1 A2A extension: URI, activation and capabilities"
  - id: a2ui-ext-a2a-part
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_extension_specification.md#L172-L180"
    title: "A2UI v0.9.1 A2A DataPart encoding"
  - id: a2ui-v1-evolution
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v1_0/docs/evolution_guide.md#L5-L70"
    title: "A2UI v0.9 to v1.0 evolution guide"
  - id: a2ui-actions-security
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/actions.md#L282-L296"
    title: "A2UI action security considerations"
  - id: a2ui-actions-scraping
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/actions.md#L413-L413"
    title: "A2UI state-scraping warning for orchestrators"
  - id: a2ui-catalog-validation
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/catalogs.md#L439-L456"
    title: "A2UI two-phase validation and graceful degradation"
  - id: a2ui-transports
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/transports.md#L17-L50"
    title: "A2UI transports: A2A, AG-UI and custom"
  - id: a2ui-renderers
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/reference/renderers.md#L10-L35"
    title: "A2UI maintained and ecosystem renderers"
  - id: a2ui-renderers-community
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/ecosystem/renderers.md#L11-L30"
    title: "A2UI community renderers"
  - id: a2ui-landscape
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/index.md#L142-L156"
    title: "A2UI landscape architect demo description"
  - id: a2ui-over-mcp
    resource: "https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/guides/a2ui_over_mcp.md#L1-L3"
    title: "A2UI over MCP guide"
---

# A2UI (Agent-to-User Interface)

- **Status:** Apache-2.0 open-source project with a format and renderers.[^a2ui-license]
  The README calls it an early-stage public preview and warns to expect changes.
  v0.9.1 is the current production release, v1.0 is a release candidate and v0.8 is
  legacy.[^a2ui-readme][^a2ui-roadmap] This entry describes v0.9.1 unless it says
  v1.0. The repository is `a2ui-project/a2ui`.

A2UI lets an agent describe a UI as declarative JSON. The client keeps a catalog of
components it trusts, and the agent can only request components from that
catalog. The project's phrase is "safe like data, but expressive like code".[^a2ui-readme]
It is a UI format, not an agent-to-user session protocol: a transport (A2A,
AG-UI, MCP, SSE, WebSockets, REST) delivers the messages.[^a2ui-spec-transport]

**Study**

1. **Four message types over a stream of JSON objects.** `createSurface` fixes a
   `surfaceId` and `catalogId`; `updateComponents` sends a flat list of
   `{ id, component, ...props }` objects; `updateDataModel` replaces the value at a
   JSON Pointer `path` (or the whole model when `path` is omitted); `deleteSurface`
   removes the surface. Each streamed object carries exactly one of those keys.
   Exactly one component must have the id `root`, and updates that arrive before it
   are buffered.[^a2ui-spec-messages][^a2ui-spec-components] **High confidence.**
   Unlike json-render's SpecStream, A2UI does not use RFC 6902 patches. State and
   structure are separate messages, so a component list and its data can stream
   independently.

2. **Flat adjacency list with ids, so an LLM can emit it incrementally.** Containers
   reference children by id or generate children from a data-bound list with a
   template. The client rebuilds the tree, renders placeholders for references that
   have not arrived, and skips invalid ones.[^a2ui-spec-components] json-render also
   uses a flat `{ root, elements }` map; the two differ in message grain, not in
   tree model.

3. **The catalog is a JSON Schema document, identified by a string.** Every
   `createSurface` names a `catalogId`, which is an agreed identifier and need not be
   resolvable. The envelope schema is catalog-agnostic and references a placeholder
   `catalog.json`, so a client validates against the basic catalog or its own.
   Catalogs declare components, functions and a theme.[^a2ui-spec-catalog][^a2ui-spec-messages]
   The basic catalog has 18 components, among them `Text`, `Image`, `Row`, `Column`,
   `List`, `Card`, `Tabs`, `Modal`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`,
   `DateTimeInput` and `Slider`.[^a2ui-spec-functions] Clients advertise
   `supportedCatalogIds` and may send `inlineCatalogs`; servers advertise which
   catalogs they can generate.[^a2ui-spec-validation] json-render declares its
   catalog in Zod in application code; A2UI's is schema data that can cross a
   process or trust boundary.

4. **Data binding with local two-way inputs and explicit actions.** Properties are a
   literal, a `path`, or a `FunctionCall`. Input components write to the local data
   model immediately, with no network traffic; the model reaches the server only when
   a `Button` action fires an `event` with a `name` and a `context` that can reference
   modified paths. `sendDataModel: true` additionally attaches the surface data
   model, keyed by `surfaceId`, as transport metadata.[^a2ui-spec-binding][^a2ui-spec-components][^a2ui-spec-messages]
   The client-to-server `action` carries `name`, `surfaceId`, `sourceComponentId`,
   `timestamp` and `context`.[^a2ui-spec-validation] Local actions call a registered
   function such as `openUrl`; the server sends names, never code.[^a2ui-spec-functions]

5. **Prompt-first generation needs a validate-and-retry loop.** v0.9 embeds the
   catalog and examples in the prompt instead of using structured output, trading
   guaranteed shape for a richer schema and requiring post-generation validation.
   The spec defines a `VALIDATION_FAILED` error (`surfaceId`, JSON pointer `path`,
   `message`) for feeding errors back to the model.[^a2ui-spec-overview][^a2ui-spec-validation]
   The docs describe validation on the agent before sending and again on the client,
   with graceful degradation to text or placeholders.[^a2ui-catalog-validation]
   **Moderate confidence** on how complete the shipped SDK validators are; only the
   documentation was read.

6. **Transports and ecosystem.** Over A2A, each envelope is the payload of one
   `DataPart` marked `mimeType: application/a2ui+json`, with capabilities in message
   metadata and the A2A `contextId` as session.[^a2ui-spec-transport][^a2ui-ext-a2a-part][^a2ui-ext-a2a]
   AG-UI is listed as a stable transport that translates A2UI to AG-UI events.[^a2ui-transports]
   An MCP guide serves A2UI from tools and embedded resources.[^a2ui-over-mcp]
   Maintained renderers: React, Lit, Angular and Flutter (GenUI SDK), with Jetpack
   Compose at alpha, SwiftUI planned and community renderers for Vue, Svelte, Lynx,
   MUI and Ink.[^a2ui-renderers][^a2ui-renderers-community] The roadmap lists a shadcn (React) renderer as
   proposed only.[^a2ui-roadmap] Cross-link: [json-render](./json-render.md) accepts
   A2UI as an input schema.

7. **v1.0 candidate changes the wire, so a pin must name a version.** It renames
   server/client to agent/renderer, prefixes data-binding keys with `@`, adds
   agent-to-renderer and renderer-to-agent function calls, lets one surface mix
   catalogs, removes `theme`, adds catalog `allowedParents`/`allowedChildren` and
   `requiresUserActivation` for functions such as `openUrl`, and allows components
   inside `createSurface`.[^a2ui-v1-evolution] Maintained renderers list v1.0 as
   planned.[^a2ui-renderers]

**Demo.** The landscape architect demo (a2ui.org) is a video: the user uploads a
photo, and the agent uses Gemini to understand it and generate a custom form for
landscaping needs.[^a2ui-landscape] The demo supports the "agent invents an
input form from context" claim, not any claim about security or reliability. No
demo source was run for this entry.

**Comparison**

|                    | A2UI                                   | json-render                       | AG-UI                                            |
| ------------------ | -------------------------------------- | --------------------------------- | ------------------------------------------------ |
| Layer              | UI format                              | UI spec framework                 | Run event protocol                               |
| Unit               | Surface: components + data model       | Spec: `{ root, elements }`        | Event stream                                     |
| Streaming          | JSONL envelopes                        | JSONL JSON Patch ops              | Typed events (SSE)                               |
| Catalog            | JSON Schema, `catalogId`, client-owned | Zod in app code                   | None                                             |
| Back to agent      | `action` with `context`                | Named actions run by app handlers | Next-run tool message or `resume`                |
| Carries the others | Over A2A, AG-UI, MCP                   | Accepts A2UI input                | Carries A2UI, MCP Apps (see [AG-UI](./ag-ui.md)) |

**llame fit: study.** Confidence is moderate, and the protocol itself still
moves, so track its releases while studying it. llame renders stored
`messages.parts` through fixed `@workspace/ui` elements, and the repository rule
requires a spec for any new replay transform or part type. An A2UI surface would be
a stored part type, so adopting it is a spec decision, not a library install.
Applications, in rough order of value:

- **Owner-input forms (moderate).** Shipped tools do not ask the owner a
  structured question. `TextField`, `ChoicePicker`, `DateTimeInput` and an `action`
  with `context` cover a clarifying form better than free text. The answer must
  re-enter as an owner message or tool result in a new Run turn, validated
  against the declared form, never as an implicit Run mutation.
- **Structured tool results and artifacts (low-to-moderate).** A catalog mapped
  to shadcn primitives could render search results or a tabular `read` output.
  json-render's inline mode is the closer match to llame's parts model today. Large
  files belong behind llame's artifact boundary ([#41](https://github.com/leon0399/llame/issues/41)),
  not in a data model.
- **Approval UI (low, deferred).** An A2UI card with approve and deny buttons is
  trivially drawable, but current permissions fail closed and do not pause for a
  decision. The server must treat a returned `action` as untrusted input, not
  as authorization ([#778](https://github.com/leon0399/llame/issues/778)). See the
  interrupt discussion in [AG-UI](./ag-ui.md).
- **Channels (low).** A catalog is renderer-specific. A channel with its own
  widget set ([#42](https://github.com/leon0399/llame/issues/42)) needs its own
  catalog and a text fallback; the project's graceful-degradation guidance
  points the same way.

**Caution**

- **The catalog is the trust boundary, and the model writes the data.** A valid
  payload still holds model-authored strings, URLs and markdown. `Text` renders
  simple Markdown and `Image`, `Video` and `AudioPlayer` take URLs, so a catalog
  inherits URL fetching, link and tracking risk from prompt-injected content. This
  is an inference from the component list, moderate confidence. Allowlist
  components and functions per surface, keep `openUrl` behind user activation, and
  proxy or block remote media.
- **No code execution is not no effect.** Server actions reach the agent with an
  attacker-influenced `context`. Authorize them against the authenticated owner,
  Chat and Run exactly as any tool call; a button that exists is not a permission.
- **Data-model leakage.** `sendDataModel` puts the surface data model, keyed by `surfaceId`,
  in transport metadata. The docs call stripping unowned surfaces mandatory in multi-agent
  setups.[^a2ui-actions-security][^a2ui-actions-scraping] Do not enable it for
  surfaces whose model holds secrets or other Chats' data.
- **Attribution can be spoofed.** `agentDisplayName` and `iconUrl` in the theme are
  chosen by the agent; the spec has an orchestrator overwrite them with the verified
  identity.[^a2ui-spec-functions] llame must set them, never forward them.
- **Validation is weaker than schema-constrained output.** Prompt-first generation
  means invalid payloads are expected. Validate before persisting, persist only the
  validated form, and make replay re-validate against the pinned catalog version.
- **Version churn.** v0.9.1 and v1.0 are not wire-compatible, the project says to
  expect changes, and the shadcn renderer is unbuilt. Pin a protocol version and a
  `catalogId` in any adapter.

[^a2ui-readme]: [A2UI README: status, philosophy, use cases and architecture](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/README.md#L12-L98)

[^a2ui-license]: [A2UI repository license (Apache 2.0)](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/LICENSE#L1-L3)

[^a2ui-roadmap]: [A2UI roadmap: protocol versions, renderers, transports](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/roadmap.md#L5-L50)

[^a2ui-spec-overview]: [A2UI v0.9.1 protocol overview, message types and prompt-first model](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L11-L78)

[^a2ui-spec-transport]: [A2UI v0.9.1 transport contract and bindings](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L80-L122)

[^a2ui-spec-catalog]: [A2UI v0.9.1 schemas and swappable catalogs](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L124-L171)

[^a2ui-spec-messages]: [A2UI v0.9.1 envelope messages and example stream](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L173-L293)

[^a2ui-spec-components]: [A2UI v0.9.1 component model, adjacency list and actions](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L294-L394)

[^a2ui-spec-binding]: [A2UI v0.9.1 data binding, scope and two-way input](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L395-L521)

[^a2ui-spec-functions]: [A2UI v0.9.1 registered functions, basic catalog and attribution](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L595-L726)

[^a2ui-spec-validation]: [A2UI v0.9.1 generate-validate loop and client-to-server messages](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_protocol.md#L781-L863)

[^a2ui-ext-a2a]: [A2UI v0.9.1 A2A extension: URI, activation and capabilities](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_extension_specification.md#L9-L58)

[^a2ui-ext-a2a-part]: [A2UI v0.9.1 A2A DataPart encoding](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v0_9_1/docs/a2ui_extension_specification.md#L172-L180)

[^a2ui-v1-evolution]: [A2UI v0.9 to v1.0 evolution guide](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/specification/v1_0/docs/evolution_guide.md#L5-L70)

[^a2ui-actions-security]: [A2UI action security considerations](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/actions.md#L282-L296)

[^a2ui-actions-scraping]: [A2UI state-scraping warning for orchestrators](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/actions.md#L413-L413)

[^a2ui-catalog-validation]: [A2UI two-phase validation and graceful degradation](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/catalogs.md#L439-L456)

[^a2ui-transports]: [A2UI transports: A2A, AG-UI and custom](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/concepts/transports.md#L17-L50)

[^a2ui-renderers]: [A2UI maintained and ecosystem renderers](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/reference/renderers.md#L10-L35)

[^a2ui-renderers-community]: [A2UI community renderers](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/ecosystem/renderers.md#L11-L30)

[^a2ui-landscape]: [A2UI landscape architect demo description](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/index.md#L142-L156)

[^a2ui-over-mcp]: [A2UI over MCP guide](https://github.com/a2ui-project/a2ui/blob/db4306536438df46e4f0443b9c4ec0d5f1a42dc4/docs/public/guides/a2ui_over_mcp.md#L1-L3)
