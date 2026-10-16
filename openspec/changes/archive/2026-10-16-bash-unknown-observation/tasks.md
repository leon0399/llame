## 1. Bash executor

- [x] 1.1 Remove quarantine from `attempt-ledger` / admission; update unknown message to instruct inspect-before-retry
- [x] 1.2 Simplify `settleExit` to kill-then-prove; keep abort/deadline/child-error unknown as observations without quarantine
- [x] 1.3 Rewrite executor tests: no admission refusal after unknown; exit survivors that die after SIGKILL become known

## 2. Runner / MCP

- [x] 2.1 Stop aborting the Run on live bash/MCP `outcome_unknown` (`notifyUnknownOutcome`, MCP helpers, MCP persist failure); keep abort for edit/write
- [x] 2.2 Update runner/bash/MCP tests for non-fatal live unknown

## 3. Specs sync

- [x] 3.1 Apply delta requirements into main `openspec/specs` when landing (or via archive sync)
