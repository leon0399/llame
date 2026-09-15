Replace one exact unique oldText occurrence with newText in a current local file.

<instruction>
- `path` is an absolute path on this native host, or a `kb://` Knowledge locator{{#if tools.knowledge_search}} as returned by `knowledge_search`{{/if}}, without its :range suffix.
- An absolute path has the host OS user's file authority and needs a configured native executor.
- A `kb://` locator resolves through your Knowledge Space access and needs no native executor.
- Use empty `newText` to delete.
</instruction>

<output>
- Output line-number prefixes are navigation metadata, never file bytes.
- Model-facing results are standard JSON text; decode JSON string escapes before copying source into edit oldText.
</output>

<critical>
- Missing or ambiguous `oldText` fails without changing the file.
</critical>
