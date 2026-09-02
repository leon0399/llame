export const TOOL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function isToolId(value: unknown): value is string {
  return typeof value === 'string' && TOOL_ID_PATTERN.test(value);
}

export function asciiCaseFoldToolId(id: string): string {
  return id.replaceAll(/[A-Z]/gu, (character) => character.toLowerCase());
}

/**
 * Match one exact tool id against the boot-validated raw allowlist. A
 * terminal `*` is the only permission expression supported by this matcher;
 * its literal prefix is compared against the candidate id. No candidate
 * parsing or source metadata is needed at match time.
 */
export function matchesAllowedToolId(
  toolId: string,
  allowedRules: ReadonlyArray<string>,
): boolean {
  return allowedRules.some((rule) =>
    rule.endsWith('*') ? toolId.startsWith(rule.slice(0, -1)) : rule === toolId,
  );
}

/** Code-owned tool permissions are exact; wildcard rules belong to MCP ids. */
export function matchesCodeOwnedToolId(
  toolId: string,
  allowedRules: ReadonlyArray<string>,
): boolean {
  return allowedRules.includes(toolId);
}
