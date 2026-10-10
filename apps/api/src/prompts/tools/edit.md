Replace one exact unique `oldText` occurrence with `newText` in a current local file.

<instruction>
- `path` is exactly one target, without its :range suffix: an absolute path on this native host (host OS user's file authority, configured native executor), a `file:///absolute/path`, `file://localhost/absolute/path`, or `file:/absolute/path` alias for the absolute path with identical edit behavior, or a `kb://` Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}} (needs no native executor).
- a relative local path resolves from the entered Workspace root and is refused when none is entered.
{{#if tools.read}}- SHOULD `read` the file first and copy `oldText` from the returned source, not from memory.
{{/if}}- `oldText` MUST match exactly once, including whitespace and indentation; widen it with surrounding lines when it is ambiguous.
- Empty `newText` deletes `oldText`.
</instruction>

## Parameters

- `path` - The file to edit (e.g. `/srv/project/src/foo.ts`, `kb://<knowledgeSpaceId>/notes/todo.md`).
- `oldText` - The exact text to find; must occur exactly once.
- `newText` - The replacement text; empty deletes.

## Source Text

- Line-number prefixes are navigation metadata, never file bytes; strip them before copying into `oldText`.
- Model-facing results are standard JSON text; decode JSON escapes before copying source into `oldText`.
{{!--
- Line-anchored hashline patches (`[PATH#TAG]`, `PUT N.=M:`, `CUT`, `MV`, registers) are unsupported.
--}}

<critical>
- Missing or ambiguous `oldText` fails without changing the file.
- NEVER guess file content; edit only text a result actually returned.
</critical>
