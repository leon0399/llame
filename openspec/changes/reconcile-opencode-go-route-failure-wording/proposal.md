## Why

The `opencode-go-provider` requirement "Upstream failures are mirrored under
the existing contract" says the operator runbook records that a model the
gateway's format gate rejects fails with the gateway's "not supported for
format" message ([#919](https://github.com/leon0399/llame/issues/919)). That
text came from the gateway's open-source handler. The live proof recorded with
the change
([`live-proof.md`](../archive/2026-09-22-opencode-go-provider/live-proof.md))
found the deployed gateway answering the one route-ceiling probe that could be
run, `grok-4.6` on `/chat/completions`, with
`RetryError: Failed after 3 attempts. Last error: Upstream request failed: Endpoint is unavailable.`
after the SDK's own three retries. The
[runbook](../../../docs/product/operator/providers/opencode-go.md#accepted-upstream-failures)
already records both and tells operators to match on the observed message, so
a reader of the requirement alone expects one message while the runbook tells
them to match another.

## What Changes

- Reword the runbook clause of "Upstream failures are mirrored under the
  existing contract" so that, for a model the route does not serve, the
  runbook records the gateway's documented format-gate message, the message
  the deployed gateway was observed to return, which one to match, and the
  remedy.
- Reword the scenario "The runbook names the accepted upstream shapes" to
  match.
- No behavior changes. The failure contract itself, the other scenarios, and
  the usage-limit clause stay word for word. The runbook already satisfies the
  reworded text, so no code or document outside `openspec/` changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-go-provider`: the runbook clause of "Upstream failures are
  mirrored under the existing contract" and its runbook scenario.

## Impact

- `openspec/specs/opencode-go-provider/spec.md`, through the finalize layer's
  spec sync.
- No code, configuration, API, or runbook change. The archived change and its
  delta stay untouched: rewriting an archived delta to match a later
  observation is what the archive exists to prevent (#919).

## Assumptions

- "Route does not serve" and "format gate rejects" are both kept in the
  wording. The probe that ran was a route rejection, the requirement's clause
  concerns a format-gate rejection, and a format-gate rejection remains
  unobserved rather than disproven (#919).
- The observed message is recorded as observed on 2026-09-22, not as a
  permanent gateway contract, since llame does not own the gateway.

## Non-goals

- Changing how llame surfaces gateway failures, adding a classifier, or
  pinning the message in code.
- The per-model route override that reaches `grok-4.6` on `/responses`
  (#904).
