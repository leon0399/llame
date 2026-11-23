---
status: accepted
---

# Requests name a selector, and `modelId` names the model that served

A request names a `selector`: a model role as `@name`, or an exact model id. A
Run records that selector and, separately, the `modelId` of the model that
serves its current segment. Usage keeps `modelId` for the served model. The
operator keys follow the same rule: `defaults.selector` and
`defaults.titleGenerationSelector`.

We chose this because a role makes the requested and the served model
different things. With one `modelId` field for both, a request could say
`@coding` while every reply says `sonnet`, and a reader of either field could
not tell which one it holds. LiteLLM, OpenClaw, and oh-my-pi all keep the two
apart.

## Considered options

- Keep `modelId` on requests and let it hold `@role`. No client or config
  changes, but the field means a selector on requests and a served model
  everywhere else.

## Consequences

- Every client and operator config renames the field once, before launch.
- A request that still names `modelId` is refused, so no client silently runs
  the default model.

Decided in the spec grilling of
[model roles with fallback chains](https://github.com/leon0399/llame/issues/1772#issuecomment-7101877446),
for the OpenSpec change
[model-roles](../../openspec/changes/model-roles/proposal.md).
