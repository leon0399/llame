## Why

The recommended B1 reject for `bash.command` ends its command-name match with
`(\s|$)`, so `reboot;`, `reboot&&true`, `sudo|tee x`, `(halt)`, a backticked
`` `reboot` ``, and `reboot>log` do not match, although Bash treats `;`, `&`,
`|`, `(`, `)`, `<`, `>`, and a backtick as the end of a command word
([#1169](https://github.com/leon0399/llame/issues/1169)). A runner admitted by
the `bash` group can therefore execute a command B1 is documented to block. B8
(pipe to shell) ends `sh` the same way, so `curl … | sh; echo done` evades it
too. Both live in the authoritative recommended reject table in
`tool-call-permissions`, which the shipped example and the operator runbook
copy.

## What Changes

- B1 and B8 end the command-name match with
  `($|[\s;&|()<>\x60])` instead of `(\s|$)`, matching how B2 already ends its
  target (`($|[\s;&|])`). `\x60` spells the backtick, as B8 already spells the
  pipe `\x7c`, so the table cell stays a plain code span.
- The example matrix gains three rows: two newly rejected shapes and one
  allowed shape that guards against over-matching.
- A new scenario pins both outcomes.
- The shipped `llame.config.jsonc.example`, the operator runbook table, and the
  test mirror of the portable policy carry the new values; the requirement
  already obliges them to match the table.
- **Operator note, not a breaking change**: an operator map copied from an
  earlier example keeps the old patterns until re-copied, because an explicit
  map is the complete policy and nothing merges into it. The changelog entry
  says so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-call-permissions`: the B1 and B8 rows, three example rows, and one
  scenario of "Recommended portable policy with explicit replacement".

## Impact

- `openspec/specs/tool-call-permissions/spec.md`, through finalize's sync.
- `apps/api/llame.config.jsonc.example`,
  `docs/product/operator/tool-call-permissions.md`,
  `apps/api/src/testing/portable-tool-policy.ts`, permission tests, and
  `CHANGELOG.md`.
- No runtime code: the patterns are configuration data the existing matcher
  compiles.

## Acceptance

- Under the recommended example policy, every shape in the new scenario is
  rejected by B1 or B8, and `./reboot.sh`, `cat /etc/sudoers`, and
  `curl … | shellcheck -` are not.
- The example, the runbook table, and the test mirror carry the canonical B1
  and B8 values; the existing parity test keeps the example and the mirror
  identical.
- Every other row, sentence, and scenario of the requirement is byte-identical.

## Assumptions

- The patterns are textual guards over the submitted command, as today; they
  are not shell parsing, and the requirement's existing text already frames
  rejects that way (`echo "git reset --hard"` is a documented textual false
  positive).
- A probe through the production compiler (`re2js`, with the matcher's
  explicit `\s` class) rejected all twelve evasions listed above plus a tab
  separator, and allowed all six guard cases; recorded in design.md.

## Decisions for approval

- Include B8 in the same change. #1169 names only B1; B8 has the identical
  trailing-boundary defect, and fixing one leaves the other bypassable the
  same way.

## Non-goals

- Shell parsing, quote awareness, or any change to how rejects are evaluated.
- Other recommended rejects. B2 and B3 already exclude these separators; the
  literals B4-B7 match substrings, so they need no boundary.
