# Spec Delta

## Purpose

`rerank-models` lets a tool rank its cards with a conventional rerank model.
One request to a Cohere v2 `/rerank` endpoint sends the query and the card
texts, and returns one relevance score per card. The rank seat treats these
scores like decision-model scores.

## ADDED Requirements

### Requirement: A cohere-rerank provider speaks the rerank wire

A `providers[]` entry of `type: "cohere-rerank"` MUST serve the Cohere v2
rerank wire. Each request MUST go to `POST {baseUrl}/rerank`. The request body
MUST hold `model`, `query`, and `documents`. When the entry has a `key`, each
request MUST carry it as a bearer token. The `baseUrl` default MUST be
`https://api.cohere.com/v2`.

#### Scenario: A rerank provider is configured

- **WHEN** `providers[]` holds a `cohere-rerank` entry with a `key` and the `baseUrl` `https://openrouter.ai/api/v1`
- **THEN** each request goes to `https://openrouter.ai/api/v1/rerank`
- **AND** each request carries a bearer `key`

#### Scenario: A self-hosted reranker needs no key

- **WHEN** a `cohere-rerank` entry has no `key` and the `baseUrl` `http://infinity:7997`
- **THEN** startup succeeds
- **AND** each request goes to `http://infinity:7997/rerank` without an `Authorization` header

#### Scenario: The default endpoint needs a key

- **WHEN** a `cohere-rerank` entry has no `baseUrl` and its `key` is absent or resolves blank
- **THEN** startup fails and names the entry and the field `key`

### Requirement: The rerank catalog names models by id

The config file MUST accept an optional top-level `rerankModels` array. Each
entry MUST be `{ id, provider, model }`. `provider` MUST name a `providers[].id`
of `type: "cohere-rerank"`. `model` MUST be a nonblank string, sent verbatim.
Each field MUST accept `{env:…}` and `{path:…}` interpolation.

#### Scenario: A rerank catalog loads

- **WHEN** the file declares a `rerankModels` entry with an `id`, a `cohere-rerank` `provider`, and the `model` `cohere/rerank-5-fast`
- **THEN** startup succeeds
- **AND** a rank call that names that id sends `cohere/rerank-5-fast` on the wire

#### Scenario: A rerank model names another provider type

- **WHEN** a `rerankModels` entry names a provider of `type: "system-one"`
- **THEN** startup fails and names `rerankModels[0].provider` for the first entry

#### Scenario: A blank rerank model fails startup

- **WHEN** a `rerankModels` entry has a `model` that is blank or resolves to blank
- **THEN** startup fails and names `rerankModels[0].model` for the first entry

### Requirement: Rank model ids are unique across both catalogs

Each `rerankModels[].id` MUST be a nonblank string. An id MUST be unique in
`rerankModels` and MUST NOT equal a `decisionModels[].id`. A blank or
duplicate id MUST fail startup and name the affected array-index paths, never
an interpolated value.

#### Scenario: One id in both catalogs fails startup

- **WHEN** `decisionModels[0].id` and `rerankModels[1].id` are both `fast`
- **THEN** startup fails and names `decisionModels[0].id` and `rerankModels[1].id`

#### Scenario: A blank rerank model id fails startup

- **WHEN** a `rerankModels` entry has an `id` that is blank or resolves to blank
- **THEN** startup fails and names that entry's `rerankModels[<index>].id` path

### Requirement: Rerank models stay server-only

`GET /api/v1/models` MUST NOT return a `rerankModels` entry or its fields. An
absent or empty `rerankModels` array MUST mean that no rerank model exists.

#### Scenario: Rerank models are absent from the model list

- **WHEN** the file declares a `rerankModels` entry and an authenticated caller reads `GET /api/v1/models`
- **THEN** the response lists the chat models and no rerank model

### Requirement: A rerank request carries the criterion and the card texts

`query` MUST be the caller's `objective` when present, else its `query`.
`documents` MUST hold the card texts in card-key order. The system MUST
replace the rerank provider's resolved key in `query` and each card text
before it cuts a card to the card bound. A rerank request MUST NOT carry a
rubric.

#### Scenario: The objective is the rerank query

- **WHEN** a grep call supplies the patterns `retry` and the objective `find the retry budget`
- **THEN** the request `query` is `find the retry budget`
- **AND** `documents` holds one text for each card, in card-key order

### Requirement: Rerank requests are bounded and sent together

One request MUST carry at most 1,000 cards. A larger call MUST become several
requests, each with only its own cards. The system MUST send all requests of
one call at the same time. Each request MUST follow the attempt timeout,
retry, and `retry-after` rules of the decision lane.

#### Scenario: A call is larger than the bound

- **WHEN** a call holds 1,500 cards
- **THEN** the system sends two requests at the same time
- **AND** the first request carries 1,000 cards and the second carries 500

### Requirement: A rerank response scores every card or fails its request

A response MUST hold `results`, an array with one `{ index, relevance_score }`
for each document of its request. Each `relevance_score` MUST be a finite
number. A missing, duplicate, or out-of-range index MUST make that request
unavailable. A response without a `meta` field MUST be accepted.

#### Scenario: A response from OpenRouter has no meta field

- **WHEN** the response holds `id`, `model`, `results`, and `usage` and no `meta`
- **THEN** the request is accepted
- **AND** each card gets the score of its index

#### Scenario: A response skips a document

- **WHEN** a request carries 20 documents and the response scores 19 of them
- **THEN** that request is unavailable
- **AND** its 20 cards are unjudged

### Requirement: A rerank call reports scores, usage, and cost

The judge result MUST map each judged card key to its `relevance_score`.
`model` MUST be the served model id when a response names one, else the
catalog `model`. Input tokens MUST come from `usage.total_tokens`, else
`usage.prompt_tokens`, else be `null`. Output tokens MUST be 0. Cost MUST be
`usage.cost` when it is a finite nonnegative number, else `null`.

#### Scenario: OpenRouter reports usage and cost

- **WHEN** the response holds `usage: { total_tokens: 2139, cost: 0.00004278 }`
- **THEN** the log line holds `inputTokens: 2139`, `outputTokens: 0`, and `costUsd: 0.00004278`

#### Scenario: Cohere reports no cost

- **WHEN** the response holds no `usage.cost`
- **THEN** the log line and `display.rerank` hold `costUsd: null`

### Requirement: A rerank rank call follows the decision-lane rules

A rank call served by a rerank model MUST follow these `decision-models`
requirements, with the rerank provider's key as the protected key: failed
requests, the log line, secrecy, key protection in presentation, protected
locators, and enclosing cancellation and deadline. Tool rules that name a
decision call MUST apply to it.

#### Scenario: A rerank request fails

- **WHEN** one of two rerank requests of a call answers 503 three times
- **THEN** only its cards are unjudged
- **AND** the tool call continues and keeps canonical order for those cards

#### Scenario: The tool deadline expires during a rerank request

- **WHEN** the enclosing tool deadline expires while a rerank request is in flight
- **THEN** the request aborts and no retry starts
- **AND** the tool settles with the runner's timeout observation, not a rank-failure line or note

#### Scenario: A web search ranks with a rerank model

- **WHEN** `webSearch.rerank.model` names a `rerankModels` id and a call fetches 20 results with `limit` 10
- **THEN** the results sort by score before the inline cut
- **AND** the result carries `display.rerank` with the served model and 20 scores
