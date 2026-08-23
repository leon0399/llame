# cli — llame's local coding-harness experiment

A first-party local CLI that runs llame's harness core directly in a
terminal, with no database, no account, and no server: the smallest runnable
slice of the "standalone personal operation" horizon in
[VISION.md](../../VISION.md).

## What it is

- **Workspace-bound**: a run advertises exactly the directory it was started
  in. Every path tool resolves against that root and refuses escape.
- **Five coding tools** (`read_file`, `list_dir`, `write_file`, `edit_file`,
  `bash`) built on `@workspace/harness`'s classified-tool contracts.
- **Fail-closed approvals**: every non-read-only tool call is shown to the
  operator (tool, classification, validated input) and needs an explicit
  `y`; anything else denies.
- **Narrated runs**: each run binds a context receipt (model, effective
  prompt, advertised tools, step cap) into the session log; the log itself is
  append-only JSONL under `$LLAME_HOME` (default `~/.llame`).
- **User-configured inference**: any OpenAI-compatible endpoint.

## Configuration

Precedence: `llame.cli.json` in the workspace root, then environment.

```jsonc
// llame.cli.json — values may use {env:NAME} / {path:LOC} tokens
{
  "model": "gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "{env:OPENAI_API_KEY}",
  "maxSteps": 8,
}
```

Environment equivalents: `LLAME_MODEL` / `OPENAI_MODEL`,
`LLAME_BASE_URL` / `OPENAI_BASE_URL`, `LLAME_API_KEY` / `OPENAI_API_KEY`.

## Run

```bash
pnpm --filter @workspace/harness build && pnpm --filter @workspace/config-interpolation build
pnpm --filter cli build
node apps/cli/dist/main.js            # REPL
node apps/cli/dist/main.js "prompt"   # one-shot
# or from source:
pnpm --filter cli dev -- "prompt"
```
