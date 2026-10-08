---
summary: "Catalog of llame's tools: executor need, accepted locators, permission group, and operator page"
read_when:
  - you need to know which tool reaches a resource or what an operator must enable for it
  - you are choosing between read, knowledge_search, and conversation recall
---

# Tools

Every tool is advertised only when the operator allowlists it. In the default
permission mode every call is admitted only by the permission group keyed to
the tool's exact id; in bypass mode a call is admitted without one, as
[permission modes](../permission-modes.md) describes. A tool marked "host
executor" needs the operator's native executor identity; the others run wherever
the Run runs.

| Tool                                              | Executor                          | Locators                                                                                                                                               | Permission group        | Configured by                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`read`](read.md)                                 | host executor for host paths only | [host path, `file://`](../locators/host-path.md), [`kb://`](../locators/kb.md), [`skill://`](../locators/skill.md), [`http(s)://`](../locators/web.md) | `read`                  | [native files](../../operator/native-files.md), [Knowledge](../../operator/knowledge.md), [skills](../../operator/skills.md), [web reads](../../operator/web-read.md) |
| [`web_search`](web-search.md)                     | none                              | returns canonical `http(s)://` result URLs                                                                                                             | `web_search`            | [web search](../../operator/web-search.md)                                                                                                                            |
| [`edit`](edit.md)                                 | host executor for host paths only | [host path, `file://`](../locators/host-path.md), [`kb://`](../locators/kb.md)                                                                         | `edit`                  | [native files](../../operator/native-files.md), [Knowledge](../../operator/knowledge.md)                                                                              |
| [`write`](write.md)                               | host executor for host paths only | [host path, `file://`](../locators/host-path.md), [`kb://`](../locators/kb.md)                                                                         | `write`                 | [native files](../../operator/native-files.md), [Knowledge](../../operator/knowledge.md)                                                                              |
| [`bash`](bash.md)                                 | host executor                     | none; shell text and a literal `cwd`                                                                                                                   | `bash`                  | [native files](../../operator/native-files.md)                                                                                                                        |
| [`enter_workspace`](enter-workspace.md)           | host executor                     | an absolute host directory                                                                                                                             | `enter_workspace`       | [native files](../../operator/native-files.md)                                                                                                                        |
| [`exit_workspace`](exit-workspace.md)             | host executor                     | none                                                                                                                                                   | `exit_workspace`        | [native files](../../operator/native-files.md)                                                                                                                        |
| [`knowledge_search`](knowledge-search.md)         | none                              | returns [`kb://`](../locators/kb.md) coordinates                                                                                                       | `knowledge_search`      | [Knowledge](../../operator/knowledge.md)                                                                                                                              |
| [`search_conversations`](search-conversations.md) | none                              | returns message coordinates                                                                                                                            | `search_conversations`  | [conversation recall](../../operator/conversation-recall.md)                                                                                                          |
| [`conversation_read`](conversation-read.md)       | none                              | message coordinates                                                                                                                                    | `conversation_read`     | [conversation recall](../../operator/conversation-recall.md)                                                                                                          |
| [MCP tools](mcp-tools.md)                         | none                              | tool-defined                                                                                                                                           | `mcp__<server>__<tool>` | [MCP tools](../../operator/mcp-tools.md)                                                                                                                              |

Shared behavior lives on its own pages: [selectors](../selectors.md),
[instruction files](../instruction-files.md),
[permission modes](../permission-modes.md), and
[mutation recovery](../mutation-recovery.md).
