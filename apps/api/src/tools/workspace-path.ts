import { posix } from 'node:path';

import { parsePathScheme } from '@workspace/native-file-tools';

import { isFileAlias } from './permissions/file-alias';

export type WorkspaceRootCell = {
  current(): string | undefined;
  commit(root: string | undefined): void;
  claimTransition(): boolean;
};

export function createWorkspaceRootCell(
  initial: string | undefined,
): WorkspaceRootCell & { beginStep(): void } {
  let currentRoot = initial;
  let pendingRoot = initial;
  let transitionClaimed = false;
  return {
    current: () => currentRoot,
    commit: (root) => {
      pendingRoot = root;
    },
    beginStep: () => {
      currentRoot = pendingRoot;
      transitionClaimed = false;
    },
    claimTransition: () => {
      if (transitionClaimed) return false;
      transitionClaimed = true;
      return true;
    },
  };
}

export function resolveWorkspacePath(root: string, value: string): string {
  const resolved = posix.resolve(root, value);
  return value.endsWith('/') && resolved !== '/' ? `${resolved}/` : resolved;
}

export function isWorkspaceRelative(value: string): boolean {
  return (
    !value.startsWith('/') &&
    !isFileAlias(value) &&
    parsePathScheme(value) === undefined
  );
}
