---
summary: "Entry point to llame's product documentation: tool and locator behavior, and operator runbooks"
read_when:
  - you need to know how a llame tool, locator, or selector behaves
  - you need to know how an operator configures or deploys llame
---

# llame product documentation

Two subtrees, split by who acts on them.

- [Reference](reference/index.md): what the assistant's tools do, what each
  locator scheme reaches, and how selectors shape a read. Owners and the
  assistant rely on these pages.
- [Operator](operator/index.md): how an operator enables, restricts, deploys,
  and troubleshoots those capabilities in `llame.config.json`.

A reference page names the operator page that configures it, and an operator
page names the reference pages it configures. The OpenSpec capability named on
each reference page wins any disagreement.
