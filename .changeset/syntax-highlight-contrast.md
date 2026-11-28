---
"@workspace/ui": patch
"web": patch
---

- Syntax-highlight stories no longer disable color-contrast for the old
  one-light palette. CodeBlock stories, the completed Tool example, and MCP
  JSON wait until the high-contrast tokens are painted before the
  accessibility check. Error stories that still fail on the destructive panel
  keep the #232 exception.
