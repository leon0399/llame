Create a new local UTF-8 file, or replace an existing file's contents with `replace: true`.

<instruction>
- `path` is exactly one target, without its :range suffix: an absolute host path or a `file:///absolute/path`, `file://localhost/absolute/path`, or `file:/absolute/path` alias with identical write behavior, or a `kb://` Knowledge locator{{#if tools.knowledge_search}} as returned by knowledge_search{{/if}} (needs no native executor).
- a relative local path resolves from the entered Workspace root and is refused when none is entered.
- `content` is the complete file text; the file becomes exactly `content`, never a merge.
- `replace` defaults to false: creating fails with `file_exists` when the target exists; `replace: true` needs an existing file and fails with `not_found` when none exists.
</instruction>

<conditions>
- Creating new files the task requires.
- Replacing entire file contents when {{#if tools.edit}}an `edit` would be more complex{{else}}an exact partial replacement would be more complex{{/if}}.
</conditions>

## Parameters

- `path` - The file to create or replace (e.g. `/srv/project/src/foo.ts`, `kb://<knowledgeSpaceId>/notes/todo.md`).
- `content` - The complete file text.
- `replace` - `true` replaces an existing file; omitted or `false` creates a new one.

## Source Text

- Line-number prefixes are navigation metadata, never file bytes.
- Model-facing results are standard JSON text; decode JSON escapes before copying source into {{#if tools.edit}}edit `oldText`{{else}}a later exact replacement{{/if}}.
{{!--
- Archive entries (`archive.ext:path/inside/archive`) and SQLite row operations (`db.sqlite:table`, `db.sqlite:table:key`) are unsupported.
--}}
{{#if tools.edit}}

<critical>
- SHOULD use `edit` for a partial change.
</critical>
{{/if}}
