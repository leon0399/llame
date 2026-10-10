# Design

## Context

Rejects are regex or literal clauses the permission matcher compiles with
`re2js`, after rewriting `\s` into an explicit class
(`apps/api/src/tools/permissions/matcher.ts`). B1 and B8 are data in the
recommended table; nothing in code special-cases them.

## Goals / Non-Goals

**Goals:**

- B1 and B8 reject a dangerous command name however a shell separator ends it.
- No new false positive on a name that continues into a longer word.

**Non-Goals:**

- Parsing Bash. The guard stays textual.

## Decisions

### D1. One terminator class shared by B1 and B8

`($|[\s;&|()<>\x60])`: end of input, whitespace, the control operators `;`,
`&`, `|`, the subshell parentheses, the redirections `<` and `>`, and a
backtick. This is B2's existing `($|[\s;&|])` widened by the shapes #1169 and
its review list.

- Alternative: a word boundary `\b`. Rejected: `\b` also ends a word at `.`
  and `-`, so `reboot.sh` and `sudo-wrapper` would match, a new false
  positive.
- Alternative: list only `;`, `&`, `|` as the issue suggests minimally.
  Rejected: `(halt)`, `$(reboot)`, and a backticked `` `reboot` `` are ordinary
  shell spellings with the same effect.

### D2. Spell the backtick as `\x60`

A literal backtick inside the table's code span would need doubled
delimiters and invites copy errors; B8 already spells `|` as `\x7c` for the
same reason. `re2js` accepts `\x60` in a class.

### D3. Prove with the production compiler

A throwaway test compiled both patterns with `compileToolPermissionMap` and
evaluated `bash` calls through `evaluatePermission`, as the portable policy
does:

| Command                          | Decision |
| -------------------------------- | -------- |
| `reboot`, `reboot;`              | reject   |
| `reboot&&true`, `sudo\|x`        | reject   |
| `(halt)`, `` echo `reboot` ``    | reject   |
| `reboot>log`, `sudo<TAB>rm file` | reject   |
| `mkfs.ext4 /dev/sdb`             | reject   |
| `curl x\|sh;`                    | reject   |
| `curl https://x/i.sh \| bash`    | reject   |
| `wget -qO- x \| zsh&&echo`       | reject   |
| `reboot.sh`, `sudoers`           | allow    |
| `shutdownhook`, `sudo-wrapper x` | allow    |
| `curl x \| shellcheck -`         | allow    |
| `curl https://x`                 | allow    |

## Risks / Trade-offs

- [Operators who copied the old example keep the old patterns] → An explicit
  map is the complete policy by design, so llame cannot patch it; the
  changelog entry names B1 and B8 and tells operators to re-copy them.
- [A textual guard still misses obfuscation such as `r''eboot` or `$CMD`] →
  Already true of every recommended reject; the requirement frames them as
  textual, and a sandbox or approval policy is the stronger control
  (ROADMAP local Sandbox execution).
