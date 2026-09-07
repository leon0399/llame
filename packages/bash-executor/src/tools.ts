/** Ordinary configured tools. None of these is the canonical editor. */
export const CONFIGURED_TOOLS = [
  "bash",
  "grep",
  "rg",
  "jq",
  "python",
  "python3",
] as const;

export type ConfiguredTool = (typeof CONFIGURED_TOOLS)[number];

function isConfiguredToolName(command: string): command is ConfiguredTool {
  for (const tool of CONFIGURED_TOOLS) {
    if (tool === command) return true;
  }
  return false;
}

/** Model may only name an allowlisted basename; no path, no host binary pick. */
export function resolveConfiguredTool(command: string): ConfiguredTool | null {
  if (command.length === 0 || command.includes("/") || command.includes("\\")) {
    return null;
  }
  if (command.includes("\0")) return null;
  if (!isConfiguredToolName(command)) return null;
  return command;
}

export function isConfiguredTool(command: string): boolean {
  return resolveConfiguredTool(command) !== null;
}
