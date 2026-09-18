## Purpose

Select the wire API every request on behalf of a provider entry uses from
that entry's declared `type` alone.

## ADDED Requirements

### Requirement: Provider type selects the wire API

A provider entry with `type: "openai-responses"` SHALL execute against the OpenAI Responses wire at its configured `baseUrl` (default: the OpenAI API); an entry with `type: "openai-completions"` SHALL execute against the Chat Completions wire at its configured `baseUrl`. Every language-model request llame makes on behalf of that entry — streaming chat, forced-tool structured generation, and compaction — SHALL use the entry's declared wire. Embedding requests are wire-independent and are exempt: an entry of either OpenAI wire type may back an embedding model, and its embedding calls are not routed by wire. The provider's `id` SHALL NOT select or alter the wire, and no wire behavior SHALL be inferred from an entry's `id`, its `baseUrl`, or any host matching. An entry whose endpoint does not serve its declared wire SHALL be used exactly as authored: startup SHALL succeed, the entry SHALL NOT be migrated, reinterpreted, or re-pointed, and the resulting failure SHALL appear at request time under the existing failure contract rather than as a boot failure, a silent retarget, or a silent rewrite of the request.

#### Scenario: A Responses-typed provider uses the Responses wire whatever its id

- **WHEN** a scheduled run's model resolves to a `type: "openai-responses"` provider whose `id` is not `openai`
- **THEN** the request uses the Responses wire
- **AND** reasoning summary behavior is not lost to an id-dependent branch

#### Scenario: A completions-typed provider uses Chat Completions

- **WHEN** a model resolves to a `type: "openai-completions"` provider
- **THEN** the request is sent in the Chat Completions shape to that provider's `baseUrl`
- **AND** no Responses-only request field is sent

#### Scenario: A Responses-typed provider may name a non-OpenAI endpoint

- **WHEN** a `type: "openai-responses"` provider's `baseUrl` names a local or third-party server that serves `/v1/responses`
- **THEN** the request uses the Responses wire at that base URL
- **AND** llame neither validates nor warns about the host

#### Scenario: An id or base URL does not select the wire

- **WHEN** a provider's `id` or `baseUrl` suggests a different wire than the entry's `type`
- **THEN** the wire is selected by `type` alone

#### Scenario: Structured generation follows the declared wire

- **WHEN** a caller requests forced-tool structured generation (e.g. a chat title) through a provider entry
- **THEN** the request is sent on that entry's declared wire with a forced tool choice
- **AND** a rejection falls through to the caller's existing fallback rather than another wire

#### Scenario: Embedding requests are exempt from wire selection

- **WHEN** an `openai-completions` entry backs an embedding model
- **THEN** its embedding requests are issued against the same endpoint without following the entry's language-model wire
- **AND** no wire mismatch is reported for them

#### Scenario: A mismatched configuration fails at request time

- **WHEN** an endpoint does not serve the wire its provider's `type` names
- **THEN** startup succeeds
- **AND** the failure appears at request time under the existing failure contract
- **AND** the request is neither silently rewritten nor retargeted
