---
summary: "skill:// locators: read-only access to an installed skill package's SKILL.md, resources, and catalog"
read_when:
  - you are passing a skill:// locator to read a skill package
  - you need the published skillDirectory envelope or the manual-only selection rule
spec: agent-skills
configured_by:
  - ../../operator/skills.md
  - ../../operator/native-files.md
---

# Skill locators

## Form

`read` accepts read-only `skill://` locators for the skill packages the operator
installed (see [skills](../../operator/skills.md)):

- `skill://<name>` reads the package's `SKILL.md`; `skill://<name>:raw` returns
  it verbatim, still with the result envelope.
- `skill://<name>/<path>[:selector]` reads a supporting file, with the same
  selector, truncation, and context behavior as any other read.
- `skill://<name>/` lists the package directory, and `skill://` with an optional
  `:N-M` or `:N+K` lists the catalog, which pages through `nextOffset` like a
  directory listing.

`<name>` follows the Agent Skills name grammar, defined under
[package format](../../operator/skills.md#package-format). `<path>` follows the
same component and bounds rules as a [`kb://` path](kb.md#form). Every call
re-reads the catalog, so a removed or newly invalid package fails immediately
rather than serving stale bytes.

## Accepted by

`read` only; `edit` and `write` reject the scheme with
`unsupported_operation` and no filesystem effect.

## Authority

Every successful result carries `locator`, `sourceDirectory`, absolute
`resolvedPath`, absolute `skillDirectory`, and `skillPathInstruction`; the
envelope also carries `realSkillDirectory` when the real package directory
differs from `skillDirectory`. Package-relative paths still resolve against
`skillDirectory`, not `realSkillDirectory`.

Unlike `kb://`, these paths are published deliberately: a skill's script and
reference instructions are usable only once the agent can turn them into
absolute paths. Resolve package-relative references against `skillDirectory`,
keep task-relative input arguments as given, and pass an explicit `cwd` when a
script needs its own directory. The tool never rewrites a Bash command and never
executes a skill's scripts during a read.

A manual-only package (one whose invocation control disables proactive use)
loads only when the user names it explicitly in the current turn, for example by
writing `$review`. Without that selection its body and resource reads return
`skill_requires_explicit_selection` and the catalog listing omits it.

## Listing

`skill://<name>/` lists the package directory and `skill://` lists the catalog,
paging through `nextOffset` like a directory listing. A manual-only package is
omitted from the catalog until the user selects it.

## Errors

`unsupported_operation` for `edit` or `write`; `skill_requires_explicit_selection`
for an unselected manual-only package; `invalid_path` for a malformed locator;
`not_found` for a package or supporting file that is absent. The shared
vocabulary is in [read](../tools/read.md#errors).

## Configured by

- [Skills](../../operator/skills.md) installs the packages and sets the manual-only
  invocation controls.
- [Native files](../../operator/native-files.md) enables the `read` entry.
