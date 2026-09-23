## ADDED Requirements

### Requirement: Chat Completions failures reach the run as bounded messages

Every language-model streaming request on the Chat Completions wire, whether
made for an `openai-completions` entry or an `opencode-go` entry, SHALL fail
under one failure contract. The message that contract produces SHALL be the
message the run records, shows to the owner whose run failed, emits on the
run's events, and logs, and it SHALL be exactly one of:

- the endpoint's parsed error message, when a failure response or an event
  inside the response stream carries the wire's error envelope (an `error`
  object with a `message`); the message MAY name request values the endpoint
  chose to echo;
- the HTTP status text, when a failure response's body is not that envelope
  and its status is not a redirect;
- a fixed text stating that a redirect was refused and naming its HTTP status
  code, when a redirect response reaches a client that does not follow
  redirects;
- a fixed text stating that the stream carried an event that could not be
  read, when an event inside the response stream is not JSON or does not match
  the wire's chunk shape.

Retryable statuses SHALL follow the SDK's own retry rules before the message
is produced. A fixed text SHALL be identical whatever the event or response
that caused it, and SHALL carry no byte of that event, no redirect target, and
no response header. For every class, the failure response's body and headers,
the bytes of the stream event, the request body, and the credential SHALL NOT
reach owner output, the persisted run, run events, or logs. The error the run
receives for an unreadable stream event SHALL carry no reference to that event,
and a request whose caller supplies no error handler, such as compaction or
text-path title generation, SHALL report that event through the same bounded
error rather than the original parse error.
A failure that did not come from the endpoint's bytes, such as a transport
failure, a timeout, or a cancellation, SHALL keep the message it has today. No
failure in this contract SHALL cause a retry beyond the SDK's own rules, a
fallback to another provider, wire, or model, or a rewritten request.

#### Scenario: An unreadable stream event is reported without its bytes

- **WHEN** a streaming response delivers some text and then an event that is not JSON and contains a canary value
- **THEN** the run fails with the fixed unreadable-event text
- **AND** the run's failure message, its persisted error, its run event, and its log line contain neither the canary nor any other byte of that event

#### Scenario: A schema-mismatched stream event is reported like an unparseable one

- **WHEN** a streaming response delivers an event that is valid JSON but does not match the wire's chunk shape, and the event contains a canary value
- **THEN** the run fails with the same fixed text as for an event that is not JSON
- **AND** no surface the run writes contains the canary

#### Scenario: The fixed text does not vary with the event

- **WHEN** two runs fail on two different unreadable stream events
- **THEN** both runs record the identical failure message

#### Scenario: An error envelope inside the stream keeps its parsed message

- **WHEN** a streaming response delivers an event carrying the error envelope with a message
- **THEN** the run's failure message is that parsed message
- **AND** it is not a rendering of the envelope object, such as `[object Object]`, and carries no other envelope field

#### Scenario: An HTTP failure keeps its current message

- **WHEN** the endpoint answers with a non-redirect failure status whose body is the error envelope, or whose body is not the envelope
- **THEN** the run's failure message is the parsed message, or the HTTP status text, respectively, after the SDK's retries for retryable statuses
- **AND** no response body, response header, request body, or credential appears in any surface the run writes

#### Scenario: A refused redirect is described without its target

- **WHEN** a client that does not follow redirects receives a redirect response with a `Location` header
- **THEN** the run fails with the fixed refused-redirect text naming the status code
- **AND** no surface the run writes contains the `Location` value, and no second request is made

#### Scenario: A caller without an error handler logs the bounded error

- **WHEN** a streaming request made without a caller-supplied error handler, such as a compaction summary, receives an unreadable stream event containing a canary value
- **THEN** the error logged for that request is the bounded unreadable-event error
- **AND** the log output does not contain the canary
