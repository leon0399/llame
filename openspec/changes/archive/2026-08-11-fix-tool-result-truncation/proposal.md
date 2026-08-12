## Why

The shipped truncation rule ("truncated to a documented cap with a visible truncation marker") is satisfied by an implementation that destroys the result. `truncateIfOversized` serializes the whole result and, above the cap, replaces it with `{ status, truncated, message, preview }`, where `preview` is a prefix of the result's own JSON cut at an arbitrary UTF-16 index (#294). Every field the tool declared is gone, the model is handed an unparseable JSON fragment inside a JSON string, and a cut landing between the halves of a surrogate pair emits a lone surrogate.

Neither defect fires today because the only code-owned tool returns small structured rows. Both fire for the first tool that returns a real payload — an operator-configured MCP tool returning `{ status: 'success', output }` routinely exceeds the cap. The truncated result is also what is persisted and rendered, so the same defect degrades the chat UI's tool-result panel, not just model context.

## What Changes

- Truncate the tool's own payload structurally instead of replacing the result envelope: the success `status` and every top-level field the tool declared survive, with values shrunk in place.
- Cut string values only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate.
- Replace the bare `Result truncated to N characters.` message with one marker stating the number of omitted characters and the recovery action available to the model.
- Report what survived of each shortened list (`results kept 136 of 5000`), naming the lists that lost the most and counting the rest. Cut prose is self-evident to a reading model; a list that quietly lost its tail reads as a complete one, so a model asked to count would answer confidently and wrongly.
- Never re-serialize a subtree into a string field, so redaction applied before truncation (`mcp-tools`) cannot be defeated by an alternate typed representation.
- Keep the cap a single documented constant applied at the one chokepoint (`runTool`); keep error results untruncated.
- Make the cap unconditional. Shape preservation has a floor — a payload whose top-level field names alone exceed the cap cannot be shrunk further with every field retained — and the cap wins there, omitting trailing fields and saying so in the marker, because an unbounded result is exactly what the cap exists to keep out of a provider request.
- Out of scope: per-tool or context-window-derived caps, a `minKeepChars` floor, tiered ceilings, pagination, and result shaping — those need the widened tool contract (#214 follow-up). The 8,000-code-unit per-pair replay bound in `tool-observation-part.ts` is untouched: a shape-preserved 16,000-character result still has its payload cleared on later-turn replay, which is existing #214 behavior, not an oversight here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-calling`: Define oversized-result truncation as a structural, shape-preserving, code-point-safe operation carrying an actionable marker, rather than any cut that stays under the cap.

## Impact

- `apps/api/src/tools`: the runner's truncation step and its unit coverage.
- No public API, database schema, persisted part shape, provider request, or dependency change. The recorded result gains a marker field pair and loses the `preview` field; nothing reads `preview`.
