Replace one exact unique oldText occurrence with newText in a current local file.

<instruction>
- path is an absolute path on this native host, a `machine://<name><absolute path>` locator on an operator-configured remote Machine, or a kb:// Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}}, or a `file:///absolute/path`, `file://localhost/absolute/path`, or `file:/absolute/path` alias for the absolute path with identical edit behavior, without its :range suffix.
- a relative local path resolves from the entered Workspace root and is refused when none is entered.
- An absolute path has the host OS user's file authority and needs a configured native executor; kb:// needs none. A Machine locator runs as that Machine's OS user with no sandbox and needs no local executor; its registered roots bound addressing only, that user can change them, and a Machine shared between users gives no isolation between them.
- Empty newText deletes.
</instruction>

<output>
- Line-number prefixes are navigation metadata, never file bytes.
- Model-facing results are standard JSON text; decode JSON escapes before copying source into edit oldText.
</output>

<critical>
- Missing or ambiguous oldText fails without changing the file.
</critical>
