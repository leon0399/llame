export const TOOL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function isToolId(value: unknown): value is string {
  return typeof value === 'string' && TOOL_ID_PATTERN.test(value);
}

export function asciiCaseFoldToolId(id: string): string {
  return id.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}
