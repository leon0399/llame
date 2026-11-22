Replace one exact unique oldText occurrence with newText in a file on the current Machine.

<instruction>
- path is an absolute path on the current Machine, a `machine://<name><absolute path>` locator naming a configured Machine, or a kb:// Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}}, or a `file:///absolute/path`, `file://localhost/absolute/path`, or `file:/absolute/path` alias for the absolute path on the current Machine with identical edit behavior, without its :range suffix.
- a relative path resolves from the entered Workspace root, on the Workspace's Machine, and is refused when no Workspace is entered.
- An absolute path has the current Machine's OS user file authority; kb:// needs none. A Machine locator runs as that Machine's OS user with no sandbox; its registered roots bound addressing only, that user can change them, and a Machine shared between users gives no isolation between them.
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
