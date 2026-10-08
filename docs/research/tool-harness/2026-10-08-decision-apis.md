---
type: Research
title: "Decision APIs: OpenAI /v1/decisions, decisionapi.net and the System One wire"
description: "What OpenAI's Decisions API and the decisionapi.net gateway are, how their typed predicate/choice/score answers differ from structured outputs and OMP's JUDGE, and where llame could use them."
tags:
  [decisions-api, typed-judgment, jev, system-one, classification, permissions]
status: draft
generated: { by: "claude-code/claude-opus-5-5", at: "2026-10-08" }
observed:
  date: "2026-10-08"
  revision: "b99e3e4eee03e99eebc2c762eee9d73fdd4b0eff"
sources:
  - id: openai-guide
    resource: "https://developers.openai.com/api/docs/guides/decisions"
    title: "OpenAI Decisions guide (live page, no version identifier; read 2026-10-08)"
  - id: openai-python
    resource: "https://github.com/openai/openai-python/tree/b99e3e4eee03e99eebc2c762eee9d73fdd4b0eff/src/openai/types"
    title: "openai-python decision.py and decision_create_params.py (committed 2026-10-06, released as v3.26.0)"
  - id: openai-node
    resource: "https://github.com/openai/openai-node/commit/7195644a4fa98d4d379903a00e6ba6350136ab02"
    title: "openai-node standalone Decisions support (committed 2026-10-06, released as v7.30.0)"
  - id: decoder-devday
    resource: "https://the-decoder.com/openai-expands-codex-and-its-api-at-devday-with-security-scans-a-decisions-api-and-ultrafast/"
    title: "The Decoder DevDay report (secondary; live page, no version identifier; read 2026-10-08; dated 2026-09-29)"
  - id: decisionapi-docs
    resource: "https://decisionapi.net/docs"
    title: "decisionapi.net API reference (live page, no version identifier; read 2026-10-08)"
  - id: decisionapi-site
    resource: "https://decisionapi.net"
    title: "decisionapi.net landing page, FAQ and pricing (live page, no version identifier; read 2026-10-08)"
  - id: jev-report
    resource: "./2026-09-23-system-one-jev/report.md"
    title: "System One and Jev report"
  - id: permission-study
    resource: "./2026-09-24-permission-classifier-cascade/index.md"
    title: "Permission classifiers and live Jev experiments"
---

# Decision APIs

Two things share the name, and they are related but not the same product.
[OpenAI's Decisions API](https://developers.openai.com/api/docs/guides/decisions)
is a first-party endpoint. [decisionapi.net](https://decisionapi.net) is an
independent third-party gateway that resells several decision models, OpenAI's
among them, behind a different wire. Both belong to the typed-judgment family
the [System One/Jev report](./2026-09-23-system-one-jev/report.md) studies. This
note sits in `tool-harness/` because it compares one API shape across a vendor
endpoint and a gateway rather than describing a single product.

## OpenAI Decisions API

**Status.** Public beta; the guide expects GA "in the coming weeks".[^openai-guide] The
launch is reported as a limited preview.[^decoder-devday]

**Request.** `POST /v1/decisions` with `model`, `input` and `questions`, plus an
optional `safety_identifier`. `input` is a string or user messages holding text
and inline images (at most 128 image parts; no system roles, tool calls, files
or audio). Hosted image URLs and `file_id` are refused. Each question has a
`type`, `instructions` and an optional `name`.[^openai-python][^openai-node][^openai-guide]

**Answers**, a discriminated union on `type`:

- `predicate`: `probability` that the condition is true.
- `choice`: question adds `choices[]` (string or boolean values, optional
  descriptions); answer has `choice`, per-option `probabilities`, `confidence`.
- `score`: question adds ordered `levels[]`; answer has `score` (probability-weighted
  level index, can be 1.1), per-level `probabilities`, `confidence`.
- `refusal`: only `name`; the host declined that question.

Response also has `model` and `usage` (input, cached, cache-write, output and
reasoning token counts).[^openai-python] Questions in one request are
independent and share `input`; dependent decisions need separate requests.[^openai-guide]

**Model and cost.** Only `gpt-6-luna`. The guide states $0.10 per 1M input
tokens, no output or cache charges, regional and long-context multipliers
apply, and "about 10x faster than the Responses API". ZDR and HIPAA for
eligible customers; US and EEA/Swiss data residency.[^openai-guide] The 10x is
an OpenAI claim; no latency was measured here.

**Abstain.** `refusal` is the only abstain, and it is binary. Nothing else in
the schema signals "insufficient evidence"; the guide advises a fallback option such as
`other`.[^openai-guide] Refusal is not an error status in the SDK types.[^openai-python]

**Not confirmed.** The REST reference page (`/api/reference/resources/decisions/methods/create`)
returned 404 to a fetch; the schema above comes from the pinned SDK types and
the guide. Per-question limits (maximum questions, choices, levels, body size),
rate limits and any statement on determinism or `temperature` were not found.
No OpenAI source names Jev, System One or TypeSafe.

## decisionapi.net

An independent playground and API whose footer says it "brings together decision
models from multiple providers"; it disclaims affiliation with the model
developers. The operator's legal identity is not stated on the pages
read.[^decisionapi-site]

- **Wire.** `POST /v1/systemone` with `state`, `model` and a `questions` map
  keyed by id (1 to 8 questions, 32 KiB body). Types are `choice` (up to 255
  options), `score` (2 to 10 levels) and `noul`, a yes/no probability. `noul` is
  the System One name for OpenAI's `predicate`.[^decisionapi-docs][^decisionapi-site]
  Answers come back keyed by question id, with `usage` and `elapsedMs`.
- **Models.** Listed ids include `typesafe/jev-1.13`, `openai/gpt-6-luna-decisions`,
  Laya, Clef, Mercury Decide, Solar Decide, Span-01 and others; supported question
  types vary by model.[^decisionapi-site]
- **Cost.** One-time credit packs ($10, $100, $1000), no expiry; a per-call
  credit price was not published on the pages read.[^decisionapi-site]
- **Terms.** Terms of Service, Privacy and Refund links exist, but their
  retention and logging text was not extracted (the pages returned only
  application shell markup). Treat prompt retention as unknown.
- **Code and license.** A `github.com/decisionsapi` organization is linked, with
  no repositories listed under it; no license was verified.
- **Errors.** 401, 422, 429, 529; retry with exponential backoff.[^decisionapi-docs]

The link to this repo's prior work is direct: the `typesafe` backend OMP uses
posts the same `{ state, model, questions }` body to `/v1/systemone`,[^jev-report]
so decisionapi.net is a reseller of that wire, while OpenAI independently exposes
a close relative with renamed fields (`state` to `input`, map to array,
`noul` to `predicate`, `criteria` to `choices`/`levels`, probabilities as lists).
That the OpenAI design derives from System One is an inference from shape, not
something any source states.

## Difference from neighbors

- **Structured outputs / function calling.** Those generate an object under your
  schema, free-form fields and explanations included. Decisions returns only
  calibrated-looking numbers over a closed answer set you define. OpenAI's own
  guide draws the same line.[^openai-guide] Decisions cannot explain itself.
- **Plain classification via a chat model.** A plain chat call gives a
  label with no probability; Decisions exposes the distribution and a hosted
  low-latency path. The probabilities are model signals; decisionapi.net says
  confidence is not an accuracy guarantee.[^decisionapi-site]
- **OMP JUDGE / Jev.** Same interface idea. JUDGE is a role that chooses a
  backend (TypeSafe Jev, OpenRouter, or a local model) and handles failures by
  kind: an aborted or timed-out call propagates, an ordinary failure advances to
  another retained candidate, and a failed native judgment is not replaced by
  prompted probabilities.[^jev-report] OpenAI's endpoint is a fourth
  possible backend, not a replacement for the role. `gpt-6-luna` is hosted only.

## llame applications

Each is a candidate for a caller-owned decision with no effects in the API
itself ("F3c" in the report).[^jev-report] None is approved; all need a provider
disclosure policy first.

- **A1 Recall relevance.** `predicate` per candidate chat excerpt or Knowledge
  hit: "does this answer the question?", thresholded against labeled examples.
  Fits the existing candidate-selection layer. Confidence: moderate.
- **A2 Permission classifier (#778).** Today llame fails closed and ships no
  interactive approval. A `choice` of `allow | needs-human | deny` could rank
  requests for a future approval queue, never grant. Prior live Jev results are
  synthetic.[^permission-study] Use as an advisory signal behind the static policy.
  Confidence: low for auto-approval; moderate for triage ordering.
- **A3 Effort selection.** `score` over task difficulty, mapped by a table in
  host code to the run's reasoning effort. Low-stakes, cheap, reversible.
  Confidence: moderate.
- **A4 Premature-stop detection.** `predicate`: "is the task complete given the
  transcript and the stated goal?" before a Run finalizes; a high-false-positive
  rate costs one extra loop turn. Confidence: moderate.
- **A5 Knowledge write triage.** `choice` among `discard | note | durable fact`
  for agent-authored writes (#212). The write itself stays gated by the
  recoverable-write contract. Confidence: low until measured on real traffic.

## Cautions

- **R1 Data egress.** Every call ships the state to a provider. OpenAI offers
  ZDR to eligible customers; decisionapi.net's retention is unverified and it
  adds a second party between llame and the model. Owner opt-in and a named
  destination are required, as with the recency digest.
- **R2 Authorization.** A probability is not a permission. Decisions may order
  or label; `tools.permissions`, RLS and effect fencing decide. A refusal or
  transport failure must resolve to the safe default, never to "allow".
- **R3 Determinism.** No source states sampling behavior. Pin the model id, store
  each answer on the Run for audit, and do not re-derive security-relevant
  outcomes from a second call.
- **R4 Cost and quota.** Cheap per call but unbounded by loop count; budget it
  and count it in the Run usage.
- **R5 Secrets.** Never pass resolved credentials or tokens in `input`; apply
  the same redaction as for model context.
- **R6 Beta churn.** Public beta, one model, SDK minimums (Python 3.26.0, JS
  7.30.0[^openai-guide]) and schema fields may change before GA.

[^openai-guide]: [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)

[^openai-python]: [openai-python types at b99e3e4e](https://github.com/openai/openai-python/tree/b99e3e4eee03e99eebc2c762eee9d73fdd4b0eff/src/openai/types)

[^openai-node]: [openai-node standalone Decisions commit](https://github.com/openai/openai-node/commit/7195644a4fa98d4d379903a00e6ba6350136ab02)

[^decoder-devday]: [The Decoder DevDay report](https://the-decoder.com/openai-expands-codex-and-its-api-at-devday-with-security-scans-a-decisions-api-and-ultrafast/)

[^decisionapi-docs]: [decisionapi.net API reference](https://decisionapi.net/docs)

[^decisionapi-site]: [decisionapi.net](https://decisionapi.net)

[^jev-report]: [System One and Jev report](./2026-09-23-system-one-jev/report.md)

[^permission-study]: [Permission classifiers and live Jev experiments](./2026-09-24-permission-classifier-cascade/index.md)
