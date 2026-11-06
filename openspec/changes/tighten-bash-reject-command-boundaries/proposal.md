## Why

The recommended B1 reject for `bash.command` ends its command-name match with
`(\s|$)`, so `reboot;`, `true && reboot; echo done`, `sudo|tee x`, `(halt)`, a
backticked `` `reboot` ``, and `reboot>log` do not match, although Bash ends a
command word at `;`, `&`, `|`, `)`, `<`, `>`, and a backtick
([#1169](https://github.com/leon0399/llame/issues/1169)). A runner admitted by
the `bash` group can therefore execute a command B1 is documented to block.
Two other recommended rejects share the defect:

- B8 (pipe to shell) ends `sh` the same way, so `curl … | sh; echo done`
  evades it, and its pipe side misses `|&`.
- B2 (recursive removal of root or home) ends its target with
  `($|[\s;&|])`, so `(rm -rf ~)`, `$(rm -rf ~)`, and `rm -rf ~>/dev/null`
  evade it.

All three live in the authoritative recommended reject table in
`tool-call-permissions`, which the shipped example and the operator runbook
copy.

## What Changes

- B1, B2, and B8 end their match with `($|[\s;&|)<>\x60])`: end of input,
  whitespace, `;`, `&`, `|`, a closing parenthesis, a redirection, or a
  backtick. `\x60` spells the backtick, as B8 already spells the pipe `\x7c`.
  An opening parenthesis is left out on purpose: a name followed by `(` is a
  function definition or a syntax error in Bash, never a run of that command,
  and code searches such as `grep -rn "shutdown(" src` must stay allowed.
- B8's pipe also accepts `|&`.
- B2's table row takes the B2 the example, the runbook, and the test mirror
  already ship, the longer form covering split flags, `--recursive`/`--force`,
  and `--no-preserve-root`, with the new terminator. The canonical table had
  kept an earlier short form, so the example already disagreed with the
  table the requirement says it matches.
- The example matrix gains four rows and the requirement gains one scenario,
  both pinning newly rejected shapes and allowed guard shapes.
- **Operator note, not a breaking change**: an operator map copied from an
  earlier example keeps the old patterns until re-copied, because an explicit
  map is the complete policy and nothing merges into it. The changelog entry
  names B1, B2, and B8.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-call-permissions`: the B1, B2, and B8 rows, four example rows, and one
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

- Under the recommended example policy, every shape in the new scenario's
  first `WHEN` is rejected by B1, B2, or B8, and every shape in its second is
  not.
- The example, the runbook table, and the test mirror carry the canonical B1,
  B2, and B8 values, the example and runbook keeping their stored escapes
  (JSON, and the `{{` interpolation brace escape in B2); the existing parity
  test keeps the example and the mirror identical.
- Every other row, sentence, and scenario of the requirement is unchanged.

## Assumptions

- The patterns stay textual guards over the submitted command, not shell
  parsing; the requirement already frames rejects that way
  (`echo "git reset --hard"` is a documented textual false positive).
- A probe through the production compiler and evaluator decided all 29 cases
  in design.md D4 as expected.

## Decisions for approval

- Include B8 and B2 in this change. #1169 names only B1; both have the same
  trailing-boundary defect, and fixing one leaves the others bypassable the
  same way.
- Reconcile the canonical B2 row to the shipped B2 while widening it, rather
  than widening the stale short form.

## Non-goals

- Shell parsing, quote awareness, or any change to how rejects are evaluated.
- B3, whose match ends at the `of=/dev/` prefix and so needs no terminator,
  and the literals B4-B7, which match substrings.
- The residual forms listed in design.md's Risks.
