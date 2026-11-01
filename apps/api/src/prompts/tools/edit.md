Replace one exact unique oldText occurrence with newText in a current local file.

<instruction>
- path is an absolute path on this native host, a `machine://<name><absolute path>` locator on an operator-configured remote Machine, or a kb:// Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}}, or a `file:///absolute/path`, `file://localhost/absolute/path`, or `file:/absolute/path` alias for the absolute path with identical edit behavior, without its :range suffix.
- a relative local path resolves from the entered Workspace root and is refused when none is entered.
- An absolute path has the host OS user's file authority and needs a configured native executor; kb:// needs none. A Machine locator runs as that Machine's OS user with no sandbox and needs no local executor; its registered roots bound addressing only, that user can change them, and a Machine shared between users gives no isolation between them.
- Empty newText deletes.
</instruction>

<output>
- A result is plain text, not JSON: one header line `edited <path>: line <startLine>, <old> -> <new> lines`, continued with ` (<total> lines total)` when the file's line count is stored, then the attribution lines it carries, then the post-edit region around the change with two live lines each side, numbered `N: text` from the post-edit file.
- Line-number prefixes are navigation metadata, never file bytes; copy oldText from the region without them.
- `[region cut at the bound]` marks a region the result bound cut, and a bracketed cap notice can end the text. The result carries no diff, no separate old text, and no separate new text.
- A result stored before this shape starts `edited <path>: region from line <N>` and then carries its region only.
- Text is neutralized for reserved delimiters: a tag-shaped token naming `system-reminder`, `tool-call`, `tool-result`, `user_chat_history`, `user_personalization`, `skill`, or `available_skills` is angle-escaped (`&lt;tool-result&gt;`); every other character is the source as stored.
</output>

<critical>
- Missing or ambiguous oldText fails without changing the file.
</critical>
