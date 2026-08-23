# Agent instructions — cli

Experimental local coding-harness CLI over `@workspace/harness`. Product
behavior and configuration live in [README.md](README.md).

## Commands

```bash
pnpm --filter cli build      # tsc → dist (bin entry)
pnpm --filter cli dev -- "prompt"   # tsx from source
pnpm --filter cli test lint typecheck
```

## Gotchas

- Requires `@workspace/harness` + `@workspace/config` dist built first (see
  their AGENTS.md); package-scoped `turbo.json` orders CI/local turbo runs.
- The workspace root binds at process cwd; tools close over it via
  `createCodingTools(cwd)` — never accept a root from model input.
- The approval gate owns stdin during a run; the REPL closes its readline
  between prompts so the two never fight over lines.
- Sessions append to `$LLAME_HOME/sessions/*.jsonl` (default `~/.llame`);
  run events are buffered per turn and flushed with the outcome — do not
  reintroduce fire-and-forget appends (they race process exit).
