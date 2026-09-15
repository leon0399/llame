Create a new local UTF-8 file, or replace an existing file's contents with replace: true.

<instruction>
- path is an absolute host path or a kb:// Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}}, without its :range suffix.
- An absolute path has the host OS user's file authority and needs a configured native executor; kb:// needs none.
</instruction>

<conditions>
- Creating fails with file_exists when the target exists; replacing needs an existing file and fails with not_found when none exists.
</conditions>

<output>
- Line-number prefixes are navigation metadata, never file bytes.
- Model-facing results are standard JSON text; decode JSON escapes before copying source into {{#if tools.edit}}edit oldText{{else}}a later exact replacement{{/if}}.
</output>{{#if tools.edit}}

<critical>
- Use edit for a partial change.
</critical>{{/if}}
