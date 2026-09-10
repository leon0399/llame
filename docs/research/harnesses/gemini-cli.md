---
type: Reference
title: "Gemini CLI"
description: "Argument-aware policy and behavioral evaluation"
resource: "https://github.com/google-gemini/gemini-cli"
sources:
  - id: packages-core-src-policy-types-ts-l125-l166
    resource: "https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/policy/types.ts#L125-L166"
    title: "Typed rules"
  - id: packages-core-src-policy-policy-engine-ts-l247-l293
    resource: "https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/policy/policy-engine.ts#L247-L293"
    title: "engine"
  - id: docs-behavioral-evals-md-l55-l143
    resource: "https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/docs/behavioral-evals.md#L55-L143"
    title: "evaluation guide"
  - id: packages-core-src-hooks-hookrunner-ts-l97-l111
    resource: "https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/hooks/hookRunner.ts#L97-L111"
    title: "Hook execution errors"
---

# Gemini CLI

- **Stack:** TypeScript npm-workspaces monorepo; Apache-2.0
- **Observed:** 2026-09-10 @ `ed2ac40df67a319bf348bd7e3d10494696b31b38`

Google's terminal agent is a high-confidence reference for argument-aware policy
and behavioral evaluation. Its policy engine can inform llame's future approval
capability; hooks have a separate failure contract.

**Study**

1. **Argument-aware policy.** Typed rules[^packages-core-src-policy-types-ts-l125-l166]
   match MCP servers, subagents, argument patterns, annotations, and approval
   modes. The engine[^packages-core-src-policy-policy-engine-ts-l247-l293]
   sorts rules by descending priority and defaults to deny in non-interactive
   mode. Compare this explicit evaluation order with llame's future policy needs.
2. **Behavioral evaluation.** The behavioral-eval workflow separates structural validation from nightly
   behavior: cases declare `ALWAYS_PASSES`, `USUALLY_PASSES`, or `USUALLY_FAILS`,
   while `eval:validate` checks rule shape and tool-call assertions
   (evaluation guide[^docs-behavioral-evals-md-l55-l143]). This is a useful promotion model for
   llame's evals, provided reports retain the fixture and saved result.

**Caution**

Hook execution errors[^packages-core-src-hooks-hookrunner-ts-l97-l111]
are logged as non-fatal and returned as failed hook results. A hook's failure
contract must be checked separately from a policy denial; do not use an advisory
hook as llame's authorization boundary.

[^packages-core-src-policy-types-ts-l125-l166]: [Typed rules](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/policy/types.ts#L125-L166)

[^packages-core-src-policy-policy-engine-ts-l247-l293]: [engine](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/policy/policy-engine.ts#L247-L293)

[^docs-behavioral-evals-md-l55-l143]: [evaluation guide](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/docs/behavioral-evals.md#L55-L143)

[^packages-core-src-hooks-hookrunner-ts-l97-l111]: [Hook execution errors](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/hooks/hookRunner.ts#L97-L111)
