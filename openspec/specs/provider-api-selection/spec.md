# provider-api-selection

## Purpose

A provider entry's `type` alone selects the wire API used for every
language-model request llame makes on its behalf; embedding requests are
exempt and are not routed by wire.

## Requirements

### Requirement: Provider type selects the wire API

A provider entry with `type: "openai-responses"` SHALL execute against the OpenAI Responses wire at its configured `baseUrl` (default: the OpenAI API); an entry with `type: "openai-completions"` SHALL execute against the Chat Completions wire at its configured `baseUrl`; an entry with `type: "anthropic-messages"` SHALL execute against the Anthropic Messages wire at its configured `baseUrl` (default: the Anthropic API); an entry with `type: "opencode-go"` SHALL execute against the Chat Completions wire at the endpoint fixed in llame's code, which its entry cannot override because it declares no endpoint field. Every language-model request llame makes on behalf of that entry — streaming chat, structured generation, and compaction — SHALL use the entry's declared wire. Embedding requests are wire-independent and are exempt: an entry of either OpenAI wire type may back an embedding model, and its embedding calls are not routed by wire. The provider's `id` SHALL NOT select or alter the wire, and no wire behavior SHALL be inferred from an entry's `id`, its `baseUrl`, or any host matching. An entry whose endpoint does not serve its declared wire SHALL be used exactly as authored: startup SHALL succeed, the entry SHALL NOT be migrated, reinterpreted, or re-pointed, and the resulting failure SHALL appear at request time under the existing failure contract rather than as a boot failure, a silent retarget, or a silent rewrite of the request.

#### Scenario: A Responses-typed provider uses the Responses wire whatever its id

- **WHEN** a scheduled run's model resolves to a `type: "openai-responses"` provider whose `id` is not `openai`
- **THEN** the request uses the Responses wire
- **AND** reasoning summary behavior is not lost to an id-dependent branch

#### Scenario: A completions-typed provider uses Chat Completions

- **WHEN** a model resolves to a `type: "openai-completions"` provider
- **THEN** the request is sent in the Chat Completions shape to that provider's `baseUrl`
- **AND** no Responses-only request field is sent

#### Scenario: A Messages-typed provider uses the Messages wire

- **WHEN** a model resolves to a `type: "anthropic-messages"` provider that sets no `baseUrl`
- **THEN** the request is sent in the Messages shape to the Anthropic API
- **AND** the response streams under the existing run contract

#### Scenario: An OpenCode Go-typed provider uses Chat Completions at the fixed endpoint

- **WHEN** a model resolves to a `type: "opencode-go"` provider
- **THEN** the request is sent in the Chat Completions shape to the endpoint fixed in llame's code
- **AND** the entry supplies no destination of its own, so no `baseUrl`, `id`, or ambient environment variable can move the request

#### Scenario: A Responses-typed provider may name a non-OpenAI endpoint

- **WHEN** a `type: "openai-responses"` provider's `baseUrl` names a local or third-party server that serves `/v1/responses`
- **THEN** the request uses the Responses wire at that base URL
- **AND** llame neither validates nor warns about the host

#### Scenario: A Messages-typed provider may name a non-Anthropic endpoint

- **WHEN** a `type: "anthropic-messages"` provider's `baseUrl` names a proxy, gateway, or third-party server that serves `/v1/messages`
- **THEN** the request uses the Messages wire at that base URL
- **AND** llame neither validates nor warns about the host, and the destination is not rewritten to the Anthropic API

#### Scenario: An id or base URL does not select the wire

- **WHEN** a provider's `id` or `baseUrl` suggests a different wire than the entry's `type`
- **THEN** the wire is selected by `type` alone

#### Scenario: Structured generation follows the declared wire

- **WHEN** a caller requests schema-constrained structured generation (e.g. a chat title) through a provider entry
- **THEN** the request is sent on that entry's declared wire using that wire's own structured-generation mechanism (a forced tool choice on the OpenAI wires, the adapter's structured-output path on the Messages wire)
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

### Requirement: Model provider options are forwarded under a fixed precedence

Every language-model request llame makes on behalf of a model entry SHALL carry that entry's retained `providerOptions` in the provider-options namespace its provider `type` selects, so the same catalog field configures every adapter and no provider gets a field of its own. The effective options SHALL be composed from four layers, highest precedence first: invariants a client requires for correctness or for a shipped contract (for example the Codex transport's non-stored responses and its summarized-reasoning setting, the Anthropic thinking prefix-mismatch behavior, and the Anthropic reasoning-replay switch); the run's resolved effort, placed in the adapter's effort option; the entry's `providerOptions`; and the client's documented defaults. Object-valued options SHALL merge key by key across layers, recursively, and any other value SHALL replace the value below it. An operator value of `null`, at any depth, SHALL remove the client default at that key, and SHALL NOT remove an invariant. An invariant holds in the composed options; where an adapter cannot carry an invariant on a particular option shape, the capability that owns that client SHALL state the ceiling and the request SHALL NOT be rewritten around the adapter. A client's defaults MAY differ by request kind (for example a reasoning-summary default on streaming and compaction requests but not on structured generation), and an entry that declares no `providerOptions` SHALL produce exactly the request bodies its client produced before this rule.

Keys that would change what the request is rather than how the model answers are reserved: the wire's model identifier, the wire's own raw output-limit field, provider-side conversation, previous-response, or container continuation identifiers, an instructions, system-prompt, or system-message-mode override, a tool-choice override, server-side fallbacks to other models, provider-attached tool servers, and any option a client owns as an invariant. Each client SHALL strip its reserved keys from the operator's object before composition, unconditionally, and SHALL document them together with its invariants, so `providerOptions` can never retarget a request to another model, attach it to state shared with another Chat or owner, replace or remove llame's prompt, discard llame's tool choice, or reach tools outside llame's gate.

A model entry's optional `maxOutputTokens` SHALL be forwarded as the `maxOutputTokens` setting of every language-model request the entry serves; when it is absent, the adapter's own default applies. The adapter derives the wire's output limit from that setting and MAY transform it as it documents — for example by adding a manual thinking budget, by lowering a value above a model ceiling it knows, or by sending it as a field a reasoning model rejects — and the client SHALL surface the adapter's warning when it emits one, SHALL record the transformations that carry no warning in the operator documentation, and SHALL NOT retry or rewrite the catalog. The system SHALL NOT validate `providerOptions` keys or values against the adapter or the provider at boot. At request time, a value the adapter recognizes but rejects SHALL fail the request explicitly under the existing failure contract; a key the adapter does not recognize is handled by the adapter alone, which MAY drop it or forward it to the endpoint, and SHALL NOT be used by llame to retarget, rewrite, or silently downgrade the request.

#### Scenario: Operator options reach the provider namespace

- **WHEN** a model entry declares `providerOptions` and a run executes through it
- **THEN** each of its language-model requests carries those options under the namespace of the adapter the provider `type` selects
- **AND** the same catalog field is honored by every executable type

#### Scenario: An entry without options sends the bodies it sent before

- **WHEN** a model entry declares no `providerOptions` and no `maxOutputTokens`
- **THEN** its streaming, compaction, and structured-generation requests carry exactly the options the client sent before this rule existed
- **AND** no default is added to a request kind that did not carry it before

#### Scenario: The run's effort takes precedence over an operator effort option

- **WHEN** a model entry's `providerOptions` sets the adapter's effort option and the run resolves an effort from the entry's declared vocabulary
- **THEN** the request carries the run's resolved effort in that option

#### Scenario: An invariant cannot be overridden

- **WHEN** a model entry's `providerOptions` sets, or sets to `null`, an option a client requires for correctness or for a shipped contract
- **THEN** the composed options carry the client's invariant value
- **AND** the operator value at that key is not sent
- **AND** where the adapter cannot carry that invariant on the option shape in use, the owning capability's stated ceiling applies instead of a rewrite around the adapter

#### Scenario: A reserved key is never sent

- **WHEN** a model entry's `providerOptions` names a reserved key (e.g. the wire model identifier or the raw `max_tokens` field on the Chat Completions wire; a previous-response or conversation identifier, an instructions override, the system-message mode, or an allowed-tools override on the Responses wire; a server-side fallback list, provider-attached tool servers, a container identifier, or the thinking block binding on the Messages wire)
- **THEN** the key is stripped before the request is composed
- **AND** the request executes against the entry's configured model, endpoint, prompt, output limit, and tools

#### Scenario: A null removes a client default at any depth

- **WHEN** a model entry's `providerOptions` sets a key the client would otherwise default to `null`, at the top level or inside an object-valued option (e.g. `{ "thinking": { "display": null } }`)
- **THEN** the request omits that key entirely
- **AND** no default is substituted

#### Scenario: Object-valued options merge with defaults

- **WHEN** a client defaults an object-valued option and the entry's `providerOptions` sets a subset of that object's keys
- **THEN** the request carries the operator's keys with the client's remaining keys
- **AND** an invariant key inside that object keeps its invariant value in the composed options

#### Scenario: The output-token limit is forwarded

- **WHEN** a model entry declares `maxOutputTokens`
- **THEN** every language-model request the entry serves carries that value as its `maxOutputTokens` setting
- **AND** the adapter derives the wire limit from it, with any warning it emits surfaced and any silent transformation documented, never a rewrite of the catalog
- **AND** an entry without it leaves the limit to the adapter's default

#### Scenario: An invalid option value fails at request time

- **WHEN** a model entry's `providerOptions` carries a value the adapter recognizes and rejects
- **THEN** startup succeeded earlier without validating it
- **AND** the request fails explicitly under the existing failure contract rather than being sent without the option

#### Scenario: An unknown option key does not fail boot or retarget the request

- **WHEN** a model entry's `providerOptions` carries a key the adapter does not recognize
- **THEN** startup succeeds
- **AND** the adapter alone decides whether the key is dropped or forwarded, and llame neither rewrites nor retargets the request because of it

### Requirement: Every provider request identifies llame

Every language-model request llame makes on behalf of any provider entry SHALL carry, unless that entry's operator header map names `User-Agent`, a `User-Agent` whose value names llame and llame's version, taken from the API package's own version and read at startup under the instance configuration contract. The value SHALL be carried on the request itself, on streaming and structured requests alike, so that the SDK's own token follows llame's rather than replacing it. The value SHALL NOT be the adapter's or SDK's identifier alone: a provider that inspects the header SHALL see llame's product token first, not a bare HTTP library or SDK name. llame's own value SHALL NOT claim another product's client identity, and a model entry's `providerOptions` SHALL NOT override it; only a `User-Agent` value in the provider entry's operator header map (`provider-request-headers`) SHALL replace it, for that entry's requests. llame's own identity is a product token, never a credential: it carries no key, account, owner, Chat, or tenant value, and it SHALL NOT be derived from any of them. Tokens the SDK or an adapter appends after llame's are out of llame's control and do not violate this requirement. Embedding requests are exempt.

#### Scenario: A request from any provider type carries the identity

- **WHEN** a language-model request is made through an entry of any executable provider type whose header map does not name `User-Agent`
- **THEN** the request carries the llame identity header
- **AND** the same llame token leads the value whichever type, wire, or endpoint served the request

#### Scenario: The identity names llame and its version

- **WHEN** a request's `User-Agent` value is inspected on an entry whose header map does not name `User-Agent`
- **THEN** it begins with llame's product token and the API package's version
- **AND** it is never the adapter's or SDK's identifier alone

### Requirement: Language-model requests carry the Chat identity

Both model-client input contracts — the streaming input and the structured-generation input — SHALL carry a required, transport-neutral Chat identity: the Chat's identifier and the lane the request belongs to, where the lane is `main`, `title`, or `search`. The field SHALL be required, so every call site supplies it and the type checker enumerates every construction site rather than allowing a default. Call sites SHALL supply facts only, never a rendered header value or a transport name: each client renders the identity in the form its own provider requires and through the request-time variable of its entry's header map (`provider-request-headers`), and sends nothing derived from it when neither applies. The main turn and every compaction path SHALL send the `main` lane, because compaction reuses the conversation's own prefix; title generation SHALL send the `title` lane; and the hosted-search sub-request of a `web-search` model-hosted engine SHALL send the `search` lane, because it shares no prefix with the conversation. The value SHALL be stable across retries, worker restarts, compaction, and model switches within the same Chat. The identity is not a credential: it is the Chat's own identifier, which llame already records, and it SHALL NOT reach model context or persisted message parts and SHALL add nothing to owner-visible output.

#### Scenario: The main turn and compaction carry the main lane

- **WHEN** a run's streaming request and a compaction request for the same Chat are made
- **THEN** both carry that Chat's identifier under the `main` lane
- **AND** the value is the same for both, so the compaction request can reuse the conversation's prefix identity

#### Scenario: Title generation carries the title lane

- **WHEN** the title service generates a title for a Chat
- **THEN** its request carries that Chat's identifier under the `title` lane
- **AND** a client that renders the lane distinguishes it from the Chat's main-lane requests

#### Scenario: A client with no consumer sends nothing extra

- **WHEN** a request is made through a client whose provider renders no identity of its own and whose entry's effective header map is empty
- **THEN** the request carries no additional header or body field derived from the identity
- **AND** the request is otherwise unchanged from the same request made before this field existed

#### Scenario: The identity is not a credential

- **WHEN** the identity is supplied to a client and the request is inspected
- **THEN** the identity value appears only in the provider-bound headers the client renders
- **AND** it appears in no model context or persisted part, and adds nothing to owner-visible output

#### Scenario: A hosted web search carries the search lane

- **WHEN** a model-hosted web search engine makes its sub-request during a Run in a Chat
- **THEN** the request carries that Chat's identifier under the `search` lane
- **AND** a client that renders the lane distinguishes it from the Chat's main-lane and title-lane requests

### Requirement: Chat Completions failures reach the run as bounded messages

Every language-model request with a response stream on the Chat Completions
wire MUST report a failure from the endpoint's response. The failure MUST fall
under one of these classes. This rule covers an `openai-completions` entry and
an `opencode-go` entry. The classes apply in this order:

1. llame MUST report a response with a redirect status (301, 302, 303, 307, or 308) as a fixed text. The transport hands that response back to the client
   unfollowed, whatever its body. The text MUST state that the provider
   answered with a redirect that llame does not follow, and it MUST name the
   status code. This contract does not change which transports follow
   redirects. An `opencode-go` entry's transport refuses every redirect, so
   each redirect reaches this class. An `openai-completions` entry's transport
   follows redirects as it does today, and llame reports its request by the
   response where its redirects end.

2. llame MUST report an event inside the response stream as a fixed text when
   that event is not JSON or does not match the wire's chunk shape. The text
   MUST state that the provider sent a stream event that llame cannot read.
   The same rule applies to an event that carries an error value without a
   string message.

3. llame MUST report an event that carries the wire's error envelope (an
   `error` object with a string `message`) as the parsed message. llame MUST
   apply configured-credential redaction to that message.

4. For any other failure response, llame MUST report the parsed envelope
   message when the body is the envelope. Otherwise llame MUST report the HTTP
   status text. llame MUST apply configured-credential redaction to that
   message.

When the SDK's own retry rules retry a class 4 failure, llame MUST report the
SDK's retry summary of those attempts, as it does today. A redirect that
answers a retried request MUST still fall under class 1 alone, without that
summary. The run MUST record that message, show it to the owner whose run
failed, and emit it on its terminal run event. The run MUST also write that
message to its failure log line.

The unreadable-event text MUST be identical for every event. The redirect text
MUST be identical for every response with the same status code. The
unreadable-event text MUST NOT contain any content of the event or a response
header. The redirect text MUST NOT contain the redirect's `Location` value,
any content of the event, or a response header.

A failure MUST NOT expose the failure response's body or headers on the run's
surfaces. It MUST NOT expose the content of a stream event other than a parsed
envelope message. It MUST NOT expose the request body or the credential.

The error that llame reports for classes 1 and 2 MUST carry no reference to
the event or response that caused it. Suppose a request's caller supplies no
error handler, such as compaction or text-path title generation. That request
MUST report class 1 and 2 failures through that same bounded error.

A failure that did not come from the endpoint's response, such as a transport
failure, MUST keep the message it has today, after configured-credential
redaction. A failure in this contract MUST NOT cause a retry beyond the SDK's
own rules. It MUST NOT cause a fallback to another provider, wire, or model,
or a rewritten request.

#### Scenario: An unreadable stream event is reported without its content

- **WHEN** a response stream delivers some text and then an event that is not JSON and holds a canary value
- **THEN** the run fails with the fixed unreadable-event text
- **AND** the run's failure message, its persisted error, its terminal run event, and its failure log line do not contain the canary

#### Scenario: A schema-mismatched stream event is reported like an unparseable one

- **WHEN** a response stream delivers an event that is valid JSON but does not match the wire's chunk shape. The event holds a canary value
- **THEN** the run fails with the same fixed text as for an event that is not JSON
- **AND** no surface the run writes contains the canary

#### Scenario: An error value without a message is reported as unreadable

- **WHEN** a response stream delivers an event whose `error` value is a string or an object without a string `message`. That value holds a canary
- **THEN** the run fails with the fixed unreadable-event text
- **AND** its failure message is neither the canary nor a text form of the object such as `[object Object]`

#### Scenario: The fixed text does not vary with the event

- **WHEN** two runs fail on two different unreadable stream events
- **THEN** both runs record the identical failure message

#### Scenario: An error envelope inside the stream keeps its parsed message

- **WHEN** a response stream delivers an event with the error envelope and a message
- **THEN** the run's failure message is that parsed message
- **AND** it is not a text form of the envelope object, such as `[object Object]`, and carries no other envelope field

#### Scenario: An HTTP failure keeps its current message

- **WHEN** the endpoint answers with a non-redirect failure status whose body is the error envelope, or whose body is not the envelope
- **THEN** the run's failure message is the parsed message, or the HTTP status text, respectively, inside the SDK's retry summary when the status was retried
- **AND** no response body, response header, request body, or credential appears in any surface the run writes

#### Scenario: A refused redirect is described without its target

- **WHEN** a client that does not follow redirects receives a redirect response with a `Location` header
- **THEN** the run fails with the fixed redirect text and that text names the status code
- **AND** no surface the run writes contains the `Location` value, and no second request is made

#### Scenario: A redirect after a retried failure is still described as a redirect

- **WHEN** a retryable failure status is followed, on the SDK's retry, by a redirect response
- **THEN** the run's failure message is the fixed redirect text. That text names the redirect's status code
- **AND** it contains neither the `Location` value nor the redirect's bare status text

#### Scenario: A transport failure keeps its message

- **WHEN** the request cannot reach the endpoint and the transport rejects
- **THEN** the run's failure message is the one the SDK reports for a transport failure today

#### Scenario: A caller without an error handler logs the bounded error

- **WHEN** a request without a caller-supplied error handler, such as a compaction summary, receives an unreadable stream event. The event holds a canary value
- **THEN** the error logged for that request is the bounded unreadable-event error
- **AND** the log output does not contain the canary

### Requirement: The Responses wire stores no response and carries encrypted reasoning

Each `openai-responses` request MUST send `store: false`. A request for a model
entry that declares `reasoning` MUST also ask for the encrypted content of
reasoning items, whatever its model id. For another entry, the adapter decides
from its model id, as today. `store: false` is a client invariant under the
precedence rule, so the `providerOptions` of an operator cannot change it. A replayed reasoning part MUST go back with its
encrypted content, not as a reference to a stored item.

#### Scenario: A reasoning entry stores nothing and asks for encrypted reasoning

- **WHEN** a Run executes on an `openai-responses` model entry that declares `reasoning`
- **THEN** each request carries `store: false` and asks for `reasoning.encrypted_content`

#### Scenario: A reasoning entry under another id asks too

- **WHEN** a model entry declares `reasoning` and names its model `proxy-reasoner`, an id that the adapter does not know
- **THEN** each request asks for `reasoning.encrypted_content`

#### Scenario: A non-reasoning entry keeps the adapter default

- **WHEN** a Run executes on an `openai-responses` model entry `gpt-4.1` that declares no `reasoning`
- **THEN** each request carries `store: false`
- **AND** the adapter asks for no `reasoning.encrypted_content`, as for that id today

#### Scenario: An operator cannot turn storage on

- **WHEN** the `providerOptions` of an `openai-responses` model entry set `store: true`
- **THEN** the request carries `store: false`
- **AND** the operator value is not sent

#### Scenario: Earlier reasoning replays as encrypted content

- **WHEN** a later turn on the same model replays a reasoning part that carries encrypted content
- **THEN** the request carries a reasoning item with that encrypted content
- **AND** the request carries no `item_reference`

#### Scenario: A part with only an item id is omitted

- **WHEN** a reasoning part persisted before this change carries an item id and no encrypted content
- **THEN** the request does not carry that part
- **AND** the request succeeds

### Requirement: Provider failures never carry a configured credential

A failure message MUST NOT contain a member of the configured credential set
(`instance-config`) on any provider wire or request kind. This rule applies
when llame records the message, shows it, emits it on a run event, or logs it.
It also applies to the messages on a cause chain and to a caller with no error
handler. Where a wire forwards upstream text, the member MUST become
`[REDACTED]`. Redaction MUST NOT change how llame classifies a failure.

#### Scenario: An echoed credential is redacted where upstream text is forwarded

- **WHEN** a stubbed upstream for an `openai-responses`, `openai-completions`, or `opencode-go` entry fails with a message that holds that entry's resolved `key`
- **THEN** the run's failure message and its terminal run event contain `[REDACTED]` and not the key
- **AND** the run's failure log line contains no key

#### Scenario: No wire reports an echoed credential

- **WHEN** a stubbed upstream for an `anthropic-messages` or `openai-codex` entry fails with a message that holds that entry's resolved `key`
- **THEN** the run's failure message, its terminal run event, and its failure log line contain no key

#### Scenario: Every request kind is covered

- **WHEN** compaction, title generation, a hosted web search, or a structured generation fails with an upstream message that holds a configured header substitution
- **THEN** no recorded, emitted, or logged message contains the substitution. This rule also covers the log line for a request that supplies no error handler

#### Scenario: Classification survives redaction

- **WHEN** a failure that contains a configured credential is a stalled stream, a retried rate limit, or an authentication rejection
- **THEN** the run and a hosted web search classify it exactly as they classify the same failure without the credential
- **AND** a failure with a credential in a message that llame cannot rewrite on the original error reaches the run through a replacement. That replacement still classifies as the original

#### Scenario: A failure without a credential is unchanged

- **WHEN** an `openai-completions` upstream fails once, without retry, with the envelope message `Invalid API key.` and no configured credential occurs in it
- **THEN** the reported message is exactly `Invalid API key.`
