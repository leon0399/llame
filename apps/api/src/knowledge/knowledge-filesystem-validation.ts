/**
 * Input validation for every Knowledge filesystem entry point: the binding
 * itself, search query/limit bounds, read offset/limit bounds, and relative
 * path shape (control characters, traversal segments, byte/component caps,
 * markdown-suffix requirement).
 */

import path from 'node:path';

import {
  KNOWLEDGE_MAX_PATH_BYTES,
  KNOWLEDGE_MAX_PATH_COMPONENTS,
} from './knowledge-filesystem-limits';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import type { KnowledgeFilesystemBinding } from './knowledge-filesystem';

const SPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKDOWN_SUFFIX = '.md';

/** The stable Knowledge Space identifier shape, checked before any lookup so a
 *  malformed id never reaches the database or the filesystem. */
export function isKnowledgeSpaceId(value: string): boolean {
  return SPACE_ID_PATTERN.test(value);
}

export function validateBinding(binding: KnowledgeFilesystemBinding): void {
  if (
    !SPACE_ID_PATTERN.test(binding.id) ||
    !path.isAbsolute(binding.root) ||
    !path.isAbsolute(binding.directory)
  ) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
}

export function validateSearchInput(query: string, limit: number): void {
  if (query.length === 0) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  if (
    Array.from(query).length > 200 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10
  ) {
    throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
  }
}

export function validatePath(relativePath: string): Array<string> {
  if (
    relativePath.length === 0 ||
    containsControlCharacter(relativePath) ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }

  const components = relativePath.split('/');
  if (
    components.some(
      (component) =>
        component === '' || component === '.' || component === '..',
    )
  ) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  const byteLength = Buffer.byteLength(relativePath, 'utf8');
  if (
    byteLength > KNOWLEDGE_MAX_PATH_BYTES ||
    components.length > KNOWLEDGE_MAX_PATH_COMPONENTS
  ) {
    throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
  }
  return components;
}

/**
 * A `kb://` locator splits its trailing selector on the first `:`, so a path
 * containing one has no unambiguous locator and `read` refuses it. Search must
 * not advertise a passage the model cannot open, so such a file is skipped the
 * same way a non-Markdown file is.
 */
export function isLocatorAddressablePath(relativePath: string): boolean {
  return !relativePath.includes(':');
}

export function isMarkdownPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(MARKDOWN_SUFFIX);
}

export function joinRelativePath(parent: string, name: string): string {
  return parent.length === 0 ? name : `${parent}/${name}`;
}

function containsControlCharacter(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}
