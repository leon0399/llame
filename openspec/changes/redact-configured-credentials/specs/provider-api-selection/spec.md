## ADDED Requirements

### Requirement: Provider failures never carry a configured credential

On every provider wire and request kind, no failure message, including the
messages on its cause chain, SHALL contain a member of the configured
credential set (`instance-config`) when it is recorded, shown, emitted on a run
event, or logged, even by a caller with no error handler. Where a wire
forwards upstream text, a member SHALL become `[REDACTED]`. Redaction SHALL NOT
change how a failure is classified.

#### Scenario: An echoed credential is redacted where upstream text is forwarded

- **WHEN** a stubbed upstream for an `openai-responses`, `openai-completions`, or `opencode-go` entry fails with a message containing that entry's resolved `key`
- **THEN** the run's failure message and its terminal run event contain `[REDACTED]` and not the key
- **AND** the run's failure log line contains no key

#### Scenario: No wire reports an echoed credential

- **WHEN** a stubbed upstream for an `anthropic-messages` or `openai-codex` entry fails with a message containing that entry's resolved `key`
- **THEN** the run's failure message, its terminal run event, and its failure log line contain no key

#### Scenario: Every request kind is covered

- **WHEN** compaction, title generation, a hosted web search, or a structured generation fails with an upstream message containing a configured header substitution
- **THEN** no recorded, emitted, or logged message contains the substitution, including the log line written for a request that supplies no error handler

#### Scenario: Classification survives redaction

- **WHEN** a failure that contains a configured credential is a stalled stream, a retried rate limit, or an authentication rejection
- **THEN** the run and a hosted web search classify it exactly as they would the same failure without the credential

#### Scenario: A failure without a credential is unchanged

- **WHEN** an `openai-completions` upstream fails once, without retry, with the envelope message `Invalid API key.` and no configured credential occurs in it
- **THEN** the reported message is exactly `Invalid API key.`

## MODIFIED Requirements

### Requirement: Chat Completions failures reach the run as bounded messages

Every language-model streaming request on the Chat Completions wire, whether
made for an `openai-completions` entry or an `opencode-go` entry, SHALL report
a failure that came from the endpoint's response under one of these classes,
applied in this order:

1. A response with a redirect status (301, 302, 303, 307, or 308) that the
   transport hands back to the client unfollowed, whatever its body, SHALL be
   reported as a fixed text stating that the provider answered with a redirect
   that is not followed and naming the status code. This contract does not
   change which transports follow redirects: an `opencode-go` entry's
   transport refuses every redirect, so each one reaches this class, while an
   `openai-completions` entry's transport follows redirects as it does today,
   and its request is reported by the response its redirects end at.
2. An event inside the response stream that is not JSON, does not match the
   wire's chunk shape, or carries an error value without a string message
   SHALL be reported as a fixed text stating that the provider sent a stream
   event that could not be read.
3. An event inside the response stream that carries the wire's error envelope
   (an `error` object with a string `message`) SHALL be reported as that parsed
   message, after configured-credential redaction.
4. Any other failure response SHALL be reported as it is today, after
   configured-credential redaction: its parsed envelope message when the body
   is the envelope, otherwise its HTTP status text.

When the SDK's own retry rules retry a class 4 failure, the reported message
SHALL be the SDK's retry summary of those attempts, as it is today. A redirect
that answers a retried request SHALL still be reported as class 1 alone,
without that summary. The message SHALL be the one the run records, shows to
the owner whose run failed, emits on its terminal run event, and writes to its
failure log line.

The unreadable-event text SHALL be identical for every event, and the redirect
text identical for every response with the same status code. Neither SHALL
contain any content of the event, the redirect's `Location` value, or a
response header. On the run's surfaces, no failure SHALL expose the failure
response's body or headers, the content of a stream event other than a parsed
envelope message, the request body, or the credential. The error reported for
classes 1 and 2 SHALL carry no reference to the event or response that caused
it, and a request whose caller supplies no error handler, such as compaction or
text-path title generation, SHALL report class 1 and 2 failures through that
same bounded error.

A failure that did not come from the endpoint's response, such as a transport
failure, SHALL keep the message it has today, after configured-credential
redaction. No failure in this contract SHALL
cause a retry beyond the SDK's own rules, a fallback to another provider, wire,
or model, or a rewritten request.

#### Scenario: An unreadable stream event is reported without its content

- **WHEN** a streaming response delivers some text and then an event that is not JSON and contains a canary value
- **THEN** the run fails with the fixed unreadable-event text
- **AND** the run's failure message, its persisted error, its terminal run event, and its failure log line do not contain the canary

#### Scenario: A schema-mismatched stream event is reported like an unparseable one

- **WHEN** a streaming response delivers an event that is valid JSON but does not match the wire's chunk shape, and the event contains a canary value
- **THEN** the run fails with the same fixed text as for an event that is not JSON
- **AND** no surface the run writes contains the canary

#### Scenario: An error value without a message is reported as unreadable

- **WHEN** a streaming response delivers an event whose `error` value is a string or an object without a string `message`, and that value contains a canary
- **THEN** the run fails with the fixed unreadable-event text
- **AND** its failure message is neither the canary nor a rendering of the object such as `[object Object]`

#### Scenario: The fixed text does not vary with the event

- **WHEN** two runs fail on two different unreadable stream events
- **THEN** both runs record the identical failure message

#### Scenario: An error envelope inside the stream keeps its parsed message

- **WHEN** a streaming response delivers an event carrying the error envelope with a message
- **THEN** the run's failure message is that parsed message
- **AND** it is not a rendering of the envelope object, such as `[object Object]`, and carries no other envelope field

#### Scenario: An HTTP failure keeps its current message

- **WHEN** the endpoint answers with a non-redirect failure status whose body is the error envelope, or whose body is not the envelope
- **THEN** the run's failure message is the parsed message, or the HTTP status text, respectively, inside the SDK's retry summary when the status was retried
- **AND** no response body, response header, request body, or credential appears in any surface the run writes

#### Scenario: A refused redirect is described without its target

- **WHEN** a client that does not follow redirects receives a redirect response with a `Location` header
- **THEN** the run fails with the fixed redirect text naming the status code
- **AND** no surface the run writes contains the `Location` value, and no second request is made

#### Scenario: A redirect after a retried failure is still described as a redirect

- **WHEN** a retryable failure status is followed, on the SDK's retry, by a redirect response
- **THEN** the run's failure message is the fixed redirect text naming the redirect's status code
- **AND** it contains neither the `Location` value nor the redirect's bare status text

#### Scenario: A transport failure keeps its message

- **WHEN** the request cannot reach the endpoint and the transport rejects
- **THEN** the run's failure message is the one the SDK reports for a transport failure today

#### Scenario: A caller without an error handler logs the bounded error

- **WHEN** a streaming request made without a caller-supplied error handler, such as a compaction summary, receives an unreadable stream event containing a canary value
- **THEN** the error logged for that request is the bounded unreadable-event error
- **AND** the log output does not contain the canary
