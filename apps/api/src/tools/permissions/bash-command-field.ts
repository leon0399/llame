/**
 * The one field whose literal matching uses flexible whitespace
 * (openspec/changes/tool-call-permissions D2). This is a code semantic, not
 * operator policy: the native Bash `command` string treats each literal
 * whitespace run as one-or-more ECMAScript whitespace characters.
 */
export const BASH_COMMAND_TOOL_ID = 'bash';
export const BASH_COMMAND_FIELD = 'command';

export function isBashCommandField(toolId: string, field: string): boolean {
  return toolId === BASH_COMMAND_TOOL_ID && field === BASH_COMMAND_FIELD;
}
