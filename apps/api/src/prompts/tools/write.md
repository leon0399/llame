Create a new local UTF-8 file, or replace an existing file's contents with replace: true.

<instruction>
- path is an absolute host path, a `machine://<name><absolute path>` locator on an operator-configured remote Machine, or a kb:// Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}}, or a `file:///absolute/path`, `file://localhost/absolute/path`, or `file:/absolute/path` alias for the absolute path with identical write behavior, without its :range suffix.
- a relative local path resolves from the entered Workspace root and is refused when none is entered.
- An absolute path has the host OS user's file authority and needs a configured native executor; kb:// needs none. A Machine locator runs as that Machine's OS user with no sandbox and needs no local executor; its registered roots bound addressing only, that user can change them, and a Machine shared between users gives no isolation between them.
</instruction>

<conditions>
- Creating fails with file_exists when the target exists; replacing needs an existing file and fails with not_found when none exists.
</conditions>

<output>
- A result is plain text, not JSON: one status line, `created <path>` or `replaced <path>`, continued with ` (<n> lines)` when the written file's line count is stored, then the attribution lines it carries.
- The written content is never returned, and neither is a diff; read the path to see the bytes you wrote.
- Text is neutralized for reserved delimiters: a tag-shaped token naming `system-reminder`, `tool-call`, `tool-result`, `user_chat_history`, `user_personalization`, `skill`, or `available_skills` is angle-escaped (`&lt;tool-result&gt;`); every other character is the source as stored.
</output>{{#if tools.edit}}

<critical>
- Use edit for a partial change.
</critical>{{/if}}
