# Operator skill catalog

llame can publish an [Agent Skills](https://agentskills.io/specification) catalog
from operator-owned directories. This runbook covers the catalog layer:
configuration, package layout, invocation controls, and owner inspection.

## Configure sources

Set `skills.directories` in `llame.config.json` to an ordered list of collection
directories:

```json
{
  "skills": { "directories": ["/opt/skills"] }
}
```

Each entry is a **collection directory** whose immediate child directories are
skill packages. Do not list individual packages:

```text
/opt/skills/
  pdf/
    SKILL.md
    scripts/extract.py
  research/
    SKILL.md
```

`/opt/skills/pdf` is a package; `/opt/skills` is the configured source. A
`SKILL.md` directly inside a configured source is not a package.

Rules:

- Entries are literal, intentionally public filesystem paths. `{env:...}` and
  `{path:...}` interpolation is rejected at boot, no shell evaluation occurs,
  and no home or repository directory is scanned implicitly.
- A relative entry resolves against the configuration file's directory; a
  leading `~/` resolves against the operator process home.
- At most 32 sources are accepted.
- Later sources override earlier sources by package name. An invalid package in
  a later source makes that name unavailable; the earlier package is not used as
  a fallback. Valid packages in other sources are unaffected.
- Editing packages inside an already configured source takes effect without a
  restart. Changing the configured list requires the existing restart boundary.

## Package format

A package is a directory containing `SKILL.md` with YAML frontmatter:

```markdown
---
name: pdf
description: Extract text and tables from PDF files. Use when handling PDFs.
---

# PDF extraction

...
```

`name` is required and must match the directory name: 1-64 characters, lowercase
letters, digits, and hyphens only, without a leading, trailing, or consecutive
hyphen. `description` is required and must be 1-1024 characters. `license`,
`compatibility`, and `metadata` are optional and ignored at runtime. Duplicate
YAML keys and malformed metadata make the package unavailable.

Discovery reads one level of immediate children, bounded at 10,000 child entries
per source. A source that cannot be read, or a source that exceeds its bound,
makes the whole catalog unavailable rather than resolving package precedence
from an incomplete scan.

A configured source is trusted by being configured: a source may link to a
package anywhere on the host, and discovery and skill reads apply ordinary
operating-system link semantics with no link resolution, verification, or
containment. The operator is trusted for every link reachable from a configured
source. A published package path is the link path as discovered beneath the
configured source; the real package directory is published beside it as
`realSkillDirectory` when it differs. A child link that cannot be resolved is an
unavailable entry naming the unresolved link, and a child link resolving to
something other than a directory is an unavailable entry naming the target kind.

## Invocation controls

A package is either proactively invocable (eligible for model-driven
selection) or **manual-only** (explicitly selected by a user). The first present
control wins, in this order:

1. `agents/llame.yaml`: `policy.allow_implicit_invocation`
2. `SKILL.md` frontmatter: `disable-model-invocation` (inverted)
3. `agents/openai.yaml`: `policy.allow_implicit_invocation`
4. Default: proactively invocable

A sidecar that configures a boolean ends resolution: lower-priority invocation
settings are not read or validated, so an ignored malformed fallback cannot
invalidate the package. A sidecar present without a control falls through. A
malformed consulted sidecar or a non-boolean consulted control makes the package
unavailable. `SKILL.md` metadata is always parsed and validated regardless of
which control wins.

These controls change selection only. They are not a filesystem boundary and do
not grant tools, relax permissions, or expose process credentials.

## Inspect the catalog

`GET /api/v1/skills` returns the system catalog for any authenticated owner:
name, description, proactive eligibility, selected source directory, package
directory, availability, and diagnostics for unavailable entries. It is
read-only and identical for every owner. Entries are ordered by name; pass
`limit` (1-200, default 100) and `after` (the last name from the previous page)
to page through a large catalog. `nextCursor` is `null` on the last page.

Manual-only packages appear in this listing. Loading instructions and package
files happens through the native `read` tool's `skill://` locator: `skill://pdf`
reads `SKILL.md`, `skill://pdf/<path>` reads a supporting file, `skill://pdf/`
lists the package, and `skill://` lists the catalog. See
[native-files.md](native-files.md) for the locator contract, the published
`skillDirectory`/`resolvedPath` envelope, and how a manual-only package is
selected explicitly.

## Model advertisement

The packaged default system prompt advertises the proactively eligible catalog
so the model can find a skill without being told. It renders only when at least
one entry is admitted, lists each entry as a `<skill name="…">` element in
code-point name order, and states how many entries the size bound left out.
Model-specific prompt overrides opt out by not referencing the `skills`
namespace; explicit `$skill` invocation still works on those models.

The advertised set is frozen per compaction epoch: it is resolved at an
accepted turn and stored on the chat, so editing a package, switching models,
or any other prompt change does NOT re-render the prompt or re-mint the
effective-context snapshot. Compaction starts a new epoch, and the next
accepted turn resolves the catalog again. A chat with no configured source
stores nothing and renders no skill section.

The bound admits whole entries in code-point name order: at most 256 entries
and at most 16 KiB of names and descriptions combined. Two caps because the
prompt template owns the per-entry markup, so a byte bound on content alone
would let thousands of one-character entries render far more than 16 KiB. The
omission count is disclosed in the prompt and the full catalog stays readable
at `skill://`.

Invocability is decided by the package's own controls (see above); an entry
that is manual-only or currently unreadable is never advertised and is not
counted as omitted, because it has no instructions to offer.
