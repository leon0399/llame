## MODIFIED Requirements

### Requirement: Chat Completions failures reach the run as bounded messages

Every language-model request with a response stream on the Chat Completions
wire MUST report a failure from the endpoint's response. The failure MUST fall
under one of these message cases. This rule covers any account whose model resolves
the Chat Completions wire, and Go is one of them. The cases apply in this order:

1. llame MUST report a response with a redirect status (301, 302, 303, 307, or 308) as a fixed text. The transport hands that response back to the client
   unfollowed, whatever its body. The text MUST state that the provider
   answered with a redirect that llame does not follow, and it MUST name the
   status code. This contract does not change which transports follow
   redirects. An `opencode-go` entry's transport refuses every redirect, so
   each redirect reaches this case. An `openai-completions` entry's transport
   follows redirects as it does today, and llame reports its request by the
   response where its redirects end.

2. llame MUST report a fixed text for a stream event that is not JSON or that
   does not match the wire's chunk shape. The text
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

The SDK MUST make no retry. When the request retries of `provider-failures`
send the request again, llame MUST report the message of the last failure. A
redirect that answers a request retry MUST fall under case 1. The run MUST record that message, show it to the owner whose run
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

The error that llame reports for cases 1 and 2 MUST carry no reference to
the event or response that caused it. Suppose a request's caller supplies no
error handler, such as compaction or text-path title generation. That request
MUST report case 1 and 2 failures through that same bounded error.

A failure that did not come from the endpoint's response, such as a transport
failure, MUST keep the message it has today, after configured-credential
redaction. A failure in this contract MUST NOT cause a retry beyond the request retries
of `provider-failures`. Each failure MUST also carry its failure class. It MUST NOT cause a fallback to another provider, wire, or model,
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
- **THEN** the run's failure message is the parsed message, or the HTTP status text, respectively, of the last failed request
- **AND** no response body, response header, request body, or credential appears in any surface the run writes

#### Scenario: A refused redirect is described without its target

- **WHEN** a client that does not follow redirects receives a redirect response with a `Location` header
- **THEN** the run fails with the fixed redirect text and that text names the status code
- **AND** no surface the run writes contains the `Location` value, and no second request is made

#### Scenario: A redirect after a retried failure is still described as a redirect

- **WHEN** a retryable failure status is followed, on a request retry, by a redirect response
- **THEN** the run's failure message is the fixed redirect text. That text names the redirect's status code
- **AND** it contains neither the `Location` value nor the redirect's bare status text

#### Scenario: A transport failure keeps its message

- **WHEN** the request cannot reach the endpoint and the transport rejects
- **THEN** the run's failure message is the one the SDK reports for a transport failure today, and its failure class is `unreachable`

#### Scenario: A caller without an error handler logs the bounded error

- **WHEN** a request without a caller-supplied error handler, such as a compaction summary, receives an unreadable stream event. The event holds a canary value
- **THEN** the error logged for that request is the bounded unreadable-event error
- **AND** the log output does not contain the canary
