# Design

## Context

The runbook clause of "Upstream failures are mirrored under the existing
contract" predates the live proof. The proof and the runbook disagree with the
requirement's text, and the runbook's string to match carries the error class
as a prefix the run does not record. See proposal.md for the evidence.

## Goals / Non-Goals

**Goals:**

- One formulation, shared by the requirement and the runbook, that names the
  documented text and the observed text and says which to match.
- The string operators are told to match is exactly the recorded failure
  message.

**Non-Goals:**

- Any change to how failures surface; the clause is a runbook obligation, not
  runtime behavior.

## Decisions

### D1. Keep both texts, and match the observed one

The requirement names the documented format-gate message and the observed
failure message with its date, and says operators match the observed one.

- Alternative: drop the format-gate text and name only the observed message.
  Rejected: the probe was a route rejection; a format-gate rejection is
  unobserved, not disproven, and the gateway's handler still documents it.
- Alternative: keep the requirement as is and treat the runbook as a
  superset. Rejected: a reader of the requirement alone is told to expect a
  message the deployed gateway did not return, which is the defect #919
  records.

### D2. Describe the message by what the run records

The clause says "the failure message the run was observed to record", not
"the message the gateway returned". The gateway's own text
(`Upstream request failed: Endpoint is unavailable.`) is nested inside the
SDK's retry summary, and operators match what the run shows them. The error
class (`RetryError`) is metadata, not part of that message, so the runbook
drops it from the string to match.

### D3. Leave the archived change untouched

The archived delta and live proof stay as recorded; this change carries the
reconciliation forward. Rewriting an archived delta to match a later
observation would destroy the record of what was proposed and proven (#919).

## Risks / Trade-offs

- [The gateway changes its message again] → The clause requires the runbook
  to date the observation, so a later observation is recorded as a new dated
  entry rather than silently contradicting this one.
