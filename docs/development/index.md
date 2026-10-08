# Development

Contributor documentation. Not served to the assistant.

- [Testing](testing.md): test layers, placement rules, mutation testing, and
  the CI job graph.
- [Compaction eval](compaction-eval.md): provider-backed model eval and
  fixture runbook for the production compaction request.
- [Code quality gates](code-quality-targets.md): enforced ceilings and the
  command that owns each.
- [Code quality rules](code-quality-tracker.md): how lint, mutation, and
  dead-code findings are handled.
- [Runtime and package manager](runtime-and-package-manager.md): why Node and
  pnpm, and the pnpm workspace contracts.
- [Mutation gate redesign](mutation-gate-redesign.md): design record for the
  changed-lines mutation gate.

## Harness comparison

How llame's tools compare with other agent harnesses, one page per tool.

- [`read` for web URLs](harness-comparison/read.md): llame against omp,
  Claude Code, OpenCode, OpenClaw, and Gemini CLI, with a per-site adapter
  table.
