Create a new local UTF-8 file, or replace an existing file's entire contents with replace: true.

<instruction>
- `path` is an absolute path on this native host, or a `kb://` Knowledge locator{{#if tools.knowledge_search}} as returned by `knowledge_search`{{/if}}, without its :range suffix.
- An absolute path has the host OS user's file authority and needs a configured native executor.
- A `kb://` locator resolves through your Knowledge Space access and needs no native executor.
</instruction>

<conditions>
- Creating fails with file_exists when the target already exists.
- Replacing requires an existing file and fails with not_found when there is none.
</conditions>

<output>
- Output line-number prefixes are navigation metadata, never file bytes.
- Model-facing results are standard JSON text; decode JSON string escapes before copying source into {{#if tools.edit}}edit oldText{{else}}a later exact replacement{{/if}}.
</output>

<critical>
{{#if tools.edit}}- Use edit for a partial change.
{{/if}}</critical>
