import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Load a packaged tool description from the built prompts directory.
 * Normalizes CRLF line endings and trims trailing whitespace, matching
 * the system prompt loader's normalization. Fails fast on missing or
 * empty files — a broken packaged description must not silently fall
 * back to an empty string.
 */
export function loadPackagedToolDescription(toolId: string): string {
  const filePath = path.resolve(__dirname, 'tools', `${toolId}.md`);
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
