# Writing the pull request body

Write the body to a file (`/tmp/pr-<branch>.md`) from
[`.github/pull_request_template.md`](../../../../.github/pull_request_template.md):
fill every section from the diff, delete the sections and checklist items that
do not apply, verify each remaining item before ticking it, and delete the
template's comment blocks. Rewrite a published body with
`gh pr edit <N> --body-file /tmp/pr-<branch>.md`, and rewrite it again when a
later push changes what it says: size, commands, or decisions.

## Sections

- **Concern** first, in 1–3 sentences: what and why.
- **One visual when the change has a shape.** Pick the smallest form that
  makes the point, put the explanation beside it, and give each fact one
  form: a visual or a list, never both. Use `$show-me` when available.

  |The point is…|Use|
  |---|---|
  |files added, moved, merged, or deleted|a diff-style file tree (` ```diff ` with `├──`, `+`/`-` lines and `#` comments)|
  |runtime order of calls|a call tree (` ```text `)|
  |UI structure|a component tree with file paths|
  |who calls what, data flow, states|` ```mermaid ` flowchart or sequence diagram|
  |numbers to compare|a table with a delta column (before, after, Δ, Δ %, ratio)|
  |the exact new shape of a small block|a ` ```diff ` of that block only|

  Check Mermaid syntax before publishing
  (`npx -y -p @mermaid-js/mermaid-cli@11 mmdc -i x.mmd -o x.svg`). Keep
  visuals at the top level: a fence nested in a list item renders unreliably.
- **Measurements** report both sides and the delta, and name the machine and
  base commit.
- **Decisions to review** lists rejected alternatives and accepted limits, so a
  reviewer can challenge them without reconstructing them. Review bots read
  this section and record its limits as intentional.
- **Commands run** lists only what ran, with results. Say what was left to CI.

## Voice

- Answer first, each fact once, no filler; follow the repository's prose
  rules.
- The body describes the change. Keep the agent, model, and tool that wrote it
  out of it, and leave out a "Test plan" section: Commands run carries the
  evidence.
