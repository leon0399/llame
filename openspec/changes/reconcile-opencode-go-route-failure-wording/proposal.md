## Why

The `opencode-go-provider` requirement "Upstream failures are mirrored under
the existing contract" says the operator runbook records that a model the
gateway's format gate rejects fails with the gateway's "not supported for
format" message ([#919](https://github.com/leon0399/llame/issues/919)). That
text came from the gateway's open-source handler. The
[live proof](../archive/2026-09-22-opencode-go-provider/live-proof.md#failure-shapes-observed)
recorded with the change ran the one route-ceiling probe available, `grok-4.6`
on `/chat/completions`. The deployed gateway answered
`Upstream request failed: Endpoint is unavailable.`, and after the SDK's three
attempts (the request plus two retries) the run recorded the failure message
`Failed after 3 attempts. Last error: Upstream request failed: Endpoint is unavailable.`
with class `RetryError`.

The
[runbook](../../../docs/product/operator/providers/opencode-go.md#accepted-upstream-failures)
already records both the documented and the observed text, so a reader of the
requirement alone expects one message while the runbook tells them to match
another. The runbook's own string to match is also slightly wrong: it reads
`RetryError: Failed after 3 attempts. …`, prefixing the error class, which is
not part of the message the run records (the client test asserts the surfaced
message carries no class prefix).

## What Changes

- Reword the runbook clause of "Upstream failures are mirrored under the
  existing contract" so that, for a model the route does not serve, the
  runbook records the gateway's documented format-gate message, the failure
  message the run was observed to record with its observation date, that
  operators match the observed message rather than the format-gate text, and
  the remedy.
- Reword the scenario "The runbook names the accepted upstream shapes" to
  match.
- Correct the runbook's string to match: drop the `RetryError` class prefix,
  and say the three attempts are the request plus two retries.
- No behavior changes. Outside the runbook clause and its scenario, the
  requirement and every other scenario stay word for word; the clause's
  usage-limit half changes only by the `; and that` the new sentence structure
  needs, where today's text reads `, and`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-go-provider`: the runbook clause of "Upstream failures are
  mirrored under the existing contract" and its runbook scenario.

## Impact

- `openspec/specs/opencode-go-provider/spec.md`, through the finalize layer's
  spec sync.
- `docs/product/operator/providers/opencode-go.md`: one corrected string and
  one clarified retry count in "Accepted upstream failures".
- `CHANGELOG.md`: one dated entry.
- No code, configuration, or API change. The archived change and its delta
  stay untouched: rewriting an archived delta to match a later observation is
  what the archive exists to prevent (#919).

## Acceptance

- The synced canonical requirement carries the reworded runbook clause and
  scenario, and every other sentence and scenario of the requirement is
  byte-identical to today's except that `, and` becomes `; and that`.
- The runbook's "Accepted upstream failures" section names the documented
  format-gate message, the observed failure message exactly as the run records
  it (no class prefix) with its 2026-09-22 date, an instruction to match the
  observed message rather than the format-gate text, and the remedy.

## Assumptions

- "Route does not serve" and "format gate rejects" are both kept in the
  wording. The probe that ran was a route rejection, the requirement's clause
  concerns a format-gate rejection, and a format-gate rejection remains
  unobserved rather than disproven (#919).
- The observed message is recorded as observed on 2026-09-22, not as a
  permanent gateway contract, since llame does not own the gateway.

## Decisions for approval

None open. The runbook correction gives the change an ordinary implementation
layer, so `Closes #919` and the changelog entry sit there and the finalize
layer keeps to spec sync and archive movement.

## Non-goals

- Changing how llame surfaces gateway failures, adding a classifier, or
  pinning the message in code.
- The per-model route override that reaches `grok-4.6` on `/responses`
  (#904).
