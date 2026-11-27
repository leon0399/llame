/**
 * The one field whose literal matching uses flexible whitespace
 * (openspec/changes/tool-call-permissions D2). This is a code semantic, not
 * operator policy: the native shell `command` string treats each literal
 * whitespace run as one-or-more ECMAScript whitespace characters. It holds for
 * every shell tool, because the dialect a tool names never changes how its text
 * is matched.
 */
export const SHELL_COMMAND_TOOL_IDS: ReadonlyArray<string> = ['bash', 'zsh'];
export const SHELL_COMMAND_FIELD = 'command';

export function isShellCommandField(toolId: string, field: string): boolean {
  return (
    SHELL_COMMAND_TOOL_IDS.includes(toolId) && field === SHELL_COMMAND_FIELD
  );
}
