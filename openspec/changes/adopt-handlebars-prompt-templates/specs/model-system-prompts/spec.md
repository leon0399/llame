## MODIFIED Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default.

Both prompt-file kinds SHALL be **Handlebars templates** over an explicit context projection. The renderable context SHALL expose exactly `model.id` for the public llame model id and `model.name` for the configured public name; operators MAY use the built-in `if` and `unless` conditionals, and MAY emit a literal expression by escaping it in the engine's own notation. Referencing a context path outside the allowlist, emitting unescaped output, referencing a partial, invoking any other helper, or leaving a stale pre-cutover `${...}` expression SHALL fail startup naming the model id and the offending construct without printing prompt contents. Referencing `model.name` when the selected model has no configured name SHALL also fail startup.

Validation SHALL occur at boot against the template; rendering SHALL be lenient, so an allowlisted path with no value at request time renders empty rather than failing a run. Escaped output SHALL neutralize characters that could forge a structural delimiter while leaving ordinary prose punctuation intact. Resolution SHALL remain single-pass and non-recursive before hashing and snapshotting: rendered output MUST NOT be re-parsed or re-evaluated as a template. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt — the prohibition on fragments and inheritance is what requires partials to be rejected.

#### Scenario: Model has no prompt override

- **WHEN** a run selects a configured model whose entry omits `systemPromptFile`
- **THEN** the run's effective system prompt is the project-default prompt
- **AND** the receipt identifies its source as the project default

#### Scenario: Two models use materially different prompts

- **WHEN** two configured models reference different valid prompt files
- **THEN** a run for each model receives that model's complete rendered contents as its top-level system prompt
- **AND** neither prompt is inherited or composed from the other

#### Scenario: Default prompt renders model id and name

- **WHEN** the project-default prompt references `model.id` and `model.name` and a configured model supplies both values
- **THEN** that model's effective prompt contains the public id and configured name
- **AND** its immutable snapshot contains the rendered text rather than the expressions

#### Scenario: Prompt requests an absent model name

- **WHEN** a selected default or override prompt references `model.name` and that model omits `name`
- **THEN** startup fails naming the model id and that path
- **AND** no partially rendered prompt is applied

#### Scenario: Literal expression is emitted

- **WHEN** a prompt escapes an expression in the engine's literal notation
- **THEN** its effective prompt contains that expression as literal text
- **AND** the emitted literal is not recursively interpolated

#### Scenario: Prompt uses a conditional

- **WHEN** a prompt wraps a label and its value in an `if` conditional over an allowlisted path
- **THEN** the wrapped region renders only when that path has a value
- **AND** the surrounding prompt structure is otherwise unchanged

#### Scenario: Prompt contains a disallowed construct

- **WHEN** a prompt references an unknown context path, emits unescaped output, references a partial, invokes another helper, or retains a stale `${...}` expression
- **THEN** startup fails naming the model id and the offending construct
- **AND** no raw config, environment, or server-only field is exposed

#### Scenario: Configured override is broken

- **WHEN** a model declares `systemPromptFile` but the file cannot resolve to a valid non-empty prompt
- **THEN** instance startup fails
- **AND** the system does not silently substitute the project default

#### Scenario: Rendered output is not re-evaluated

- **WHEN** a rendered value itself contains template-looking text
- **THEN** that text appears literally in the effective prompt
- **AND** no second parse or render pass occurs
