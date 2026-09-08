/**
 * Validates the operator-configured root and the server-derived stable-ID
 * child before any Knowledge operation touches them. The binding is the output
 * of the trusted resolver, so this checks only that the pair on disk is still
 * the pair the resolver described: real directories, canonical, and neither one
 * a symbolic link.
 */

import path from 'node:path';

import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import { validateBinding } from './knowledge-filesystem-validation';
import type {
  KnowledgeFilesystemBinding,
  KnowledgeFilesystemPort,
} from './knowledge-filesystem';

export type KnowledgeBindingPort = Pick<
  KnowledgeFilesystemPort,
  'lstat' | 'realpath'
>;

export async function resolveKnowledgeBindingDirectory(
  binding: KnowledgeFilesystemBinding,
  port: KnowledgeBindingPort,
): Promise<string> {
  validateBinding(binding);
  const root = path.resolve(binding.root);
  const directory = path.resolve(binding.directory);
  if (directory !== path.join(root, binding.id)) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
  await assertCanonicalDirectory(root, port);
  await assertCanonicalDirectory(directory, port);
  return directory;
}

async function assertCanonicalDirectory(
  target: string,
  port: KnowledgeBindingPort,
): Promise<void> {
  const stats = await port.lstat(target);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
  if ((await port.realpath(target)) !== target) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
}
