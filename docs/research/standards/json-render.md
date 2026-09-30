---
type: Reference
title: "json-render (Vercel Labs)"
description: "Catalog-constrained generative UI streamed as JSON Patch lines"
resource: "https://json-render.dev/docs"
observed:
  date: "2026-09-27"
  revision: "c2600d73908ed505e6d726f5b6f969ba8f597ce7"
sources:
  - id: json-render-readme
    resource: "https://github.com/vercel-labs/json-render/blob/c2600d73908ed505e6d726f5b6f969ba8f597ce7/README.md"
    title: "json-render README"
  - id: json-render-changelog
    resource: "https://github.com/vercel-labs/json-render/blob/c2600d73908ed505e6d726f5b6f969ba8f597ce7/CHANGELOG.md"
    title: "json-render changelog"
  - id: json-render-catalog
    resource: "https://json-render.dev/docs/catalog"
    title: "Catalog"
  - id: json-render-streaming
    resource: "https://json-render.dev/docs/streaming"
    title: "Streaming"
  - id: json-render-modes
    resource: "https://json-render.dev/docs/generation-modes"
    title: "Generation modes"
  - id: json-render-data
    resource: "https://json-render.dev/docs/data-binding"
    title: "Data binding"
  - id: json-render-mcp
    resource: "https://github.com/vercel-labs/json-render/blob/c2600d73908ed505e6d726f5b6f969ba8f597ce7/packages/mcp/README.md"
    title: "@json-render/mcp"
  - id: json-render-a2ui
    resource: "https://json-render.dev/docs/a2ui"
    title: "A2UI integration"
---

# json-render (Vercel Labs)

- **Status:** Vercel Labs library, v0.21.0 (September 2026), Apache-2.0; a
  framework with its own spec shape, not a standards-body format; Jev
  composition APIs are marked experimental[^json-render-readme][^json-render-changelog]

The application declares a catalog of allowed components, props (Zod), slots
and named actions; `catalog.prompt()` renders that contract for the model. The
model emits a flat `{ root, elements }` spec, and a registry maps each catalog
type to a real component[^json-render-catalog]. The model produces data, never
code; actions are names that application handlers execute.

**Mechanics**

1. **Streaming.** SpecStream is JSONL: one RFC 6902 JSON Patch operation per
   line, addressed by JSON Pointer, compiled incrementally[^json-render-streaming].
2. **Chat embedding.** Inline mode mixes prose and patch lines; the AI SDK pipe
   moves patches into `data-spec` message parts that the client extracts from
   `message.parts`[^json-render-modes].
3. **State.** `$state`, `repeat`, two-way `$bindState`, `$cond`, `$template` and
   a `visible` condition language; `setState` actions and watchers mutate
   client state[^json-render-data].
4. **Reach.** Renderers for React, Vue, Svelte, Solid, React Native, shadcn/ui,
   PDF, image, video and Ink[^json-render-readme]; an MCP Apps package that
   returns a spec as an interactive UI resource[^json-render-mcp]; A2UI accepted
   as an input schema[^json-render-a2ui].

**llame fit: watch.** llame's web chat renders stored `messages.parts` through
fixed `@workspace/ui` elements. Inline mode matches that shape: a spec part
rendered by a small catalog over existing shadcn components. It would be a new
stored part type, which needs a spec under the repository's `messages.parts`
rule. The [System One/Jev study](../tool-harness/2026-09-23-system-one-jev/index.md)
records a json-render plus Jev demonstration and its limits.

**Caution:** the catalog limits vocabulary, not effects. An action that reaches
the server still needs llame's permission, tenancy and Run accounting.
Renderer parity is incomplete: the docs say only React scopes visibility inside
`repeat` items. Pre-1.0 API churn is expected.

[^json-render-readme]: [json-render README](https://github.com/vercel-labs/json-render/blob/c2600d73908ed505e6d726f5b6f969ba8f597ce7/README.md)

[^json-render-changelog]: [json-render changelog](https://github.com/vercel-labs/json-render/blob/c2600d73908ed505e6d726f5b6f969ba8f597ce7/CHANGELOG.md)

[^json-render-catalog]: [Catalog](https://json-render.dev/docs/catalog)

[^json-render-streaming]: [Streaming](https://json-render.dev/docs/streaming)

[^json-render-modes]: [Generation modes](https://json-render.dev/docs/generation-modes)

[^json-render-data]: [Data binding](https://json-render.dev/docs/data-binding)

[^json-render-mcp]: [@json-render/mcp](https://github.com/vercel-labs/json-render/blob/c2600d73908ed505e6d726f5b6f969ba8f597ce7/packages/mcp/README.md)

[^json-render-a2ui]: [A2UI integration](https://json-render.dev/docs/a2ui)
