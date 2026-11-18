---
summary: "The render_ui tool: hands the owner's client one display-only A2UI v0.9 surface, rendered in the reply"
read_when:
  - you need to know what a model's render_ui call shows and which components it accepts
  - you are deciding whether to allowlist render_ui
spec: tool-calling
---

# render_ui

Prototype. The tool and its catalog can change without notice.

## Purpose

`render_ui({ components, data })` shows the owner one structured surface in
the reply: a card, a list of items, a comparison. The surface is an
[A2UI](../../../research/standards/a2ui.md) v0.9 component list. The call has
no effect of its own: its input is the surface, it is stored with the reply
like any tool call, and the client renders it from that stored input, live and
on reload.

## Arguments

| Field        | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `components` | 1 to 200 components as a flat list; each has a unique `id`, and one has the id `root` |
| `data`       | optional data model; a `{ "path": "/pointer" }` value reads from it by JSON Pointer   |

The catalog is a display-only subset of the A2UI basic catalog:

| Component       | Fields                                                      |
| --------------- | ----------------------------------------------------------- |
| `Text`          | `text`; `variant` (`h1` to `h5`, `caption`, `body`)         |
| `Row`, `Column` | `children`; `justify`; `align`                              |
| `List`          | `children`; `direction` (`vertical`, `horizontal`); `align` |
| `Card`          | `child`                                                     |
| `Divider`       | `axis` (`horizontal`, `vertical`)                           |

`children` is a list of component ids, or `{ "componentId", "path" }` to repeat
one component for each item of an array in `data`. Inside a repeated component
a path without a leading `/` reads from the current item.

`Image` is not in the catalog: an address the model chooses and the owner's
browser fetches is a channel out of the Chat. Buttons and inputs are not in the
catalog: a surface cannot send an action back to the Run.

## Result

A success is `{ "status": "success", "rendered": true }`. It says the surface
was accepted, not that the owner saw it.

## Behavior

The api checks the surface before it accepts the call: the component schema,
unique ids, a `root` component, that every referenced id exists, and that no
component is the child of two components. `data` is at most 16,000 characters
of JSON and nests at most 12 levels. The client stops after 1,000 rendered
components, whatever the surface asks for. The
client renders the surface with its own components, so the surface follows
the installation's theme. Component text is plain text.

The tool is `read_only`. It needs its own `tools.allowed` entry and its own
`tools.permissions` group, for example `"render_ui": { "allow": true }`.

## Errors

`invalid_input`.
