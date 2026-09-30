# Tool prompt templates

llame ships a Markdown description for each of its own tools and renders it for
every execution attempt. An operator can replace any description with a template
file, instance-wide or for a single model. The same template subset that renders
`systemPromptFile` renders these, against the same variable projection.

The seven llame-owned tool ids are `bash`, `conversation_read`, `edit`,
`knowledge_search`, `read`, `search_conversations`, and `write`. MCP tool
descriptions come from their server and are never templated.

## Configure overrides

```jsonc
{
  "tools": {
    "promptFiles": { "search_conversations": "./prompts/search.md" },
  },
  "models": [
    {
      "id": "system:openai:gpt-5.6-sol",
      "toolPromptFiles": { "bash": "./prompts/bash-sol.md" },
    },
  ],
}
```

For each tool id, the first source that exists wins:

1. `models[].toolPromptFiles[id]` — this model only.
2. `tools.promptFiles[id]` — this instance.
3. the packaged `prompts/tools/<id>.md` — `apps/api/src` in the source tree,
   `apps/api/dist` in a build.

An override replaces the whole description; nothing is merged or appended. A
`null` or absent entry means no override at that level: it never blanks a
description and never clears a lower-priority source. Only an advertised tool is
rendered: a description for a tool the instance does not allow is validated but
never sent.

Keys must name a registered llame-owned tool id. An MCP id, a wildcard, or a
typo fails startup of the process that reads the files.

Paths are literal host paths — `{env:...}` and `{path:...}` interpolation does
not apply, because the resolved description is visible to chat owners. A
relative path resolves against the directory of the active `llame.config.json`;
an absolute path stays absolute. Line endings are normalized and trailing
whitespace is trimmed, so an override that reduces to nothing is an error rather
than an empty description.

## Template language

Values are escaped for `&`, `<`, and `>`, and owner-authored fields are
sanitized before projection.

### Values

| Path                                                                                                                       | Contents                            |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `{{model.id}}`, `{{model.name}}`                                                                                           | The selected model                  |
| `{{user.name}}`, `{{user.email}}`                                                                                          | Owner account identity              |
| `{{user.personalization.preferredName}}`, `{{user.personalization.about}}`, `{{user.personalization.responsePreferences}}` | Owner-authored personalization      |
| `{{chats.pinnedShown}}`, `{{chats.pinnedTotal}}`, `{{chats.recentShown}}`, `{{chats.recentTotal}}`, `{{chats.compiledOn}}` | Recency-digest counts and bake date |
| `{{context.systemTime}}`, `{{context.systemTimezone}}`                                                                     | Temporal anchor — always present    |

These paths render empty when a value is absent (no digest baseline for this
chat, nothing configured on the owner), so `{{#if user.name}}…{{/if}}` is
expressible. Any other path fails validation instead of rendering empty.

### Conditionals

`{{#if}}` and `{{#unless}}` accept the gate subjects below; a gate subject can
never be emitted as a value:

- `user` — true when any owner value would render.
- `user.personalization` — true when any authored field would render.
- `chats`, `chats.pinned`, `chats.recent` — true when that digest content is
  present.
- `tools.<exact-id>` — tool membership for this attempt.

`{{#if tools.read}}` is true exactly when that exact tool id is advertised on
the current attempt. Everything else is false, not an error: an unknown native
id, an MCP tool whose server is offline, and an MCP server that is not
configured. This is the only way a description reacts to tool membership:

```handlebars
{{#if tools.edit}}Prefer native edit for small exact replacements.{{/if}}
```

Predicates are conditional-only and exact: `{{tools.read}}`, `{{#if tools}}`,
`{{#if tools.read.description}}`, `{{#if tools.[*]}}`, and
`{{#if ../tools.read}}` are all rejected, as are prototype names such as
`tools.constructor`.

Owner and digest values resolve per attempt; nothing rendered is shared between
attempts, owners, or chats.

### Iteration

`{{#each chats.pinned}}` and `{{#each chats.recent}}` iterate digest entries.
An entry exposes `{{title}}`, `{{date}}`, `{{messageCount}}`, and `{{excerpt}}`
and nothing else. A loop's `{{else}}` arm renders when the collection is absent.
No other collection is iterable, and iteration does not nest.

### Restrictions

- Helpers are `if`, `unless`, and `each`; any other helper or a subexpression is
  rejected.
- No partials, no unescaped `{{{…}}}` output, no `@index`/`@key`/`@data`
  references, no `../` traversal, no bracketed path segments.
- Comments and whitespace control are supported.
- A file must contain literal text somewhere (inside a conditional arm counts);
  a template that is only expressions is rejected as empty when it loads.

## Validation

Configuration shape is checked wherever `llame.config.json` loads:
`tools.promptFiles` and `models[].toolPromptFiles` must be objects whose keys
are non-empty strings and whose values are non-empty strings or `null`.

The process that executes Runs reads and validates every configured file when it
starts — the API does this too while Run consumers are co-located, as does each
dedicated worker. Each of these fails that process's startup, with no fallback
to the packaged text:

- a key that is not a registered llame-owned tool id;
- a missing, unreadable, non-regular, or empty file;
- an unsupported construct, named in the error with its configuration path;
- a file that can render empty, named in the error with its configuration path.
  Each file is rendered once per configured model, with every combination of the
  independent `user`, `chats`, and `skills` gates, and with no tools admitted and
  with every tool the template names. Text hidden behind a gate an ordinary
  attempt can fail (`{{#if user.personalization}}…{{/if}}`) fails startup;
  guidance gated on a tool that can be absent from an attempt
  (`{{#if tools.edit}}…{{/if}}`) does not, because another attempt renders it.

Every configured entry is read, including a shadowed override and an override
for a tool the instance does not allow. Acceptance itself neither reads nor
renders descriptions.

Rendering is per attempt. Before the target model request, each description is
rendered with that attempt's admitted tool set; if the rendered result is empty,
the attempt fails there. The Run is marked failed with `description rendered
empty`, the user message and the Run survive, and no tool is silently dropped or
backfilled with its packaged text. Rendered descriptions stay in the worker's
memory for that attempt.

## Receipts

Every attempt that reaches prompt preparation writes one immutable receipt.
`GET /api/v1/runs/:id/context-receipt` returns them to their owner:

- `state`: `pending` (queued, nothing prepared), `prepared`, or `not_produced`
  (terminal with no receipt);
- `activeAttemptId` and `completedAttemptId` when known;
- `receipts[]`, earliest first, each with `attemptId`, `promptSource`,
  `systemPrompt`, `promptHash`, and `createdAt`.

`promptSource` is `project_default` or `model_override` and describes the
system prompt selection only.

A receipt is system-only. It carries no tool catalog, declaration, schema,
rendered description, or availability manifest, and no host path; a `promptHash`
covers the rendered system prompt alone. Because descriptions are rendered per
attempt and never stored, a receipt is not a historical record of what the model
was shown: editing a template changes nothing already stored, and no surface can
answer which description text a past attempt sent.

The only committed tool state is the minimal per-successful-turn record: exact
tool ids with `available` or `unavailable`, written only when a turn commits
successfully, and read back as the preceding observation that a later successful
turn compares against. It contains no schema, description, hash, endpoint, or
failure detail, and it is not part of the context receipt.

## Deployment and cutover

Prompt files and configuration are restart-applied: editing a file changes
nothing until the processes that execute Runs restart. Restart the API and every
worker on the matching revision; the `dist/main.js` and `dist/worker.js`
entrypoints both validate the files they will use.

This release also replaces the combined `model_context_snapshots` storage with
system-only attempt receipts and the minimal availability record. Historical
tool catalogs are removed rather than migrated, so the cutover is coordinated:

1. Take a database backup. Removed catalogs cannot be rebuilt honestly, so
   rolling back to the previous revision requires this backup.
2. Quiesce acceptance and drain active Runs on the old revision. A mixed fleet
   is unsupported: a process on the old revision writes the dropped table.
3. Apply the migration with `pnpm db:migrate`.
4. Start the API and every worker together on the matching revision.

The migration preserves messages and reminders, active summaries and
checkpoints, and digest baselines; it does not reset or discard live chats, and
it makes no claim about context produced by failed pre-cutover Runs.

## Troubleshooting

| Symptom                                       | Check                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Startup rejects a tool id                     | The key is not one of the seven llame-owned ids; MCP ids are never valid                                                      |
| Startup rejects a path                        | Relative paths resolve against the config file's directory; the file exists, is readable, is a regular file, and is not empty |
| Startup rejects a construct                   | The template uses a path, helper, or output form outside the subset above                                                     |
| A Run fails with `description rendered empty` | The description's text is gated on a tool that is not advertised for that attempt                                             |
| An edit has no effect                         | The processes that execute Runs were not restarted                                                                            |
| The receipt shows no tools                    | Expected: receipts are system-only                                                                                            |
