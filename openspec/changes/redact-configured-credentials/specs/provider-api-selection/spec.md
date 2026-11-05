## ADDED Requirements

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

## MODIFIED Requirements

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
