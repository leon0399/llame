import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The complete set of packaged, llame-owned tool description templates. */
export const TOOL_PROMPT_IDS = [
  'read',
  'edit',
  'write',
  'bash',
  'search_conversations',
  'conversation_read',
  'knowledge_search',
] as const;

export type ToolPromptId = (typeof TOOL_PROMPT_IDS)[number];

export function isToolPromptId(toolId: string): toolId is ToolPromptId {
  return TOOL_PROMPT_IDS.some((knownId) => knownId === toolId);
}

export function resolvePackagedToolDescriptionPath(
  toolId: ToolPromptId,
): string {
  return path.resolve(__dirname, 'tools', `${toolId}.md`);
}

/**
 * Load a packaged tool description from the built prompts directory.
 * Normalizes CRLF line endings and trims trailing whitespace, matching
 * the system prompt loader's normalization. Fails fast on missing or
 * empty files — a broken packaged description must not silently fall
 * back to an empty string.
 */
export function loadPackagedToolDescription(toolId: ToolPromptId): string {
  const filePath = resolvePackagedToolDescriptionPath(toolId);
  if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `Packaged tool description missing: ${toolId} (expected ${filePath})`,
    );
  }
  const raw = readFileSync(filePath, 'utf-8');
  const normalized = raw.replaceAll(/\r\n?/gu, '\n').replace(/\s+$/u, '');
  if (normalized.length === 0) {
    throw new Error(`Packaged tool description empty: ${toolId}`);
  }
  return normalized;
}
