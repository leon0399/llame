---
summary: "Index of tool, locator, and selector behavior as the assistant sees it"
read_when:
  - you need the page that describes one tool, locator scheme, or selector
---

# Reference

- [Tools](tools/index.md): one page per tool id, with its arguments, result,
  bounds, and errors.
- [Locators](locators/index.md): one page per scheme a `path` argument can
  name, with the tools that accept it and the authority it reaches.
- [Selectors](selectors.md): line ranges, `:raw`, `:outline`, Markdown
  ancestors, and the result bound every read shares.
- [Instruction files](instruction-files.md): which project instruction files a
  touch loads into context, and when.
- [Permission modes](permission-modes.md): what `default` and `bypass` change
  for one Run.
- [Mutation recovery](mutation-recovery.md): how `edit`, `write`, and `bash`
  attempts are fenced so a redelivered Run never repeats an effect.
